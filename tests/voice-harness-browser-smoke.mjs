// Chromium and the official Harness Web profile, with real bundled Mandarin ASR and optional PrimeTTS.
// Usage: node --experimental-transform-types tests/voice-harness-browser-smoke.mjs RUNTIME PLAYWRIGHT SCRATCH [BUILT_PACKAGE]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { LocalSpeech } from '../src/local-speech.ts'
import { installWebProfile } from './runtime-smoke.mjs'

const [runtimeArg, playwright, scratchArg, packageArg] = process.argv.slice(2)
assert(runtimeArg && playwright && scratchArg, 'Supply RUNTIME PLAYWRIGHT SCRATCH [BUILT_PACKAGE]')
const runtime = resolve(runtimeArg), scratch = resolve(scratchArg)
const project = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(packageArg ?? project)
const { chromium } = createRequire(import.meta.url)(resolve(playwright))
const binary = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const runtimeVersion = JSON.parse(readFileSync(join(dirname(binary), '../package.json'))).version
assert.equal(runtimeVersion, '0.2.2-rc.5')
assert(!existsSync(scratch), 'Use a fresh evidence directory')
assert(['lib/client.js', 'lib/index.js'].every(entry => existsSync(join(source, entry))), 'Build Spirit first')

const snapshot = join(scratch, 'package'), state = join(scratch, 'state')
const home = join(scratch, 'home'), profileName = 'spirit-browser-media'
const address = join(scratch, 'address.json'), token = randomBytes(32).toString('hex')
mkdirSync(state, { recursive: true }); mkdirSync(join(snapshot, 'node_modules'), { recursive: true })
for (const entry of ['package.json', 'cordis.patch.yml', 'lib', 'src', 'upstream', 'scripts', 'media', 'marketplace/locale']) {
  cpSync(join(source, entry), join(snapshot, entry), { recursive: true })
}
for (const entry of ['media/voice/local/tts', 'scripts/local-speech/ort']) {
  if (!existsSync(join(snapshot, entry))) cpSync(join(project, entry), join(snapshot, entry), { recursive: true })
}
cpSync(join(project, 'tests'), join(snapshot, 'tests'), { recursive: true })
const dependency = name => [join(source, 'node_modules', name), join(project, 'node_modules', name),
  join(runtime, 'node_modules', name)].find(existsSync)
for (const name of ['@deepseek-ai', '@mediapipe', 'zod', 'proper-lockfile']) {
  const link = name === '@deepseek-ai' ? join(runtime, 'node_modules/@deepseek-ai') : dependency(name)
  assert(link, `Missing dependency ${name}`)
  symlinkSync(link, join(snapshot, 'node_modules', name), 'dir')
}

