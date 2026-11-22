const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const sampleRate = 16_000
const maxSamples = 25 * sampleRate
const assets = {
  'model.int8.onnx': '68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a',
  'tokens.txt': '6fed8c6c248516f38e7faa19404b57413e8ce259f1cbc1fa4aebc86eac32fdfd',
}

function createRecognizer(sherpa, directory) {
  for (const [file, expected] of Object.entries(assets)) {
    const digest = createHash('sha256').update(readFileSync(join(directory, file))).digest('hex')
    if (digest !== expected) throw new Error('本地普通话识别模型不完整，请重新安装精神插件')
  }
  return new sherpa.OnlineRecognizer({
    featConfig: { sampleRate, featureDim: 80 },
    modelConfig: {
      zipformer2Ctc: { model: join(directory, 'model.int8.onnx') },
      tokens: join(directory, 'tokens.txt'),
      numThreads: 1,
      provider: 'cpu',
    },
    decodingMethod: 'greedy_search',
    enableEndpoint: false,
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

  // Add enough trailing silence for the streaming encoder's final context window.
  const samples = new Float32Array(audio.length / 2 + sampleRate / 2)
  for (let offset = 0; offset < audio.length; offset += 2) {
    samples[offset / 2] = audio.readInt16LE(offset) / 32768
  }
  return samples
}

function recognize(recognizer, wavBuffer) {
  const samples = decodeWave(wavBuffer)
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples, sampleRate })
  stream.inputFinished()
  while (recognizer.isReady(stream)) recognizer.decode(stream)
  return recognizer.getResult(stream).text.trim()
}

module.exports = { createRecognizer, recognize }
