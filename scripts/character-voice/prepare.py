#!/usr/bin/env python3
"""Install the pinned local voice runtime on explicit request."""
import argparse
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import venv

HERE = Path(__file__).resolve().parent
RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
MODEL = "sherpa-onnx-zipvoice-distill-int8-zh-en-emilia"
ARCHIVE = (f"{RELEASE}/tts-models/{MODEL}.tar.bz2",
           "77219c8b40f4ee8d73a7f902305ff6c1128ef9b54461c41b4ca6ed890b6c2803")
ASSETS = {
    "vocos_24khz.onnx": (f"{RELEASE}/vocoder-models/vocos_24khz.onnx",
                         "bcb3b970e384161c4d634f0bb9e999ff1c471b34c9bc0b1049a5014065ed3cc0"),
}
ESPEAK_SHA = "e9c56f8c7cc79f16b1a2dc482074ed777e5b881da2a215a6f99630284dc4b3b8"
MODEL_FILES = {
    "encoder.int8.onnx": "f2de9a761a85e5ddd125dee6e05bad1c7ee92c11b83b4d775dab216a6aa41379",
    "decoder.int8.onnx": "3cc2e08a96610d7ea1b227398e97cdbbe0414499741d3aec0b8113db2a2ab251",
    "lexicon.txt": "c94b049d970e971acdc2a7e5e7b23ca594222a9d640e417c711f2ad1e7bb7d46",
    "tokens.txt": "ce98c1afc5f7a20c2484dffdd68a1fff0a4a2cc707328833750c4476c37cdbda",
}
REQUIREMENTS = ("sherpa-onnx==1.13.8", "numpy==2.4.6")


@contextmanager
def exclusive(path):
    # Keep one preparation writer for the shared local cache.
    with path.open("a+b") as lock:
        if os.name == "nt":
            import msvcrt
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def matches(path, expected):
    if not path.is_file():
        return False
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() == expected


def valid_espeak(directory):
    if not directory.is_dir():
        return False
    digest = hashlib.sha256()
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        digest.update(path.relative_to(directory).as_posix().encode("utf-8") + b"\0")
        with path.open("rb") as stream:
            digest.update(hashlib.file_digest(stream, "sha256").digest())
    return digest.hexdigest() == ESPEAK_SHA


def download(url, target, expected, size_limit):
    print(f"Downloading {url}", flush=True)
    with urllib.request.urlopen(url, timeout=60) as response, target.open("wb") as output:
        total = 0
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > size_limit:
                raise ValueError("Unexpected download size")
            output.write(block)
    if not matches(target, expected):
        raise ValueError(f"SHA-256 mismatch: {url}")


def prepare(root):
    with tempfile.TemporaryDirectory(prefix=".assets-", dir=root) as staging:
        temporary = Path(staging)
        model_dir = root / MODEL
        if not (all(matches(model_dir / name, sha) for name, sha in MODEL_FILES.items())
                and valid_espeak(model_dir / "espeak-ng-data")):
            archive = temporary / "zipvoice.tar.bz2"
            download(ARCHIVE[0], archive, ARCHIVE[1], 115 * 1024**2)
            with tarfile.open(archive, "r|bz2") as stream:
                for item in stream:
                    name = item.name.removeprefix(f"{MODEL}/")
                    parts = PurePosixPath(name).parts
                    if not (name in MODEL_FILES or name.startswith("espeak-ng-data/")) or item.isdir():
                        continue
                    if not item.isfile() or ".." in parts or "\\" in name:
                        raise ValueError(f"Invalid model file: {name}")
                    target = temporary.joinpath(*parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with stream.extractfile(item) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output)
            if not (all(matches(temporary / name, sha) for name, sha in MODEL_FILES.items())
                    and valid_espeak(temporary / "espeak-ng-data")):
                raise ValueError("Invalid model contents")
            model_dir.mkdir(exist_ok=True)
            for name in MODEL_FILES:
                (temporary / name).replace(model_dir / name)
            installed_espeak = model_dir / "espeak-ng-data"
            if installed_espeak.exists():
                installed_espeak.replace(temporary / "previous-espeak")
            (temporary / "espeak-ng-data").replace(installed_espeak)
        for name, (url, sha) in ASSETS.items():
            if not matches(root / name, sha):
                download(url, temporary / name, sha, 56 * 1024**2)
                (temporary / name).replace(root / name)
    interpreter = root / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not interpreter.is_file():
        venv.EnvBuilder(with_pip=True).create(root / "venv")
    verify = (
        "import numpy, sherpa_onnx; "
        "assert (numpy.__version__, sherpa_onnx.__version__) == ('2.4.6','1.13.8')"
    )
    if subprocess.run([interpreter, "-c", verify], capture_output=True).returncode:
        subprocess.run([interpreter, "-m", "pip", "install", "--only-binary=:all:", *REQUIREMENTS], check=True)
    return interpreter


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    parser.add_argument("--dir", type=Path, default=cache / "dsh-jingshen-character")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--port", type=int, default=8891)
    parser.add_argument("--threads", type=int, default=min(3, os.cpu_count() or 1))
    parser.add_argument("--reference", type=Path, default=HERE / "xiaoyu.wav")
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        parser.error("Python 3.11 or later is required")
    root = args.dir.expanduser().resolve()
    reference = args.reference.expanduser().resolve()
    if args.serve and not (reference.is_file() and reference.with_suffix(".txt").is_file()):
        parser.error("The reference WAV and matching .txt transcript are required")
    print("ZipVoice Distill bilingual int8 (Emilia) weights: CC BY-NC, non-commercial use.")
    print("Model licence: https://huggingface.co/k2-fsa/ZipVoice#4-license")
    print(f"Model: {ARCHIVE[0]}")
    print("Vocos vocoder: https://huggingface.co/charactr/vocos-mel-24khz", flush=True)
    root.mkdir(parents=True, exist_ok=True)
    with exclusive(root / ".prepare.lock"):
        interpreter = prepare(root)
    if args.serve:
        os.execv(interpreter, [str(interpreter), str(HERE / "serve.py"), "--dir", str(root),
                              "--port", str(args.port), "--threads", str(args.threads),
                              "--reference", str(reference)])


if __name__ == "__main__":
    main()
