import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { LocalSpeech } from '../src/local-speech.ts'

const require = createRequire(import.meta.url)
const { encodeCallPcm } = require('../scripts/local-speech/pcm.cjs') as { encodeCallPcm(samples: Float32Array): Buffer }

it('resamples one whole phrase to 24 kHz PCM while suppressing interpolation images', () => {
  const testTone = (frequency: number) => Float32Array.from({ length: 16_000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * i * frequency / 16_000))
  const pcm = encodeCallPcm(testTone(6_000))
  const amplitude = (frequency: number) => {
    let sine = 0
    let cosine = 0
    for (let i = 240; i < 23_760; i++) {
      const sample = pcm.readInt16LE(i * 2) / 32768
      const phase = 2 * Math.PI * i * frequency / 24_000
      sine += sample * Math.sin(phase)
      cosine += sample * Math.cos(phase)
    }
    return Math.hypot(sine, cosine) * 2 / 23_520
  }
  expect(pcm.byteLength).toBe(48_000)
  expect(amplitude(6_000)).toBeCloseTo(0.5, 3)
  expect(amplitude(10_000)).toBeLessThan(0.0003)
  expect(encodeCallPcm(new Float32Array([0, 0, 0]))).toEqual(Buffer.alloc(10))
})

function fixture(addonAvailable = true) {
  const directory = mkdtempSync(join(tmpdir(), 'spirit-local-speech-'))
  const scripts = join(directory, 'scripts')
  const modelRoot = join(directory, 'models')
  for (const folder of [join(scripts, 'ort'), join(scripts, 'pinyin'), join(modelRoot, 'tts'), join(modelRoot, 'asr')]) mkdirSync(folder, { recursive: true })
  const realScripts = new URL('../scripts/local-speech/', import.meta.url)
  for (const file of ['worker.cjs', 'pcm.cjs']) copyFileSync(new URL(file, realScripts), join(scripts, file))
  for (const file of ['pinyin/index.cjs', 'ort/ort.wasm.min.mjs', 'ort/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.wasm']) {
    writeFileSync(join(scripts, file), 'fixture')
  }
  const trace = join(directory, 'trace.txt')
  appendFileSync(trace, '')
  const addTrace = 'const log = value => require("node:fs").appendFileSync(' + JSON.stringify(trace) + ', `${process.pid}:${value}\\n`)\n'
  writeFileSync(join(scripts, 'ort.cjs'), 'exports.loadOrt = () => ({})')
  writeFileSync(join(scripts, 'addon.cjs'), 'module.exports = {}')
  writeFileSync(join(scripts, 'recognize.cjs'), addTrace + `
    exports.createRecognizer = () => ({})
    exports.recognize = (_, wav) => { log('asr'); return String(wav[0]) }
  `)
  writeFileSync(join(scripts, 'prime.cjs'), addTrace + `
    exports.createPrime = () => {
      log('prime-open')
      return { synthesize(_, text) {
        log(text)
        if (text === 'block') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000)
        return { samples: new Float32Array(16_000).fill(0.125), sampleRate: 16_000 }
      } }
    }
  `)
  const model = join(modelRoot, 'tts', 'model.onnx')
  writeFileSync(model, 'fixture')
  writeFileSync(join(modelRoot, 'tts', 'model.json'), JSON.stringify({ type: 'prime', files: ['model.onnx'] }))
  for (const file of ['model.int8.onnx', 'tokens.txt']) writeFileSync(join(modelRoot, 'asr', file), 'fixture')
  const speech = new LocalSpeech({ modelRoot, workerPath: join(scripts, 'worker.cjs'),
    addonPath: join(scripts, addonAvailable ? 'addon.cjs' : 'missing.cjs'), idleMS: 250 })
  return {
    speech,
    model,
    log: () => readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean),
    close: () => { speech.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}

const signal = new AbortController().signal

async function speechReader(speech: LocalSpeech, text: string, abort = signal) {
  const stream = await speech.synthesize({ text }, abort)
  return stream.getReader()
}

it('checks actual assets lazily and offers Prime without a native Sherpa addon', async () => {
  const f = fixture(false)
  try {
    expect(f.speech.available('tts')).toBe(true)
    expect(f.speech.available('asr')).toBe(false)
    expect(f.log()).toEqual([])
    const reader = await speechReader(f.speech, 'lazy')
    expect(f.log()).toEqual([])
    const { value } = await reader.read()
    expect(value?.byteLength).toBe(48_000)
    expect((await reader.read()).done).toBe(true)
    expect(f.log().map(line => line.split(':')[1])).toEqual(['prime-open', 'lazy'])
    rmSync(f.model)
    expect(f.speech.available('tts')).toBe(false)
  } finally { f.close() }
})

it('runs ASR while a TTS process is blocked, drops an aborted queued request and recovers after reader cancellation', async () => {
  const f = fixture()
  try {
    const blocked = await speechReader(f.speech, 'block')
    const first = blocked.read()
    await vi.waitFor(() => expect(f.log().some(line => line.endsWith(':block'))).toBe(true))
    const blockedPid = Number(f.log().find(line => line.endsWith(':block'))?.split(':')[0])
    const queuedAbort = new AbortController()
    const queued = (await speechReader(f.speech, 'queued-abort', queuedAbort.signal)).read()
    queuedAbort.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(process.kill(blockedPid, 0)).toBe(true)
    expect(await f.speech.transcribe(new Uint8Array([12, 42]).subarray(1), signal)).toBe('42')
    const work = (await speechReader(f.speech, 'after-cancel')).read()
    const later = (await speechReader(f.speech, 'fifo')).read()
    await blocked.cancel()
    expect((await first).done).toBe(true)
    expect((await work).value?.byteLength).toBe(48_000)
    expect((await later).value?.byteLength).toBe(48_000)
    await vi.waitFor(() => expect(() => process.kill(blockedPid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' })))
    expect(f.log().some(line => line.endsWith(':queued-abort'))).toBe(false)
    const restarted = Number(f.log().find(line => line.endsWith(':after-cancel'))?.split(':')[0])
    expect(restarted).not.toBe(blockedPid)
    expect(f.log().filter(line => line.startsWith(`${restarted}:`))).toEqual([
      `${restarted}:prime-open`, `${restarted}:after-cancel`, `${restarted}:fifo`,
    ])
    await vi.waitFor(() => expect(() => process.kill(restarted, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' })))
  } finally { f.close() }
})

it('rejects active and queued requests after closure and hides availability', async () => {
  const f = fixture()
  try {
    const active = (await speechReader(f.speech, 'block')).read()
    const queued = (await speechReader(f.speech, 'after-close')).read()
    const first = expect(active).rejects.toMatchObject({ name: 'AbortError' })
    const second = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(f.log().some(line => line.endsWith(':block'))).toBe(true))
    f.speech.close()
    await Promise.all([first, second])
    expect(f.speech.available('tts')).toBe(false)
    expect(f.speech.available('asr')).toBe(false)
    expect(f.log().some(line => line.endsWith(':after-close'))).toBe(false)
  } finally { f.close() }
})
