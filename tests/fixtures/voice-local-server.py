"""OpenAI-compatible loopback smoke-test fixture, using real Kokoro and SenseVoice.

Install in a virtual environment: python -m pip install sherpa-onnx==1.12.38 numpy
Obtain and extract the official sherpa-onnx archives:
  https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2
  https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
Run: python tests/fixtures/voice-local-server.py /path/to/extracted/models
In a separate terminal, set:
  SPIRIT_ASR_BASE_URL=http://127.0.0.1:8880/v1 SPIRIT_ASR_MODEL=sensevoice SPIRIT_TTS_VOICE=zf_028
Then run the browser smoke test or start the Spirit host with those variables.
This fixture is for local verification. The sample uses a published voice; no voice cloning.
"""
import argparse
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import threading
import wave

import numpy as np
import sherpa_onnx

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('models', type=Path)
parser.add_argument('--port', type=int, default=8880)
parser.add_argument('--sample', type=Path, help='Write an original nine-second Mandarin sample and exit')
args = parser.parse_args()

kokoro = args.models / 'kokoro-int8-multi-lang-v1_1'
config = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=str(kokoro / 'model.int8.onnx'),
            voices=str(kokoro / 'voices.bin'),
            tokens=str(kokoro / 'tokens.txt'),
            data_dir=str(kokoro / 'espeak-ng-data'),
            lexicon=','.join(str(kokoro / name) for name in ('lexicon-us-en.txt', 'lexicon-zh.txt')),
        ),
        num_threads=3,
    ),
    rule_fsts=','.join(str(kokoro / name) for name in ('phone-zh.fst', 'date-zh.fst', 'number-zh.fst')),
)
if not config.validate():
    parser.error('Kokoro model files are unavailable')
tts = sherpa_onnx.OfflineTts(config)
speakers = {'zf_006': 8, 'zf_028': 20, 'zf_044': 28}


def pcm(samples):
    return (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()


if args.sample:
    audio = tts.generate('喂，我在听。你慢慢说就好。等你讲完，我们再一起想想，先从哪件小事开始。', sid=speakers['zf_028'], speed=0.94)
    with wave.open(str(args.sample), 'wb') as output:
        output.setparams((1, 2, audio.sample_rate, len(audio.samples), 'NONE', 'not compressed'))
        output.writeframes(pcm(audio.samples))
    raise SystemExit(0)

sensevoice = args.models / 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17'
asr = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    str(sensevoice / 'model.int8.onnx'), str(sensevoice / 'tokens.txt'), num_threads=2, language='zh', use_itn=True,
)
synthesis_lock = threading.Lock()
recognition_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def send_json(self, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/v1/models':
            self.send_json({'data': [{'id': 'kokoro'}, {'id': 'sensevoice'}]})
        else:
            self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= 1_000_000:
            self.send_error(400)
            return
        data = self.rfile.read(length)
        if self.path == '/v1/audio/speech':
            self.send_speech(json.loads(data))
        elif self.path == '/v1/audio/transcriptions':
            self.send_transcript(data)
        else:
            self.send_error(404)

    def send_speech(self, request):
        if request.get('voice') not in speakers or request.get('response_format') != 'pcm':
            self.send_error(400, 'The fixture supports zf_006, zf_028, or zf_044 in PCM')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'audio/pcm')
        self.end_headers()

        def send_samples(samples, _progress):
            try:
                self.wfile.write(pcm(samples))
                self.wfile.flush()
                return 1
            except (BrokenPipeError, ConnectionResetError):
                return 0

        with synthesis_lock:
            tts.generate(request['input'], sid=speakers[request['voice']], speed=request.get('speed', 1), callback=send_samples)

    def send_transcript(self, data):
        mime = ('Content-Type: ' + self.headers['Content-Type'] + '\r\n\r\n').encode()
        form = BytesParser(policy=default).parsebytes(mime + data)
        audio = next(part.get_payload(decode=True) for part in form.iter_parts() if part.get_param('name', header='content-disposition') == 'file')
        with wave.open(BytesIO(audio)) as recording:
            if (recording.getframerate(), recording.getnchannels(), recording.getsampwidth()) != (16000, 1, 2):
                self.send_error(400, 'The fixture accepts 16 kHz mono PCM')
                return
            frames = np.frombuffer(recording.readframes(recording.getnframes()), dtype='<i2').astype(np.float32) / 32768
        with recognition_lock:
            stream = asr.create_stream()
            stream.accept_waveform(16000, frames)
            asr.decode_stream(stream)
            text = stream.result.text
        self.send_json({'text': text})


ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
