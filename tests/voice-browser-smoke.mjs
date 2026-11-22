// Requires Node, Chromium, Playwright and two configured speech endpoints.
// Run: node --experimental-transform-types tests/voice-browser-smoke.mjs
// To make both providers local, see tests/fixtures/voice-local-server.py.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { rolldown } from 'rolldown'
import { handleVoiceHttp } from '../src/voice-http.ts'
import { VoiceProviderDiscovery } from '../src/voice-providers.ts'
import { VoiceService } from '../src/voice-service.ts'
import { encodeVoiceWav } from '../src/voice-audio.ts'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const project = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = await mkdtemp(join(tmpdir(), 'spirit-voice-smoke-'))
const answer = '喂，我在听。你慢慢说就好。等你讲完，我们再一起想想，先从哪件小事开始。'
const interruption = '先等一下，我想说另一件事。'
const submitted = [], playing = [], faults = []
const ctx = { get: () => undefined }
const voice = new VoiceService({
  ctx,
  checkActive() {},
  async submit(input, signal) { signal.throwIfAborted(); submitted.push(input) },
  onPlaying(message) { playing.push(['start', message.id]); return () => { playing.push(['end', message.id]) } },
})
let browser, server
try {
  const discovery = new VoiceProviderDiscovery(ctx)
  const providers = await discovery.detect()
  assert(providers.output && providers.input, 'The smoke test needs neural TTS and ASR. Configure the voice service endpoints first.')
  const rawStream = await providers.output.stream({ id: 'mic-fixture', text: interruption }, new AbortController().signal)
  const pcm = new DataView(await new Response(rawStream).arrayBuffer())
  const lead = 1920
  const fixture = new Float32Array(lead + pcm.byteLength / 2 + 48_000)
  for (let index = 0; index < pcm.byteLength / 2; index++) fixture[lead + index] = pcm.getInt16(index * 2, true) / 32768
  const recording = join(scratch, 'microphone.wav')
  await writeFile(recording, new Uint8Array(encodeVoiceWav([fixture], 24_000)))
  discovery.close()

  await symlink(join(project, 'node_modules'), join(scratch, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const entry = join(scratch, 'entry.tsx'), bundle = join(scratch, 'voice.js')
  await writeFile(entry, `import React from 'react'
import { createRoot } from 'react-dom/client'
import { VoiceCall } from ${JSON.stringify(join(project, 'src', 'voice-client.tsx'))}
window.voiceStates = []
createRoot(document.getElementById('app')!).render(<VoiceCall onCallChange={state => window.voiceStates.push({ ...state, time: performance.now() })} />)`)
  const build = await rolldown({ input: entry, platform: 'browser' })
  try { await build.write({ file: bundle, format: 'iife' }) }
  finally { await build.close() }
  const code = await readFile(bundle)
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname
      if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><div id="app"></div><script src="/voice.js"></script>'); return }
      if (path === '/voice.js') { res.writeHead(200, { 'content-type': 'application/javascript' }).end(code); return }
      if (req.headers['x-personal-spirit'] !== '1') { res.writeHead(403).end(); return }
      if (path.endsWith('/events')) setTimeout(() => voice.delivered({ id: 'actual-delivery', text: answer, tone: 'gentle' }), 350)
      if (!await handleVoiceHttp(voice, req, res, path)) res.writeHead(404).end()
    } catch (error) { faults.push(String(error)); res.destroy() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ executablePath: process.env.SPIRIT_VOICE_SMOKE_CHROMIUM ?? '/usr/bin/chromium', headless: true, args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${recording}%noloop`,
  ] })
  const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage()
  page.on('pageerror', error => faults.push(String(error)))
  await page.addInitScript(() => {
    const actual = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (...constraints) => {
      // Start Chromium's real fake-media input after the first sound is already
      // scheduled, so this works independently of each model's warm-up time.
      await new Promise(resolve => { window.startMicrophoneFixture = resolve })
      const stream = await actual(...constraints)
      window.recordedTracks = stream.getAudioTracks()
      return stream
    }
    window.playbackStops = 0
    const stop = AudioBufferSourceNode.prototype.stop
    AudioBufferSourceNode.prototype.stop = function (...args) { window.playbackStops++; return stop.apply(this, args) }
  })
  await page.goto(origin)
  await page.getByRole('button', { name: '接通并开麦' }).click()
  await page.waitForFunction(() => window.voiceStates.some(state => state.speaking), null, { timeout: 60_000 })
  await page.evaluate(() => window.startMicrophoneFixture())
  await page.waitForFunction(() => window.playbackStops > 0 && window.voiceStates.some(state => state.listening && !state.speaking))
  for (let attempt = 0; !submitted.length && attempt < 150; attempt++) await page.waitForTimeout(100)
  assert(submitted.length > 0 && /等一下.*另一件事/u.test(submitted[0].text), JSON.stringify(submitted))
  assert.deepEqual(playing.slice(0, 2), [['start', 'actual-delivery'], ['end', 'actual-delivery']])
  await page.getByRole('button', { name: '挂断' }).click()
  await page.waitForFunction(() => window.recordedTracks.every(track => track.readyState === 'ended'))
  assert.deepEqual(faults, [])
  const report = { ...await page.evaluate(() => ({
    playbackStops: window.playbackStops,
    phases: window.voiceStates.map(({ phase, time }) => ({ phase, time })),
    tracks: window.recordedTracks.map(track => track.readyState),
  })), submitted, playing, faults }
  if (process.env.SPIRIT_VOICE_SMOKE_REPORT) await writeFile(process.env.SPIRIT_VOICE_SMOKE_REPORT, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  await browser?.close()
  voice.close()
  server?.close()
  await rm(scratch, { recursive: true, force: true })
}
