#!/usr/bin/env python3
"""Serve the bundled character reference through a local CPU speech endpoint."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import multiprocessing as mp
from pathlib import Path
import re
import select
import signal
import socket
import sys
from threading import Lock
import time
import wave

sys.dont_write_bytecode = True
from prepare import MODEL

MODEL_ID = "jingshen-character"
VOICE = "xiaoyu"
RATE = 24_000
INTERJECTION = re.compile(r"(?:[咦嗯欸诶哎啊哦喂嘿唔呀]+|hmm|oh|hey|hi)[。！？!?，,、.…\s]*$", re.IGNORECASE)


def phrases(text):
    sentences = re.split(r"(?<=[。！？!?；;\n])|(?<=[.])\s+", text)
    lead = ""
    for index, sentence in enumerate(sentences):
        sentence = sentence.strip()
        if len(lead) < 12 and len(sentence) <= 6 and INTERJECTION.fullmatch(sentence) and any(piece.strip() for piece in sentences[index + 1:]):
            lead += sentence + (" " if sentence.isascii() else "")
            continue
        sentence, lead = lead + sentence, ""
        while sentence:
            length = 0
            end = len(sentence)
            for index, char in enumerate(sentence):
                length += 3 if "\u3000" <= char <= "\uffff" else 1
                if length > 90:
                    end = index
                    break
            if end < len(sentence):
                boundaries = list(re.finditer(r"[\s，、,]", sentence[:end]))
                if boundaries and boundaries[-1].end() >= end * .55:
                    end = boundaries[-1].end()
            phrase, sentence = sentence[:end].strip(), sentence[end:].lstrip()
            if any(char.isalnum() for char in phrase):
                yield phrase


def synthesize_channel(pipe, root, reference, threads):
    import numpy as np
    import sherpa_onnx as sherpa

    try:
        directory = root / MODEL
        model = sherpa.OfflineTtsZipvoiceModelConfig(
            encoder=str(directory / "encoder.int8.onnx"),
            decoder=str(directory / "decoder.int8.onnx"),
            tokens=str(directory / "tokens.txt"),
            lexicon=str(directory / "lexicon.txt"),
            data_dir=str(directory / "espeak-ng-data"),
            vocoder=str(root / "vocos_24khz.onnx"),
        )
        tts = sherpa.OfflineTts(sherpa.OfflineTtsConfig(
            model=sherpa.OfflineTtsModelConfig(zipvoice=model, num_threads=threads, provider="cpu"),
            max_num_sentences=1,
        ))
        if tts.sample_rate != RATE:
            raise ValueError(f"Expected {RATE} Hz, model has {tts.sample_rate} Hz")
        config = sherpa.GenerationConfig()
        with wave.open(str(reference), "rb") as source:
            if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, RATE):
                raise ValueError("Reference must be 24 kHz mono 16-bit PCM WAV")
            if not 0 < source.getnframes() <= RATE * 12:
                raise ValueError("Reference must contain at most 12 seconds of speech")
            data = source.readframes(source.getnframes())
            config.reference_audio = np.frombuffer(data, dtype="<i2").astype("float32") / 32768
        config.reference_sample_rate = RATE
        config.reference_text = reference.with_suffix(".txt").read_text(encoding="utf-8").strip()
        if not config.reference_text:
            raise ValueError("The matching reference transcript is empty")
        config.num_steps = 4
        config.extra = {"min_char_in_sentence": "12"}
        pipe.send(("ready", None))
        while True:
            text, speed = pipe.recv()
            config.speed = speed
            for phrase in phrases(text):
                audio = tts.generate(phrase, config)
                if audio.sample_rate != RATE:
                    raise ValueError("Unexpected sample rate")
                samples = np.asarray(audio.samples, dtype="float32")
                # ZipVoice's callback precedes its final silence trimming.
                pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
                for offset in range(0, len(pcm), 8192):
                    pipe.send(("audio", pcm[offset:offset + 8192]))
            pipe.send(("done", None))
    except EOFError:
        pass
    except Exception as error:
        pipe.send(("error", str(error)))
    finally:
        pipe.close()


class SpeechWorker:
    """Single warm ONNX process. Disconnects can stop an in-flight inference."""
    def __init__(self, root, reference, threads):
        self.context = mp.get_context("spawn")
        self.arguments = (root, reference, threads)
        self.lock = Lock()
        self.stopping = False
        self.process = self.pipe = None
        self.start()

    def start(self):
        self.pipe, child = self.context.Pipe()
        self.process = self.context.Process(target=synthesize_channel, args=(child, *self.arguments), daemon=True)
        self.process.start()
        child.close()
        self.ready = False

    def close(self):
        if self.pipe is not None:
            self.pipe.close()
        if self.process is not None:
            if self.process.is_alive():
                self.process.terminate()
                self.process.join(.15)
                if self.process.is_alive():
                    self.process.kill()
            self.process.join()
            self.process.close()
        self.process = self.pipe = None

    def receive(self, connected, deadline):
        while not self.stopping and connected():
            if time.monotonic() >= deadline:
                raise TimeoutError("Speech inference timed out")
            if self.pipe.poll(.025):
                return self.pipe.recv()
        raise ConnectionAbortedError

    def warm(self, connected=lambda: True):
        if self.ready:
            return
        kind, value = self.receive(connected, time.monotonic() + 40)
        if kind != "ready":
            raise RuntimeError(value or "Could not start the speech model")
        self.ready = True

    def stream(self, text, speed, connected):
        deadline = time.monotonic() + 75
        while not self.lock.acquire(timeout=.025):
            if not connected():
                return
            if time.monotonic() >= deadline:
                raise TimeoutError("Speech service is busy")
        try:
            if not connected():
                return
            self.warm(connected)
            self.pipe.send((text, speed))
            while True:
                kind, value = self.receive(connected, deadline)
                if kind == "audio":
                    yield value
                elif kind == "done":
                    return
                else:
                    raise RuntimeError(value or "Speech generation failed")
        except (GeneratorExit, OSError, EOFError, RuntimeError):
            if not self.stopping:
                self.close()
                self.start()
            raise
        finally:
            self.lock.release()


class SpeechHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format, *_arguments):
        pass

    def local(self):
        port = self.server.server_port
        hosts = (f"127.0.0.1:{port}", f"localhost:{port}")
        origin = self.headers.get("Origin")
        return self.headers.get("Host") in hosts and (origin is None or origin in [f"http://{host}" for host in hosts])

    def json_response(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(body)

    def do_GET(self):
        if not self.local():
            return self.json_response(403, {"error": "Loopback requests only"})
        if self.path == "/v1/models":
            return self.json_response(200, {"object": "list", "data": [
                {"id": MODEL_ID, "object": "model", "owned_by": "local"},
            ]})
        return self.json_response(404, {"error": "Unknown route"})

    def connected(self):
        try:
            readable = select.select([self.connection], [], [], 0)[0]
            return not readable or bool(self.connection.recv(1, socket.MSG_PEEK))
        except OSError:
            return False

    def parse_request_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 16_000 or self.headers.get_content_type() != "application/json":
            raise ValueError("Expected a bounded JSON request")
        self.connection.settimeout(5)
        request = json.loads(self.rfile.read(length))
        if not isinstance(request, dict):
            raise ValueError("Expected a JSON object")
        if request.get("model") != MODEL_ID or request.get("voice") != VOICE or request.get("response_format", "pcm") != "pcm":
            raise ValueError("Expected jingshen-character, xiaoyu, and pcm")
        text, speed = request.get("input"), request.get("speed", 1.0)
        if not isinstance(text, str) or not 0 < len(text) <= 1200 or not any(phrases(text)):
            raise ValueError("Expected 1–1200 characters of speech")
        if type(speed) not in (int, float) or not math.isfinite(speed) or not .6 <= speed <= 1.5:
            raise ValueError("Speed must be between 0.6 and 1.5")
        return text, float(speed)

    def do_POST(self):
        if not self.local():
            return self.json_response(403, {"error": "Loopback requests only"})
        if self.path != "/v1/audio/speech":
            return self.json_response(404, {"error": "Unknown route"})
        try:
            text, speed = self.parse_request_body()
        except (ValueError, OSError) as error:
            return self.json_response(400, {"error": str(error)})
        out = self.server.worker.stream(text, speed, self.connected)
        started = False
        try:
            for pcm in out:
                if not started:
                    self.send_response(200)
                    self.send_header("Content-Type", "audio/pcm")
                    self.send_header("Transfer-Encoding", "chunked")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.close_connection = True
                    started = True
                self.wfile.write(f"{len(pcm):x}\r\n".encode("ascii"))
                self.wfile.write(pcm)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
            if started:
                self.wfile.write(b"0\r\n\r\n")
            elif self.connected():
                self.json_response(422, {"error": "No speech was generated"})
        except (OSError, EOFError, RuntimeError):
            if not started and self.connected():
                self.json_response(503, {"error": "Local speech generation failed"})
        finally:
            out.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8891)
    parser.add_argument("--threads", type=int, default=3, choices=range(1, 9))
    args = parser.parse_args()
    started = time.monotonic()
    def stop_on_signal(_number, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop_on_signal)
    worker = SpeechWorker(args.dir, args.reference, args.threads)
    try:
        worker.warm()
        with ThreadingHTTPServer(("127.0.0.1", args.port), SpeechHandler) as server:
            server.worker = worker
            print(f"Local 24 kHz voice ready at http://127.0.0.1:{server.server_port}/v1 "
                  f"({time.monotonic() - started:.2f} s startup)", flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        worker.stopping = True
        worker.close()


if __name__ == "__main__":
    main()
