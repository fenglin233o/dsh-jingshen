// Chromium and the official Harness Web profile, with real bundled speech recognition.
// Usage: node --experimental-transform-types tests/voice-harness-browser-smoke.mjs RUNTIME PLAYWRIGHT SCRATCH [BUILT_PACKAGE]
// Set SPIRIT_VOICE_SMOKE_BILINGUAL=1 to include English and mixed speech using FFmpeg with libflite.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { LocalSpeech } from '../src/local-speech.ts'
import { installWebProfile } from './runtime-smoke.mjs'

const [runtimeArg, playwright, scratchArg, packageArg] = process.argv.slice(2)
assert(runtimeArg && playwright && scratchArg, 'Supply RUNTIME PLAYWRIGHT SCRATCH [BUILT_PACKAGE]')
const runtime = resolve(runtimeArg), scratch = resolve(scratchArg)
const project = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(packageArg ?? project)
const bilingual = process.env.SPIRIT_VOICE_SMOKE_BILINGUAL === '1'
const sampleRate = 24_000
const ttsModel = bilingual ? 'smoke-bilingual' : 'jingshen-light'
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
  const words = bilingual ? ['你好，你听得见我吗？', 'Wait a moment. I have another question.',
    '帮我 check the calendar 然后告诉我几点'] : ['你好，你听得见我吗？', '等一下，我想说另一件事。']
  try {
    const clips = []
    for (const text of words) clips.push(await fixturePcm(speech, text))
    const transients = [sampleRate * 0.7, sampleRate * 1.5]
    const pcm = Buffer.alloc(2 * sampleRate * 60)
    let seed = 42
    for (let i = 0; i < pcm.length / 2; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const noise = (seed / 2 ** 31 - 1) * 0.006
      const hum = 0.004 * Math.sin(2 * Math.PI * 120 * i / sampleRate)
      const transient = transients.find(start => i >= start && i < start + sampleRate * 0.02)
      const tap = transient === undefined ? 0 : (seed / 2 ** 31 - 1) * 0.3 * (1 - (i - transient) / (sampleRate * 0.02))
      pcm.writeInt16LE(Math.round(32768 * (noise + hum + tap)), i * 2)
    }
    const tap = Buffer.alloc(2 * sampleRate * 0.02)
    for (let i = 0; i < tap.length / 2; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      tap.writeInt16LE(Math.round(32768 * (seed / 2 ** 31 - 1) * 0.3 * (1 - 2 * i / tap.length)), 2 * i)
    }
    const header = Buffer.alloc(44)
    header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4)
    header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
    header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28)
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
    const recording = join(scratch, 'mic.wav')
    writeFileSync(recording, Buffer.concat([header, pcm]))
    return { recording, words, clips, tap, transientOffsetsMs: transients.map(sample => sample * 1000 / sampleRate) }
  } finally { speech.close() }
}
const run = promisify(execFile)
async function englishPcm(text) {
  assert(/^[A-Za-z ,.?!]+$/u.test(text), 'The English fixture must pass plain text to Flite')
  const escaped = text.replaceAll(',', '\\,')
  const { stdout } = await run(process.env.SPIRIT_VOICE_SMOKE_FFMPEG ?? 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `flite=text=${escaped}:voice=slt`,
    '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-',
  ], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 10_000 })
  return stdout
}
async function mandarinPcm(speech, text) {
  const stream = await speech.synthesize({ text }, AbortSignal.timeout(30_000))
  return Buffer.from(await new Response(stream).arrayBuffer())
}
function trimPcm(audio) {
  let start = 0, end = audio.length
  while (start < end && Math.abs(audio.readInt16LE(start)) < 256) start += 2
  while (end > start && Math.abs(audio.readInt16LE(end - 2)) < 256) end -= 2
  const padding = Math.round(sampleRate * 0.035) * 2
  return audio.subarray(Math.max(0, start - padding), Math.min(audio.length, end + padding))
}
async function fixturePcm(speech, text) {
  if (!/[A-Za-z]/u.test(text)) return mandarinPcm(speech, text)
  if (!/\p{Script=Han}/u.test(text)) return englishPcm(text)
  const clips = []
  for (const segment of text.match(/[A-Za-z]+(?: [A-Za-z]+)*|[\p{Script=Han}，。！？]+/gu)) {
    const pcm = /[A-Za-z]/u.test(segment) ? await englishPcm(segment) : await mandarinPcm(speech, segment)
    clips.push(trimPcm(pcm))
  }
  return Buffer.concat(clips)
}
const { clips, tap, ...microphone } = await makeRecording()
await installWebProfile({ binary, home, profileName, scratch, snapshot })
writeFileSync(join(home, 'profiles', profileName, 'cordis.patch.yml'), [
  '- id: dsh-spirit', '  config:', `    stateDir: ${JSON.stringify(state)}`, '    openIntervalMinutes: 0',
  '- id: agent-default-model', '  config:', '    provider: spirit-fixture', '    model: fixture-one',
  ...['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-title-llm'].flatMap(id => [`- id: ${id}`, '  disabled: true']),
  '- insert:', '    - id: spirit-runtime-fixture', `      name: ${JSON.stringify(join(snapshot, 'tests/runtime-smoke.mjs'))}`, '',
].join('\n'))
const synthesisRequests = []
const fixtureSpeech = bilingual ? new LocalSpeech() : undefined
const fixtureTts = bilingual ? createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/audio/speech') { res.writeHead(404).end(); return }
  try {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    assert.equal(body.model, ttsModel)
    assert.equal(body.response_format, 'pcm')
    assert.equal(body.voice, 'slt')
    const pcm = await fixturePcm(fixtureSpeech, body.input)
    synthesisRequests.push({ ...body, bytes: pcm.length })
    res.writeHead(200, { 'content-type': 'audio/pcm' }).end(pcm)
  } catch (error) { res.writeHead(500).end(String(error)) }
}) : undefined
if (fixtureTts) await new Promise(ready => fixtureTts.listen(0, '127.0.0.1', ready))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(?:SPIRIT|JINGSHEN)_(?:TTS|ASR)_|^BREEZE_API_KEY$/u.test(key)))
const fixtureTtsEnv = fixtureTts ? {
  SPIRIT_TTS_BASE_URL: `http://127.0.0.1:${fixtureTts.address().port}/v1`, SPIRIT_TTS_PROTOCOL: 'openai',
  SPIRIT_TTS_VOICE: 'slt', SPIRIT_TTS_STYLE: 'instructions',
} : undefined
const child = spawn(process.execPath, [binary, '--profile', profileName, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: scratch, env: { ...env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', SPIRIT_TEST_RUNTIME: runtime,
    SPIRIT_TEST_TOKEN: token, SPIRIT_TEST_ADDRESS_FILE: address, SPIRIT_TEST_BROWSER_MEDIA: '1', SPIRIT_TTS_MODEL: ttsModel,
    ...fixtureTtsEnv },
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
const readPlayback = target => target.evaluate(() => ({
  ...window.mediaSmoke, nowPlaying: undefined, feed: undefined,
  tracks: window.mediaSmoke.tracks.map(track => track.readyState), fileTracks: window.mediaSmoke.fileTracks.map(track => track.readyState),
}))
const errors = [], requests = [], postedWavs = [], audio = []
let browser, page, desktop
try {
  const uri = await poll(() => {
    if (child.exitCode !== null) throw new Error('Harness exited before mounting')
    return existsSync(address) && hostOutput.match(/dsh web: (http:\/\/[^\s]+)/)?.[1]
  }, 'Harness Web entry', 65_000)
  const origin = new URL(uri).origin
  const chat = () => api(origin, '/personal-spirit/api/chat')
  const { mainId } = await poll(chat, 'Spirit mounted', 40_000)
  const availability = await api(origin, '/personal-spirit/api/voice/status')
  assert.equal(availability?.input?.location, 'host-local')
  assert.equal(availability.input.name, '随包中英语音识别')
  assert.equal(availability.output.model, ttsModel)
  assert.equal(availability.output.location, 'host-local')

  browser = await chromium.launch({ executablePath: process.env.SPIRIT_VOICE_SMOKE_CHROMIUM ?? '/usr/bin/chromium',
    headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${microphone.recording}%noloop`] })
  const setup = async options => {
    const context = await browser.newContext({ locale: 'zh-CN', colorScheme: 'light', permissions: ['microphone'], ...options })
    const target = await context.newPage()
    page = target
    await page.addInitScript(captureRate => {
      const sources = new Map()
      const injected = new WeakSet()
      const playing = ({ source, begins, ends }) => source.context.state === 'running'
        && source.context.currentTime >= begins && source.context.currentTime < ends
      window.mediaSmoke = { tracks: [], fileTracks: [], scheduled: [], stopped: [], phases: [], inputs: [],
        nowPlaying: (lead = 0) => {
          const active = [...sources.values()].find(entry => entry.peak > 0.002 && playing(entry))
          return !!active && [...sources.values()].some(entry => entry.source.context === active.source.context
            && entry.ends - active.source.context.currentTime >= lead)
        } }
      const media = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async options => {
        const stream = await media(options)
        if (!options.audio) return stream
        // Keep Chromium's file microphone live and mix in the prerecorded
        // utterances at the same moments a caller would choose to speak.
        const mixer = new AudioContext()
        const destination = mixer.createMediaStreamDestination()
        const microphone = mixer.createMediaStreamSource(stream)
        microphone.connect(destination)
        await mixer.resume()
        window.mediaSmoke.captureReady = Date.now()
        const track = destination.stream.getAudioTracks()[0]
        const fileTracks = stream.getAudioTracks()
        const stop = track.stop.bind(track)
        track.stop = () => {
          stop()
          for (const fileTrack of fileTracks) fileTrack.stop()
          void mixer.close()
        }
        window.mediaSmoke.feed = (base64, label) => {
          const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
          const pcm = new Int16Array(bytes.buffer)
          const audio = mixer.createBuffer(1, pcm.length, captureRate)
          audio.copyToChannel(Float32Array.from(pcm, sample => sample / 32768), 0)
          const source = mixer.createBufferSource()
          source.buffer = audio
          source.connect(destination)
          injected.add(source)
          window.mediaSmoke.inputs.push({ label, at: Date.now() })
          source.start()
        }
        window.mediaSmoke.fileTracks.push(...fileTracks)
        window.mediaSmoke.tracks.push(track)
        return destination.stream
      }
      new MutationObserver(() => {
        const phase = document.querySelector('.spirit-voice-status')?.textContent
        if (phase && window.mediaSmoke.phases.at(-1)?.phase !== phase) {
          window.mediaSmoke.phases.push({ phase, at: Date.now() })
        }
      }).observe(document, { childList: true, characterData: true, subtree: true })
      const start = AudioBufferSourceNode.prototype.start
      const stop = AudioBufferSourceNode.prototype.stop
      AudioBufferSourceNode.prototype.start = function (...args) {
        const result = start.apply(this, args)
        if (this.buffer?.sampleRate === captureRate && !injected.has(this)) {
          const samples = this.buffer.getChannelData(0)
          const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
          const id = window.mediaSmoke.scheduled.length
          const begins = Math.max(args[0] ?? 0, this.context.currentTime)
          const duration = args[2] ?? this.buffer.duration - (args[1] ?? 0)
          const entry = { id, peak, samples: samples.length, at: Date.now(), begins, ends: begins + duration }
          sources.set(this, { ...entry, source: this })
          this.addEventListener('ended', () => sources.delete(this), { once: true })
          window.mediaSmoke.scheduled.push(entry)
        }
        return result
      }
      AudioBufferSourceNode.prototype.stop = function (...args) {
        const observed = sources.get(this)
        const wasPlaying = observed && playing(observed)
        const result = stop.apply(this, args)
        if (observed) {
          sources.delete(this)
          window.mediaSmoke.stopped.push({ id: observed.id, at: Date.now(), wasPlaying })
        }
        return result
      }
    }, sampleRate)
    page.on('pageerror', error => errors.push(String(error)))
    page.on('request', request => {
      const url = new URL(request.url())
      if (!url.pathname.startsWith('/personal-spirit/api/voice/')) return
      const endpoint = url.pathname.split('/').pop()
      if (endpoint === 'audio') postedWavs.push(request.postDataBuffer())
      requests.push({ at: Date.now(), endpoint, stage: 'request',
        reading: url.searchParams.get('reading'), messageId: url.searchParams.get('message'),
        state: url.searchParams.get('state'), callId: url.searchParams.get('call'), language: url.searchParams.get('language') })
    })
    page.on('response', response => {
      const url = new URL(response.url())
      if (url.pathname === '/personal-spirit/assets/voice/vad/fvad.wasm') {
        requests.push({ at: Date.now(), endpoint: 'fvad.wasm', stage: 'response',
          status: response.status(), contentType: response.headers()['content-type'] })
      }
      if (url.pathname.startsWith('/personal-spirit/api/voice/')) {
        const endpoint = url.pathname.split('/').pop()
        requests.push({ at: Date.now(), endpoint, stage: 'response', status: response.status(), reading: url.searchParams.get('reading'),
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
  desktop = await setup({ viewport: { width: 1440, height: 970 } })
  const shot = (page, name) => page.screenshot({ path: join(scratch, name + '.png'), animations: 'disabled' })
  const button = (page, name) => page.locator('.jingshen-window').getByRole('button', { name, exact: true })
  async function exchange(text, reply) {
    await page.getByRole('textbox', { name: '给精神发消息' }).fill(text)
    await button(page, '发送消息').click()
    await page.getByText(reply, { exact: false }).waitFor()
  }
  await exchange('小肥鱼，今天我们先做什么？', '我们先把手上的资料放在一起')
  await exchange('那我们先整理今天的笔记吧。', '先写下今天最重要的一件事')
  assert.equal(await button(page, '视觉').count(), 0, 'Chat has no visual entry')
  await shot(page, 'main')
  await button(page, '管理精神').click()
  await shot(page, 'panel')
  await button(page, '返回通讯').click()
  await button(page, '语音通话').click()
  await button(page, '视觉').waitFor()
  await button(page, '视觉').click()
  await button(page, '开启摄像头').waitFor()
  await button(page, '共享屏幕').waitFor()
  await button(page, '视觉').click()
  await button(page, '语音选项').click()
  await page.getByRole('combobox', { name: '通话输出' }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: '转写语言' }).count(), 0)
  await button(page, '语音选项').click()
  const voiceStatus = target => target.locator('.spirit-voice-status')
  const onlyRequests = endpoint => requests.filter(entry => entry.endpoint === endpoint && entry.stage === 'request')
  const feed = (pcm, label) => page.evaluate(({ data, label }) => window.mediaSmoke.feed(data, label), { data: pcm.toString('base64'), label })
  const voicePhase = (target, phase) => voiceStatus(target).filter({ hasText: new RegExp(`^${phase}$`, 'u') }).waitFor()
  const published = (author, pattern) => poll(async () => (await chat()).messages.find(
    message => message.author === author && pattern.test(message.text)), `${author} publication matching ${pattern}`)
  const writtenMessages = (await chat()).messages.filter(message => message.author === 'owner').length
  const recognized = (index, expected) => poll(async () => {
    const message = (await chat()).messages.filter(entry => entry.author === 'owner')[writtenMessages + index]
    if (!message) return
    const variants = { 幫: '帮', 聽: '听', 見: '见', 嗎: '吗', 說: '说', 後: '后', 訴: '诉', 幾: '几', 點: '点' }
    const speechText = text => text.toLowerCase().replace(/[幫聽見嗎說後訴幾點]/gu, char => variants[char])
      .replace(/\p{P}/gu, ' ').replace(/(?<=\p{Script=Han})\s+|\s+(?=\p{Script=Han})/gu, '')
      .trim().replace(/\s+/gu, ' ')
    assert.equal(speechText(message.text), speechText(expected))
    return message
  }, `utterance ${index + 1} publication`)
  await button(page, '接通并开麦').click()
  await voicePhase(page, '等你开口')
  assert(requests.every(entry => entry.language == null), 'The browser did not send a language hint')
  assert(requests.some(entry => entry.endpoint === 'fvad.wasm' && entry.status === 200
    && entry.contentType === 'application/wasm'), 'The packaged WebRTC voice detector loaded in Chromium')
  await shot(page, 'phone')
  await page.waitForFunction(() => Date.now() - window.mediaSmoke.captureReady >= 2400)
  assert.equal(await voiceStatus(page).textContent(), '等你开口')
  assert.equal(onlyRequests('audio').length, 0, 'Initial room noise and taps did not start a transcription')
  await feed(clips[0], 'first utterance')
  await voicePhase(page, '正在聆听')
  audio.push(await recognized(0, microphone.words[0]))
  const first = await published('spirit', /听得见，我在这里/u)
  const expectPlayback = async reply => {
    await poll(() => requests.find(entry => entry.endpoint === 'speech' && entry.messageId === reply.id
      && entry.status === 200 && entry.pcmRate === String(sampleRate)), 'real 24 kHz PCM response')
    await poll(() => requests.find(entry => entry.endpoint === 'playing' && entry.messageId === reply.id
      && entry.state === 'start' && entry.status === 200), 'host playback start')
    await page.waitForFunction(() => window.mediaSmoke.nowPlaying())
  }
  await expectPlayback(first)
  assert.equal(onlyRequests('interrupt').length, 0, 'There was no interrupt before the first reply actually played')
  assert.equal(onlyRequests('audio').length, 1, 'Idle noise and the first utterance produce only one ASR request')
  await page.waitForFunction(() => window.mediaSmoke.nowPlaying(0.8))
  await feed(tap, 'tap during playback')
  await delay(400)
  assert.equal(onlyRequests('interrupt').length, 0, 'A transient during actual playback did not interrupt')
  await page.waitForFunction(() => window.mediaSmoke.nowPlaying(0.8))
  await feed(clips[1], 'second utterance')
  const barge = await poll(() => requests.find(entry => entry.endpoint === 'interrupt' && entry.reading === first.id && entry.status === 200),
    'second utterance barges into first playback')
  assert.equal(onlyRequests('audio').length, 1, 'The interrupt precedes the second utterance submission')
  const bargePlayback = await readPlayback(page)
  assert(bargePlayback.stopped.some(item => item.wasPlaying), 'Barge-in stopped an actively playing PCM source')
  const firstListening = bargePlayback.phases.find(item => item.phase === '正在聆听')
  assert(firstListening && firstListening.at >= bargePlayback.inputs[0].at, 'The idle noise and taps did not change the call to listening')
  assert(barge.at >= bargePlayback.inputs[2].at, 'The second utterance, after the tap, triggered barge-in')
  audio.push(await recognized(1, microphone.words[1]))
  const second = await published('spirit', bilingual ? /tell me your other question/iu : /我先听听这件新的事/u)
  assert.equal(onlyRequests('interrupt').length, 1, 'Only the second utterance interrupted before manual stop')
  await expectPlayback(second)
  const manualAt = Date.now()
  await button(page, '打断朗读').click()
  await poll(() => requests.find(entry => entry.endpoint === 'interrupt' && entry.reading === second.id && entry.status === 200),
    'explicit interrupt stops the second reply')
  await page.waitForFunction(at => window.mediaSmoke.stopped.some(item => item.wasPlaying && item.at >= at), manualAt)
  const replies = [first, second]
  if (bilingual) {
    await feed(clips[2], 'third utterance')
    audio.push(await recognized(2, microphone.words[2]))
    const third = await published('spirit', /我会 check the calendar，然后告诉你时间/u)
    replies.push(third)
    await expectPlayback(third)
    await poll(() => requests.find(entry => entry.endpoint === 'playing' && entry.messageId === third.id
      && entry.state === 'end' && entry.status === 200), 'the mixed-language reply finished playing')
    assert.equal(onlyRequests('call').length, 1, 'All three utterances used the same call')
    assert.equal(new Set(onlyRequests('audio').map(entry => entry.callId)).size, 1)
  }
  await button(page, '关麦').click()
  await page.waitForFunction(() => window.mediaSmoke.tracks.length === 1 &&
    window.mediaSmoke.tracks[0].readyState === 'ended' && window.mediaSmoke.fileTracks[0].readyState === 'ended')
  await voicePhase(page, '已关闭麦克风')
  assert.equal(onlyRequests('interrupt').length, 2)
  assert.equal(onlyRequests('audio').length, microphone.words.length, 'Only the expected utterances reached bundled ASR')
  await button(page, '挂断').click()
  await poll(() => requests.find(entry => entry.endpoint === 'hangup' && entry.status === 200), 'host hangup')
  await button(page, '返回通讯').click()
  assert.equal(await button(page, '视觉').count(), 0, 'Returning to chat hides the visual entry')

  const mobile = await setup({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  await button(mobile, '语音通话').click()
  await button(mobile, '视觉').waitFor()
  await button(mobile, '接通并开麦').click()
  await voicePhase(mobile, '等你开口')
  const mobileWindow = await mobile.locator('.jingshen-window').boundingBox()
  const mobileFish = await mobile.locator('.jingshen-call-orbit .spirit-fish').boundingBox()
  assert(mobileWindow && mobileFish && mobileFish.x >= mobileWindow.x - 1
    && mobileFish.x + mobileFish.width <= mobileWindow.x + mobileWindow.width + 1, 'The call mascot fits the mobile viewport')
  await shot(mobile, 'mobile-call')
  await button(mobile, '挂断').click()
  await mobile.waitForFunction(() => window.mediaSmoke.tracks.some(track => track.readyState === 'ended'))

  const playback = await readPlayback(desktop)
  assert(playback.stopped.filter(item => item.wasPlaying).length >= 2)
  assert(requests.filter(entry => entry.endpoint === 'audio' && entry.status === 200).length >= audio.length)
  if (bilingual) {
    const instructionPrefixes = ['用自然的普通话', 'Speak naturally in English', 'Speak naturally in both Mandarin and English']
    for (const [index, reply] of replies.entries()) {
      const chunks = synthesisRequests.filter(entry => reply.text.includes(entry.input.trim()))
      assert(chunks.length > 0 && chunks.every(entry => entry.bytes > 0), 'The loopback backend synthesized every reply')
      assert(chunks.every(entry => entry.instructions?.startsWith(instructionPrefixes[index])),
        'The backend received delivery instructions matching each reply’s language')
    }
  }
  assert.deepEqual(errors, [])
  const trace = await api(origin, '/__spirit-fixture/trace')
  const decisions = trace.trace.filter(entry => entry.sessionId === mainId && entry.purpose === 'spirit-mediation')
  assert(decisions.filter(entry => entry.decision === 'publish').length >= 4)
  const asrDirectory = join(snapshot, 'media/voice/local/asr')
  const asrAssets = readdirSync(asrDirectory).filter(file => /\.(onnx|data)$/u.test(file) || file === 'tokens.txt').sort()
  assert(asrAssets.length >= 2)
  const report = join(scratch, 'report.json')
  writeFileSync(report, JSON.stringify({
    passed: true, runtimeVersion, chromium: browser.version(), package: JSON.parse(readFileSync(join(snapshot, 'package.json'))).version,
    platform: process.platform, build: {
      server: digest(join(snapshot, 'lib/index.js')), client: digest(join(snapshot, 'lib/client.js')),
      asrModel: Object.fromEntries(asrAssets.map(file => [file, digest(join(asrDirectory, file))])),
      vadWasm: digest(join(snapshot, 'media/voice/vad/fvad.wasm')),
    },
    scenario: bilingual ? 'automatic bilingual' : 'Mandarin', availability, microphone, speechRecognition: audio,
    publishedReplies: replies, decisions, requests, playback, ...(bilingual ? { synthesisRequests } : {}),
    screenshots: ['main.png', 'panel.png', 'phone.png', 'mobile-call.png'],
    scope: 'Model replies came from a deterministic local fixture. Chromium captured room noise and taps through its file microphone and mixed the timed speech clips into a real MediaStream. The application used its own VAD, bundled recognizer, and Web Audio output. '
      + (bilingual ? 'Mandarin and English speech used optional PrimeTTS and Flite via a loopback OpenAI-compatible PCM endpoint.'
        : 'Mandarin speech used the optional PrimeTTS assets.'),
  }, null, 2))
  console.log(report)
} catch (error) {
  await page?.screenshot({ path: join(scratch, 'browser-failure.png'), timeout: 5000 }).catch(() => {})
  const playback = desktop && await readPlayback(desktop).catch(() => {})
  for (const [index, wav] of postedWavs.entries()) {
    if (wav) writeFileSync(join(scratch, `asr-${index + 1}.wav`), wav)
  }
  writeFileSync(join(scratch, 'failure.json'), JSON.stringify({ bilingual, microphone, errors, requests, audio, playback, synthesisRequests }, null, 2))
  process.stderr.write(`Voice smoke evidence directory ${scratch}\n`)
  throw error
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  fixtureTts?.close()
  fixtureTts?.closeAllConnections()
  fixtureSpeech?.close()
}
