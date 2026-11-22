// Uses Chromium's actual resampler. No audio provider or hardware is needed.
// Run with Playwright available, or set SPIRIT_VOICE_SMOKE_PLAYWRIGHT to its package path.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPIRIT_VOICE_SMOKE_PLAYWRIGHT || 'playwright')
const source = new URL('../src/voice-audio.ts', import.meta.url)
const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex')
const build = await rolldown({ input: 'player-test', platform: 'browser', plugins: [{
  name: 'player-entry',
  resolveId(id) { if (id === 'player-test') return '\0player-test' },
  load(id) {
    if (id === '\0player-test') return `import { PcmPlayer } from ${JSON.stringify(fileURLToPath(source))}; window.PcmPlayer = PcmPlayer;`
  },
}] })
let code
try { code = (await build.generate({ format: 'iife' })).output[0].code }
finally { await build.close() }
const server = createServer((req, res) => {
  if (req.url === '/player.js') res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(code)
  else res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><script src="/player.js"></script>')
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
let browser
try {
  browser = await chromium.launch({
    executablePath: process.env.SPIRIT_VOICE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--renderer-process-limit=1'],
  })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const report = await page.evaluate(async () => {
    const inputRate = 24_000, blockSamples = 2_400, lead = 0.045
    const pcm = new Int16Array(13_731)
    for (let i = 0; i < pcm.length; i++) {
      const time = i / inputRate
      pcm[i] = Math.round(32767 * (0.28 * Math.sin(2 * Math.PI * 527 * time)
        + 0.19 * Math.sin(2 * Math.PI * 4_313 * time) + 0.11 * Math.cos(2 * Math.PI * 8_303 * time)))
    }
    const bytes = new Uint8Array(pcm.length * 2), encoded = new DataView(bytes.buffer)
    for (let i = 0; i < pcm.length; i++) encoded.setInt16(i * 2, pcm[i], true)
    const wait = async predicate => {
      const until = performance.now() + 2_000
      while (!predicate()) {
        if (performance.now() > until) throw new Error('PCM did not start with the available lookahead')
        await new Promise(resolve => setTimeout(resolve, 2))
      }
    }
    const pipe = () => {
      let writer
      const stream = new ReadableStream({ start(controller) { writer = controller } })
      return { stream, writer }
    }
    const playbackContext = (rate, length) => {
      const audio = new OfflineAudioContext(1, length, rate)
      const scheduled = [], stopped = []
      const context = {
        sampleRate: rate,
        get currentTime() { return audio.currentTime },
        destination: audio.destination,
        createBuffer: audio.createBuffer.bind(audio),
        createBufferSource() {
          const source = audio.createBufferSource(), start = source.start.bind(source), stop = source.stop.bind(source)
          source.start = (...args) => { start(...args); scheduled.push(source) }
          source.stop = (...args) => { stop(...args); stopped.push(source) }
          return source
        },
      }
      return { audio, player: new window.PcmPlayer(context), scheduled, stopped }
    }
    const measure = async (audio, rendered, rate, input) => {
      const reference = new OfflineAudioContext(1, audio.length, rate)
      const buffer = reference.createBuffer(1, input.length, inputRate)
      buffer.copyToChannel(Float32Array.from(input, sample => sample / 32768), 0)
      const source = reference.createBufferSource()
      source.buffer = buffer
      source.connect(reference.destination)
      source.start(lead)
      const expected = (await reference.startRendering()).getChannelData(0)
      let max = 0, noise = 0, power = 0
      for (let index = 0; index < rendered.length; index++) {
        const difference = rendered[index] - expected[index]
        max = Math.max(max, Math.abs(difference))
        noise += difference ** 2
        power += expected[index] ** 2
      }
      return { max, rms: Math.sqrt(noise / rendered.length), snrDb: noise ? 10 * Math.log10(power / noise) : null }
    }
    const rates = []
    for (const outputRate of [24_000, 44_100, 48_000]) {
      const length = Math.ceil((pcm.length / inputRate + 0.15) * outputRate)
      const { audio, player, scheduled } = playbackContext(outputRate, length)
      const { stream, writer } = pipe()
      const playing = player.stream(stream, new AbortController().signal, () => {})
      let offset = 0
      for (let boundary = blockSamples * 2; boundary + 2 < bytes.length; boundary += blockSamples * 2) {
        // Wait for the next buffer while only one following sample exists.
        // Its two bytes are deliberately split across wire chunks.
        writer.enqueue(bytes.subarray(offset, boundary + 1))
        writer.enqueue(bytes.subarray(boundary + 1, boundary + 2))
        offset = boundary + 2
        await wait(() => scheduled.length === boundary / (blockSamples * 2))
      }
      writer.enqueue(bytes.subarray(offset))
      writer.close()
      await wait(() => scheduled.length === Math.ceil(pcm.length / blockSamples))
      const rendered = (await audio.startRendering()).getChannelData(0)
      await playing
      rates.push({ outputRate, packetFrames: scheduled.length, ...await measure(audio, rendered, outputRate, pcm) })
    }
    const rate = 44_100
    const { audio, player, scheduled, stopped } = playbackContext(rate, rate)
    const abandoned = pipe(), signal = new AbortController()
    const first = player.stream(abandoned.stream, signal.signal, () => {}).catch(error => error.name)
    const old = new Uint8Array(blockSamples * 2 + 2).fill(0x66)
    abandoned.writer.enqueue(old)
    await wait(() => scheduled.length === 1)
    signal.abort()
    player.stop()
    abandoned.writer.error(signal.signal.reason)
    const cancelled = await first

    const next = pipe()
    const shortPcm = pcm.subarray(0, 1_731)
    const nextPlaying = player.stream(next.stream, new AbortController().signal, () => {})
    next.writer.enqueue(bytes.subarray(0, 1_009))
    next.writer.enqueue(bytes.subarray(1_009, shortPcm.length * 2))
    next.writer.close()
    await wait(() => scheduled.length === 2)
    const clean = (await audio.startRendering()).getChannelData(0)
    await nextPlaying
    const resumed = { cancelled, oldNodesStopped: stopped.length, ...await measure(audio, clean, rate, shortPcm) }

    const odd = pipe()
    odd.writer.enqueue(Uint8Array.of(1))
    odd.writer.close()
    const malformed = await player.stream(odd.stream, new AbortController().signal, () => {})
      .then(() => null, error => error.message)
    return { rates, resumed, malformed, browser: navigator.userAgent }
  })
  // The first two thresholds are >20x smaller than the released regression.
  for (const { outputRate, max, rms } of report.rates) {
    assert(max < 0.002 && rms < 0.00004, JSON.stringify({ outputRate, max, rms }))
  }
  assert.equal(report.resumed.cancelled, 'AbortError')
  assert.equal(report.resumed.oldNodesStopped, 1)
  assert(report.resumed.max < 0.002 && report.resumed.rms < 0.00004, JSON.stringify(report.resumed))
  assert.match(report.malformed, /不完整/u)
  if (process.env.SPIRIT_VOICE_PLAYBACK_REPORT) {
    await writeFile(process.env.SPIRIT_VOICE_PLAYBACK_REPORT, JSON.stringify({ sourceHash, ...report }, null, 2))
  }
  console.log(JSON.stringify({ sourceHash, ...report }))
} finally {
  await browser?.close()
  server.close()
}
