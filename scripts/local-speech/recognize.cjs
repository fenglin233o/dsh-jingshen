const { createHash } = require('node:crypto')
const { closeSync, openSync, readSync } = require('node:fs')
const { join } = require('node:path')

const sampleRate = 16_000
const maxSamples = 25 * sampleRate
const minSamples = 2_400
const assets = {
  'encoder.int8.onnx': '3a60336fd877b2335069a7db46241e667f86a77656406c9d395446eb9962bfbe',
  'decoder.onnx': 'c6a045cd52d4d2693c19218f404be6e37b6130e1244814ce31fa2188e4355cb5',
  'joiner.int8.onnx': '82e88dad29301e29144565cd3b7347fa163f07ddb30ea60346b7c4c536adf4ba',
  'tokens.txt': 'ad0df596d9cc60c90795409549ccf7d1c4f901bdc060dd6b2b067d9ef2fddfaf',
  'weights-01.data': '5cee44a66cc714ce11d96d7913ad2d8cc617dc0df95f8b00e0da9cce9a4faf3b',
  'weights-02.data': '4a8486c66f1482c8e40bff272b5cb681a70fea278c0789250e8bc193dde8f9c4',
}

function createRecognizer(sherpa, directory) {
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  for (const [file, expected] of Object.entries(assets)) {
    try {
      const descriptor = openSync(join(directory, file), 'r')
      const hash = createHash('sha256')
      try {
        for (let count; (count = readSync(descriptor, buffer)) > 0;) hash.update(buffer.subarray(0, count))
      } finally {
        closeSync(descriptor)
      }
      if (hash.digest('hex') === expected) continue
    } catch { /* The model may have been removed or only partly installed. */ }
    throw new Error('本地语音识别模型不完整，请重新安装精神插件')
  }
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(directory, 'encoder.int8.onnx'),
        decoder: join(directory, 'decoder.onnx'),
        joiner: join(directory, 'joiner.int8.onnx'),
      },
      tokens: join(directory, 'tokens.txt'),
      numThreads: 1,
      provider: 'cpu',
    },
    decodingMethod: 'greedy_search',
  })
}

function decodeWave(wave) {
  const invalid = () => new Error('本地识别只接受最长 25 秒的 16 kHz 单声道 PCM WAV')
  if (!(wave instanceof Uint8Array) || wave.length < 44 || wave.length > maxSamples * 2 + 4096) throw invalid()
  const buffer = Buffer.from(wave.buffer, wave.byteOffset, wave.byteLength)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE'
    || buffer.readUInt32LE(4) !== buffer.length - 8) throw invalid()

  let format
  let audio
  for (let offset = 12; offset < buffer.length;) {
    if (offset + 8 > buffer.length) throw invalid()
    const type = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + length
    offset = end + (length % 2)
    if (offset > buffer.length) throw invalid()

    if (type === 'fmt ') {
      if (format || length < 16) throw invalid()
      format = buffer.subarray(start, end)
    }
    if (type === 'data') {
      if (audio) throw invalid()
      audio = buffer.subarray(start, end)
    }
  }

  if (!format || !audio || audio.length === 0 || audio.length % 2 !== 0 || audio.length > maxSamples * 2
    || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1
    || format.readUInt32LE(4) !== sampleRate || format.readUInt32LE(8) !== sampleRate * 2
    || format.readUInt16LE(12) !== 2 || format.readUInt16LE(14) !== 16) throw invalid()

  // Give the offline encoder enough frames even for an extremely short WAV.
  const samples = new Float32Array(Math.max(audio.length / 2, minSamples))
  for (let offset = 0; offset < audio.length; offset += 2) {
    samples[offset / 2] = audio.readInt16LE(offset) / 32768
  }
  return samples
}

function recognize(recognizer, wavBuffer) {
  const samples = decodeWave(wavBuffer)
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples, sampleRate })
  recognizer.decode(stream)
  const { text, tokens } = recognizer.getResult(stream)
  if (tokens?.includes('<unk>') || /<unk>/iu.test(text) || !/[\p{L}\p{N}]/u.test(text)) return ''
  return text.trim()
}

module.exports = { createRecognizer, recognize }