async function makeRecording() {
  const speech = new LocalSpeech()
  const sampleRate = 24_000, silence = seconds => Buffer.alloc(Math.round(seconds * sampleRate) * 2)
  const words = async text => {
    const stream = await speech.synthesize({ text }, AbortSignal.timeout(30_000))
    return Buffer.from(await new Response(stream).arrayBuffer())
  }
  try {
    const first = await words('你好，你听得见我吗？')
    const second = await words('等一下，我想说另一件事。')
    const pcm = Buffer.concat([silence(1.5), first, silence(9), second, silence(2)])
    const header = Buffer.alloc(44)
    header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4)
    header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
    header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28)
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
    const recording = join(scratch, 'mic.wav')
    writeFileSync(recording, Buffer.concat([header, pcm]))
    return recording
  } finally { speech.close() }
}
const recording = await makeRecording()
await installWebProfile({ binary, home, profileName, scratch, snapshot })
writeFileSync(join(home, 'profiles', profileName, 'cordis.patch.yml'), [
  '- id: dsh-spirit', '  config:', `    stateDir: ${JSON.stringify(state)}`, '    openIntervalMinutes: 0',
  '- id: agent-default-model', '  config:', '    provider: spirit-fixture', '    model: fixture-one',
  ...['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-title-llm'].flatMap(id => [`- id: ${id}`, '  disabled: true']),
  '- insert:', '    - id: spirit-runtime-fixture', `      name: ${JSON.stringify(join(snapshot, 'tests/runtime-smoke.mjs'))}`, '',
].join('\n'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SPIRIT_(?:TTS|ASR)_|^BREEZE_API_KEY$/u.test(key)))
const child = spawn(process.execPath, [binary, '--profile', profileName, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: scratch, env: { ...env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', SPIRIT_TEST_RUNTIME: runtime,
    SPIRIT_TEST_TOKEN: token, SPIRIT_TEST_ADDRESS_FILE: address, SPIRIT_TEST_BROWSER_MEDIA: '1', SPIRIT_TTS_MODEL: 'jingshen-light' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let hostOutput = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
  hostOutput += chunk
  writeFileSync(join(scratch, 'host.log'), hostOutput.replace(/token=[A-Za-z0-9_-]+/g, 'token=[redacted]'))
})
async function poll(check, label, timeout = 25_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const result = await check()
    if (result) return result
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const api = async (origin, path) => {
  const response = await fetch(origin + path, { headers: { 'x-personal-spirit': '1', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000) })
  return response.ok ? response.json() : undefined
}
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const errors = [], requests = [], audio = []
let browser, page
try {
  const uri = await poll(() => {
    if (child.exitCode !== null) throw new Error('Harness exited before mounting')
    return existsSync(address) && hostOutput.match(/dsh web: (http:\/\/[^\s]+)/)?.[1]
  }, 'Harness Web entry', 65_000)
  const origin = new URL(uri).origin
  const chat = () => api(origin, '/personal-spirit/api/chat')
  const { mainId } = await poll(chat, 'Spirit mounted', 40_000)
  const availability = await api(origin, '/personal-spirit/api/voice/status')
  assert.deepEqual(availability.input, { name: '随包普通话识别', location: 'host-local' })
  assert.equal(availability.output.model, 'jingshen-light')
  assert.equal(availability.output.location, 'host-local')

  browser = await chromium.launch({ executablePath: process.env.SPIRIT_VOICE_SMOKE_CHROMIUM ?? '/usr/bin/chromium',
    headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${recording}%noloop`] })
  const setup = async options => {
    const context = await browser.newContext({ locale: 'zh-CN', colorScheme: 'light', permissions: ['microphone'], ...options })
    const target = await context.newPage()
    page = target
    await page.addInitScript(() => {
      window.mediaSmoke = { tracks: [], scheduled: [], stopped: [] }
      const media = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async options => {
        const stream = await media(options)
        window.mediaSmoke.tracks.push(...stream.getAudioTracks())
        return stream
      }
      const start = AudioBufferSourceNode.prototype.start
      const stop = AudioBufferSourceNode.prototype.stop
      const observed = new WeakMap()
      AudioBufferSourceNode.prototype.start = function (...args) {
        const result = start.apply(this, args)
        if (this.buffer?.sampleRate === 24_000) {
          const samples = this.buffer.getChannelData(0)
          const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
          const id = window.mediaSmoke.scheduled.length
          observed.set(this, id)
          window.mediaSmoke.scheduled.push({ id, peak, samples: samples.length, at: performance.now() })
        }
        return result
      }
      AudioBufferSourceNode.prototype.stop = function (...args) {
        const result = stop.apply(this, args), id = observed.get(this)
        if (id !== undefined) window.mediaSmoke.stopped.push({ id, at: performance.now() })
        return result
      }
    })
    page.on('pageerror', error => errors.push(String(error)))
    page.on('response', response => {
      const url = new URL(response.url())
      if (url.pathname.startsWith('/personal-spirit/api/voice/')) {
        const endpoint = url.pathname.split('/').pop()
        requests.push({ at: Date.now(), endpoint, status: response.status(), reading: url.searchParams.get('reading'),
          messageId: url.searchParams.get('message'), state: url.searchParams.get('state'),
          pcmRate: response.headers()['x-spirit-pcm-rate'] })
      }
    })
    await page.goto(uri)
    const launcher = page.locator('button.jingshen-launcher')
    const notice = page.getByRole('dialog').filter({ hasText: /Preview Notice|预览|预览版/ })
    await launcher.or(notice).first().waitFor()
    await notice.waitFor({ timeout: 4000 }).catch(() => {})
    if (await notice.isVisible()) await notice.getByRole('button', { name: /Continue|继续/ }).click()
    await launcher.click()
    return page
  }
  const desktop = await setup({ viewport: { width: 1440, height: 970 } })
  const shot = (page, name) => page.screenshot({ path: join(scratch, name + '.png'), animations: 'disabled' })
  const button = (page, name) => page.locator('.jingshen-window').getByRole('button', { name, exact: true })
  async function exchange(text, reply) {
    await page.getByRole('textbox', { name: '给精神发消息' }).fill(text)
    await button(page, '发送消息').click()
    await page.getByText(reply, { exact: false }).waitFor()
  }
  await exchange('小肥鱼，今天我们先做什么？', '我们先把手上的资料放在一起')
  await exchange('那我们先整理今天的笔记吧。', '先写下今天最重要的一件事')
  await shot(page, 'main')
  await button(page, '管理精神').click()
  await shot(page, 'panel')
  await button(page, '返回通讯').click()
  await button(page, '语音通话').click()
  const voiceStatus = target => target.locator('.spirit-voice-status')
  const published = (author, pattern) => poll(async () => (await chat()).messages.find(
    message => message.author === author && pattern.test(message.text)), `${author} publication matching ${pattern}`)
  await button(page, '接通并开麦').click()
  await poll(async () => /正在聆听/u.test(await voiceStatus(page).textContent()), 'live microphone')
  await shot(page, 'phone')
  audio.push(await published('owner', /听得见.*吗/u))
  const first = await published('spirit', /听得见，我在这里/u)
  await poll(() => requests.find(entry => entry.endpoint === 'speech' && entry.status === 200 && entry.pcmRate === '24000'),
    'real 24 kHz PrimeTTS response')
  await page.waitForFunction(() => window.mediaSmoke.scheduled.some(item => item.peak > 0.002))
  await poll(() => requests.find(entry => entry.endpoint === 'interrupt' && entry.reading === first.id && entry.status === 200),
    'second utterance barges into first playback')
  audio.push(await published('owner', /等一下.*另一件事/u))
  const second = await published('spirit', /我先听听这件新的事/u)
  await button(page, '打断朗读').click()
  await poll(() => requests.find(entry => entry.endpoint === 'interrupt' && entry.reading === second.id && entry.status === 200),
    'explicit interrupt stops the second reply')
  await button(page, '关麦').click()
  await page.waitForFunction(() => window.mediaSmoke.tracks.length === 1 &&
    window.mediaSmoke.tracks[0].readyState === 'ended')
  assert.equal(await voiceStatus(page).textContent(), '已关闭麦克风')
  await button(page, '挂断').click()
  await poll(() => requests.find(entry => entry.endpoint === 'hangup' && entry.status === 200), 'host hangup')

  const mobile = await setup({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  await button(mobile, '语音通话').click()
  await button(mobile, '接通并开麦').click()
  await poll(async () => /正在聆听/u.test(await voiceStatus(mobile).textContent()), 'live mobile-size call')
  const mobileWindow = await mobile.locator('.jingshen-window').boundingBox()
  const mobileFish = await mobile.locator('.jingshen-call-orbit .spirit-fish').boundingBox()
  assert(mobileWindow && mobileFish && mobileFish.x >= mobileWindow.x - 1
    && mobileFish.x + mobileFish.width <= mobileWindow.x + mobileWindow.width + 1, 'The call mascot fits the mobile viewport')
  await shot(mobile, 'mobile-call')
  await button(mobile, '挂断').click()
  await mobile.waitForFunction(() => window.mediaSmoke.tracks.some(track => track.readyState === 'ended'))

  const playback = await desktop.evaluate(() => ({
    ...window.mediaSmoke, tracks: window.mediaSmoke.tracks.map(track => track.readyState),
  }))
  assert(playback.stopped.length > 1 && playback.scheduled.some(item => item.peak > 0.002))
  assert(requests.filter(entry => entry.endpoint === 'audio' && entry.status === 200).length >= audio.length)
  assert.deepEqual(errors, [])
  const trace = await api(origin, '/__spirit-fixture/trace')
  const decisions = trace.trace.filter(entry => entry.sessionId === mainId && entry.purpose === 'spirit-mediation')
  assert(decisions.filter(entry => entry.decision === 'publish').length >= 4)
  const report = join(scratch, 'report.json')
  writeFileSync(report, JSON.stringify({
    passed: true, runtimeVersion, chromium: browser.version(), package: JSON.parse(readFileSync(join(snapshot, 'package.json'))).version,
    platform: process.platform, build: { server: digest(join(snapshot, 'lib/index.js')), client: digest(join(snapshot, 'lib/client.js')) },
    availability, speechRecognition: audio, publishedReplies: [first, second], decisions, requests, playback,
    screenshots: ['main.png', 'panel.png', 'phone.png', 'mobile-call.png'],
    scope: 'Model replies came from a deterministic local fixture. Mandarin speech used the bundled recognizer, optional PrimeTTS, and Chromium file-backed microphone and Web Audio.',
  }, null, 2))
  console.log(report)
} catch (error) {
  await page?.screenshot({ path: join(scratch, 'browser-failure.png') }).catch(() => {})
  writeFileSync(join(scratch, 'failure.json'), JSON.stringify({ errors, requests, audio }, null, 2))
  process.stderr.write(`Voice smoke evidence directory ${scratch}\n`)
  throw error
} finally {
  await browser?.close()
  child.kill('SIGTERM')
}
