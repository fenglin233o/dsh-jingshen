#!/usr/bin/env python3
"""Reproduce the shipped PrimeTTS weights from an upstream v1b_16k directory.

Run with Python 3.12, numpy==2.5.5 and onnx==1.20.1 installed in a development
environment. The converter is optional and is never invoked by the plugin.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory


def sha256(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def repack(source, destination, minimum_bytes, np, onnx):
    model = onnx.load(source)
    weights = []
    casts = []
    for weight in model.graph.initializer:
        if weight.data_type != onnx.TensorProto.FLOAT or len(weight.raw_data) < minimum_bytes:
            weights.append(weight)
            continue
        values = onnx.numpy_helper.to_array(weight)
        if not np.isfinite(values).all() or np.abs(values).max() > np.finfo(np.float16).max:
            weights.append(weight)
            continue
        packed_name = f"{weight.name}.__fp16_storage"
        weights.append(onnx.numpy_helper.from_array(values.astype(np.float16), name=packed_name))
        casts.append(onnx.helper.make_node("Cast", [packed_name], [weight.name], to=onnx.TensorProto.FLOAT))

    # Graph operations and their interfaces continue to use float32. ONNX
    # Runtime can fold these constant casts when it initializes each session.
    original_nodes = list(model.graph.node)
    del model.graph.initializer[:]
    model.graph.initializer.extend(weights)
    del model.graph.node[:]
    model.graph.node.extend(casts)
    model.graph.node.extend(original_nodes)
    onnx.checker.check_model(model)
    onnx.save(model, destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="directory with original PrimeTTS v1b_16k ONNX files")
    parser.add_argument("destination", type=Path, help="directory for the repacked ONNX files")
    parser.add_argument(
        "--manifest", type=Path,
        default=Path(__file__).resolve().parents[2] / "media/voice/local/tts/model.json",
        help="packaged model manifest with upstream and output hashes",
    )
    args = parser.parse_args()
    if args.source.resolve() == args.destination.resolve():
        parser.error("source and destination must be separate directories")

    import numpy as np
    import onnx

    storage = json.loads(args.manifest.read_text(encoding="utf-8"))["weights"]
    args.destination.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".prime-", dir=args.destination) as temporary:
        staged = Path(temporary)
        for name, hashes in storage["files"].items():
            source = args.source / name
            if sha256(source) != hashes["upstreamSha256"]:
                raise SystemExit(f"{name}: source SHA-256 differs from the pinned PrimeTTS revision")
            destination = staged / name
            repack(source, destination, storage["minimumInitializerBytes"], np, onnx)
            if sha256(destination) != hashes["sha256"]:
                raise SystemExit(f"{name}: output SHA-256 differs from the packaged model")
        for name in storage["files"]:
            os.replace(staged / name, args.destination / name)
            print(f"{name}  {sha256(args.destination / name)}")


if __name__ == "__main__":
    main()
