// Requires Node, Chromium, Playwright and two configured speech endpoints.
// Run: node --experimental-transform-types tests/voice-browser-smoke.mjs
// To make both providers local, see tests/fixtures/voice-local-server.py.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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
import { SpiritWindow } from ${JSON.stringify(join(project, 'src', 'spirit-ui.tsx'))}
createRoot(document.getElementById('app')!).render(<SpiritWindow renderManagement={() => null}
  renderModels={() => null} openSource={async () => {}} />)`)
  const build = await rolldown({ input: entry, platform: 'browser', transform: { jsx: 'react-jsx' }, plugins: [{
    name: 'raw',
    resolveId(source, importer) { if (source.endsWith('?raw') && importer) return resolve(dirname(importer), source) },
    async load(id) {
      if (id.endsWith('?raw')) return { code: `export default ${JSON.stringify(await readFile(id.slice(0, -4), 'utf8'))}`, moduleType: 'js' }
    },
  }] })
  try { await build.write({ file: bundle, format: 'iife' }) }
  finally { await build.close() }
  const code = await readFile(bundle)
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname
      if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script src="/voice.js"></script>'); return }
      if (path === '/voice.js') { res.writeHead(200, { 'content-type': 'application/javascript' }).end(code); return }
      const sprite = /^\/personal-spirit\/assets\/fish\/(activity|social|social-rest)\.png$/.exec(path)
      if (sprite) { res.writeHead(200, { 'content-type': 'image/png' }).end(await readFile(join(project, 'media/fish', `${sprite[1]}.png`))); return }
      if (req.headers['x-personal-spirit'] !== '1') { res.writeHead(403).end(); return }
      if (path === '/personal-spirit/api/chat') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ mainId: 'fixture-main', messages: [],
          cursor: 0, hasMore: false, nextBefore: null, presence: { activity: { kind: 'idle' } } }))
        return
      }
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
  const transcriptionResults = []
  page.on('pageerror', error => faults.push(String(error)))
  page.on('response', async response => {
    if (new URL(response.url()).pathname.endsWith('/voice/audio')) {
      transcriptionResults.push({ status: response.status(), body: await response.text().catch(() => '') })
    }
  })
  await page.addInitScript(() => {
    const actual = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    window.recordedTracks = []
    navigator.mediaDevices.getUserMedia = async (...constraints) => {
      // Start Chromium's real fake-media input after the first sound is already
      // scheduled, so this works independently of each model's warm-up time.
      if (!window.recordedTracks.length) await new Promise(resolve => { window.startMicrophoneFixture = resolve })
      const stream = await actual(...constraints)
      window.recordedTracks.push(...stream.getAudioTracks())
      return stream
    }
    window.playbackStops = 0
    const stop = AudioBufferSourceNode.prototype.stop
    AudioBufferSourceNode.prototype.stop = function (...args) { window.playbackStops++; return stop.apply(this, args) }
  })
  await page.goto(origin)
  await page.getByRole('button', { name: '打开精神通讯' }).click()
  assert.equal(await page.locator('.jingshen-footer .spirit-voice').count(), 0)
  await page.getByRole('button', { name: '语音通话' }).click()
  const phone = page.getByRole('dialog', { name: '语音通话' })
  await phone.getByRole('button', { name: '语音选项' }).click()
  await phone.getByRole('combobox', { name: '通话输出' }).waitFor()
  await phone.getByRole('button', { name: '视觉', exact: true }).click()
  await phone.getByRole('button', { name: '开启摄像头' }).waitFor()
  await phone.getByRole('button', { name: '视觉', exact: true }).click()
  const scene = await phone.locator('.jingshen-call-orbit').boundingBox()
  const fish = await phone.locator('.jingshen-call-orbit .spirit-fish').boundingBox()
  assert(Math.abs(scene.x + scene.width / 2 - (fish.x + fish.width / 2)) < 1, JSON.stringify({ scene, fish }))
  assert(Math.abs(scene.y + scene.height / 2 - (fish.y + fish.height / 2)) < 1, JSON.stringify({ scene, fish }))
  await page.getByRole('button', { name: '接通并开麦' }).click()
  const status = phone.getByRole('status').filter({ hasText: '精神正在说话' })
  await status.waitFor({ timeout: 60_000 })
  if (process.env.SPIRIT_VOICE_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SPIRIT_VOICE_SMOKE_SCREENSHOT })
  await page.evaluate(() => window.startMicrophoneFixture())
  await page.waitForFunction(() => window.playbackStops > 0)
  await status.waitFor({ state: 'hidden' })
  const heardInterruption = () => /等一下.*另一件事/u.test(submitted.map(message => message.text).join(''))
  for (let attempt = 0; !heardInterruption() && attempt < 450; attempt++) await page.waitForTimeout(100)
  assert(heardInterruption(), JSON.stringify({ submitted, transcriptionResults, faults }))
  assert.deepEqual(playing.slice(0, 2), [['start', 'actual-delivery'], ['end', 'actual-delivery']])
  await phone.getByRole('button', { name: '关麦' }).click()
  await page.waitForFunction(() => window.recordedTracks[0]?.readyState === 'ended')
  await phone.getByRole('button', { name: '开麦' }).click()
  await page.waitForFunction(() => window.recordedTracks[1]?.readyState === 'live')
  await page.getByRole('button', { name: '挂断' }).click()
  await page.waitForFunction(() => window.recordedTracks.every(track => track.readyState === 'ended'))
  await phone.getByRole('button', { name: '返回通讯' }).click()
  await page.getByRole('textbox', { name: '给精神发消息' }).waitFor()
  assert.deepEqual(faults, [])
  const report = { ...await page.evaluate(() => ({
    playbackStops: window.playbackStops,
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
