#!/usr/bin/env python3
"""Store the published ONNX model in Git without changing its tensors."""

import argparse
from pathlib import Path

import onnx
from onnx.external_data_helper import set_external_data


def split_model(source: Path, destination: Path) -> None:
    shard_limit = 80_000_000
    model = onnx.load(source)
    destination.mkdir(parents=True, exist_ok=True)
    shard_number = 0
    output = None
    try:
        for tensor in model.graph.initializer:
            payload = tensor.raw_data
            if len(payload) < 1024:
                continue
            if len(payload) > shard_limit:
                raise ValueError(f'Tensor {tensor.name} exceeds the shard limit')
            if output is None or output.tell() + len(payload) > shard_limit:
                if output is not None:
                    output.close()
                shard_number += 1
                shard_name = f'weights-{shard_number:02}.data'
                output = (destination / shard_name).open('wb')
            set_external_data(tensor, shard_name, output.tell(), len(payload))
            output.write(payload)
            tensor.ClearField('raw_data')
    finally:
        if output is not None:
            output.close()
    onnx.save_model(model, destination / 'model.int8.onnx')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    split_model(args.source, args.destination)
