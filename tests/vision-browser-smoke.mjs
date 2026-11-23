#!/usr/bin/env node
/**
 * Real Chromium + the real rc.5 Web host. The image-capable language model is a local deterministic fixture.
 * Build Spirit first. Supply a WebM and a Y4M containing two consecutive scenes with known labels.
 * This script keeps the inputs in scratch and performs no provider or site login.
 *
 * node tests/vision-browser-smoke.mjs --runtime /path/to/rc5 --video /path/to/scenes.webm \
 *   --second-video /path/to/reversed-scenes.webm --camera /path/to/scenes.y4m \
 *   --playwright /path/to/node_modules/playwright-core
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installWebProfile } from './runtime-smoke.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index]
  assert(flag.startsWith('--') && process.argv[index + 1], 'Pass options as --name value')
  args.set(flag.slice(2), process.argv[index + 1])
}
for (const key of ['runtime', 'video', 'second-video', 'camera']) assert(args.has(key), `Required option --${key}`)
const require = createRequire(import.meta.url)
const playwright = await import(pathToFileURL(require.resolve(args.get('playwright') ?? 'playwright-core')).href)
const chromium = playwright.chromium ?? playwright.default?.chromium
assert(chromium, 'Use --playwright to point to an installed playwright-core package')
const runtime = resolve(args.get('runtime'))
const packageSource = resolve(args.get('package') ?? join(here, '..'))
const runtimeVersion = JSON.parse(readFileSync(join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'))).version
assert.equal(runtimeVersion, '0.2.2-rc.5')
assert(existsSync(join(packageSource, 'lib/index.js')), 'Build Spirit before running this smoke test')
const scratch = mkdtempSync(join(resolve(args.get('scratch-root') ?? tmpdir()), 'spirit-vision-'))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const digest = path => sha256(readFileSync(path))
const token = randomBytes(32).toString('hex')
const state = join(scratch, 'state'), address = join(scratch, 'address.json'), snapshot = join(scratch, 'package')
const home = join(scratch, 'home'), profile = join(home, 'profiles', 'spirit-vision')
for (const directory of [state, join(snapshot, 'node_modules')]) mkdirSync(directory, { recursive: true })
for (const entry of ['package.json', 'cordis.patch.yml', 'lib', 'src', 'upstream', 'scripts', 'marketplace', 'media']) {
  cpSync(join(packageSource, entry), join(snapshot, entry), { recursive: true })
}
// Cordis also discovers the declaring package of a file-based companion. Keep
// the companion inside this snapshot so it cannot select the worktree client.
cpSync(here, join(snapshot, 'tests'), { recursive: true })
symlinkSync(join(runtime, 'node_modules/@deepseek-ai'), join(snapshot, 'node_modules/@deepseek-ai'), 'dir')
for (const entry of ['@mediapipe', 'zod', 'proper-lockfile']) {
  const dependency = [join(packageSource, 'node_modules', entry), join(here, '../node_modules', entry),
    join(runtime, 'node_modules', entry)].find(existsSync)
  assert(dependency, `Missing dependency ${entry}`)
  symlinkSync(dependency, join(snapshot, 'node_modules', entry), 'dir')
}
const binary = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
await installWebProfile({ binary, home, profileName: 'spirit-vision', scratch, snapshot })
writeFileSync(join(profile, 'cordis.patch.yml'), [
  '- id: dsh-spirit', '  config:', `    stateDir: ${JSON.stringify(state)}`, '    openIntervalMinutes: 0.08',
  '- id: agent-default-model', '  config:', '    provider: spirit-fixture', '    model: fixture-one',
  ...['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-title-llm'].flatMap(id => [`- id: ${id}`, '  disabled: true']),
  '- insert:', '    - id: spirit-runtime-fixture', `      name: ${JSON.stringify(join(snapshot, 'tests/runtime-smoke.mjs'))}`, '',
].join('\n'))
const child = spawn(process.execPath, [binary,
  '--profile', 'spirit-vision', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: scratch, env: { ...process.env, DSH_HOME: home, SPIRIT_TEST_RUNTIME: runtime, SPIRIT_TEST_TOKEN: token,
    SPIRIT_TEST_ADDRESS_FILE: address, SPIRIT_TEST_IMAGE_FIXTURE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
  output += data
  writeFileSync(join(scratch, 'host.log'), output.replace(/token=[A-Za-z0-9_-]+/g, 'token=[redacted]'))
})

async function poll(check, label, ms = 18_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const value = await check()
    if (value) return value
    await delay(120)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

let origin, browser, https, page
const browserErrors = []
async function api(route, data, fixture = false) {
  const response = await fetch(origin + (fixture ? '/__spirit-fixture' : '/personal-spirit/api') + route, {
    method: data === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(30_000),
    headers: { 'x-personal-spirit': '1', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const result = await response.json()
  assert(response.ok, JSON.stringify(result))
  return result
}
async function nativeTool(sessionId, name, args) {
  const id = randomUUID()
  const { events } = await api('/turn', { sessionId, script: { id, calls: [{ name, args }] } }, true)
  const result = events.findLast(event => event.type === 'tool/result' && event.data.message.toolCallId === `spirit-fixture:${id}:0`)
  const text = result?.data.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  assert(result && !result.data.message.isError, text)
  return JSON.parse(text)
}
const labels = frame => frame?.detections.map(item => item.label) ?? []
const observations = []
try {
  origin = await poll(() => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Harness exited before mounting')
    return existsSync(address) && JSON.parse(readFileSync(address, 'utf8')).origin
  }, 'host readiness', 55_000)
  const uri = await poll(() => output.match(/dsh web: (http:\/\/[^\s]+)/)?.[1], 'Web entry')
  const { mainId } = await poll(async () => {
    const response = await fetch(origin + '/personal-spirit/api/state', {
      headers: { 'x-personal-spirit': '1', authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
    })
    return response.ok && response.json()
  }, 'Spirit full mount', 40_000)
  const file = resolve(args.get('video'))
  const key = join(scratch, 'fixture-key.pem'), cert = join(scratch, 'fixture-cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=vision-media.test'], { stdio: 'ignore' })
  const firstVideo = readFileSync(file), secondVideo = readFileSync(resolve(args.get('second-video')))
  assert(!firstVideo.equals(secondVideo), 'Use two distinct test clips')
  const videoRequests = []
  https = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (request, response) => {
    videoRequests.push({ path: request.url, host: request.headers.host, hasCookie: Boolean(request.headers.cookie) })
    if (request.url === '/redirect.webm') {
      response.writeHead(302, { location: 'https://ungranted-media.test/bypass.webm', 'access-control-allow-origin': '*' })
      response.end()
      return
    }
    const bytes = request.url === '/second.webm' ? secondVideo : firstVideo
    response.writeHead(200, { 'content-type': 'video/webm', 'content-length': bytes.length, 'access-control-allow-origin': '*' })
    response.end(bytes)
  })
  await new Promise(resolveListen => https.listen(0, '127.0.0.1', resolveListen))
  const mediaPort = https.address().port
  browser = await chromium.launch({ executablePath: args.get('chromium') ?? '/usr/bin/chromium', headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-proxy-server',
      `--host-resolver-rules=MAP vision-media.test 127.0.0.1:${mediaPort}, MAP ungranted-media.test 127.0.0.1:${mediaPort}`,
      `--use-file-for-fake-video-capture=${resolve(args.get('camera'))}`] })
  const context = await browser.newContext({ locale: 'zh-CN', permissions: ['camera'], ignoreHTTPSErrors: true })
  await context.addCookies([{ name: 'vision_fixture', value: 'must-not-be-sent', domain: 'vision-media.test',
    path: '/', secure: true, sameSite: 'None' }])
  page = await context.newPage()
  page.on('pageerror', error => browserErrors.push(String(error)))
  page.on('console', entry => { if (entry.type() === 'error') browserErrors.push(entry.text()) })
  let servedClientSha256
  // rc.5 concatenates each package-local client unchanged except for trailing source directives.
  const expectedClient = readFileSync(join(snapshot, 'lib/client.js'), 'utf8')
    .replace(/(?:\r?\n)?\/\/# sourceURL=[^\r\n]*(?:\r?\n)?$/, '')
    .replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, '')
  assert(expectedClient.includes('minimizedRef'), 'Build the client with minimized vision support before running this smoke')
  page.on('response', response => {
    const address = new URL(response.url())
    if (address.origin !== origin) return
    if (response.status() >= 400) {
      browserErrors.push(`HTTP ${response.status()} ${address.pathname}`)
      if (address.pathname.startsWith('/personal-spirit/api/vision')) {
        void response.text().then(text => browserErrors.push(text)).catch(() => {})
      }
    }
    if (!response.headers()['content-type']?.includes('javascript')) return
    void response.text().then(source => {
      const start = source.indexOf(expectedClient)
      if (start >= 0) servedClientSha256 = sha256(source.slice(start, start + expectedClient.length))
    }).catch(() => {})
  })
  page.on('requestfinished', request => {
    if (new URL(request.url()).pathname !== '/personal-spirit/api/vision/frame') return
    const { capturedAt, detections, mediaTime, seq, data } = request.postDataJSON()
    observations.push({ capturedAt, receivedAt: Date.now(), labels: detections.map(item => item.label), mediaTime, seq, foundPixels: !!data })
  })
  await page.goto(uri)
  const notice = page.getByRole('dialog').filter({ hasText: /Preview Notice|预览/u })
  const launcher = page.locator('button.jingshen-launcher')
  const controls = page.locator('.spirit-vision')
  const panel = controls.locator('.spirit-vision-controls')
  const vision = controls.getByRole('button', { name: /^视觉(?:已开启)?$/ })
  const openWindow = async () => {
    if (await launcher.getAttribute('aria-expanded') !== 'true') await launcher.click()
    if (!await page.locator('.jingshen-window[data-phone]').isVisible()) {
      await page.getByRole('button', { name: '语音通话', exact: true }).click()
    }
    await vision.waitFor()
    if (await vision.getAttribute('aria-expanded') !== 'true') await vision.click()
  }
  await launcher.or(notice).first().waitFor()
  await notice.waitFor({ timeout: 4000 }).catch(() => {})
  if (await notice.isVisible()) await notice.getByRole('button', { name: /Continue|继续/u }).click()
  await openWindow()
  await poll(() => servedClientSha256, 'the browser receives the exact client JavaScript from this snapshot')
  const preview = controls.locator('video')
  const minimize = () => page.getByRole('button', { name: '缩小窗口', exact: true }).click()
  const phonePose = page.locator('.jingshen-launcher .spirit-fish[data-scene="video"]')
  const status = () => api('/vision')
  assert.equal((await status()).active, false)
  const firstLabel = args.get('first-label') ?? 'dog', secondLabel = args.get('second-label') ?? 'person'
  async function playback(name, play = {}, from = firstLabel, to = secondLabel, autonomous = false) {
    await poll(async () => (await status()).authorizedVideo, `${name} authorization`)
    assert.equal((await status()).watching, false)
    let dispatchId
    if (autonomous) {
      await page.getByRole('button', { name: '返回通讯', exact: true }).click()
      await poll(async () => !(await launcher.getAttribute('aria-label')).includes('未读'), 'opening chat acknowledges its transcript')
      await openWindow()
      await minimize()
      assert.equal(await panel.isVisible(), false)
      assert.equal((await status()).authorizedVideo, true, 'minimizing keeps the selected authorized video library')
      assert.equal(await phonePose.isVisible(), false, 'authorization alone cannot put the compact fish on its phone')
      await api('/behavior', { autonomy: 'vision-play', url: play.url }, true)
      const received = await poll(async () => (await api('/trace', undefined, true)).trace.find(entry =>
        entry.dispatchId && entry.call?.name === 'jingshen_watch' && entry.call.args.url === play.url),
      'full-access idle opportunity chooses a native play operation without new owner input')
      dispatchId = received.dispatchId
      await api('/behavior', { autonomy: 'ack' }, true)
    } else {
      assert.deepEqual(await nativeTool(mainId, 'jingshen_watch', { action: 'play', ...play }), { requested: 'play', watching: false })
    }
    const next = label => poll(async () => {
      const value = await status()
      return value.watching && labels(value.reading).includes(label) && value.reading
    }, `${name} recognizes ${label} while media time advances`)
    const first = await next(from)
    assert.equal((await api('/chat')).presence.activity.kind, 'phone')
    if (autonomous) {
      await phonePose.waitFor({ state: 'visible' })
      await page.screenshot({ path: join(scratch, 'minimized-watching.png') })
      assert.equal(await panel.isVisible(), false, 'the video advances while the fish window remains minimized')
    }
    const second = await next(to)
    assert(second.seq > first.seq && second.mediaTime > first.mediaTime)
    const observed = await nativeTool(mainId, 'jingshen_vision', {})
    assert(observed.hasNewObservation && observed.reading.seq >= second.seq)
    if (autonomous) {
      await openWindow()
      assert.equal(await panel.isVisible(), true)
      assert.equal((await status()).watching, true, 'opening again keeps the same authorized playback instance')
    }
    assert.deepEqual(await nativeTool(mainId, 'jingshen_watch', { action: 'stop' }), { requested: 'stop', watching: false })
    await poll(async () => !(await status()).watching && await preview.evaluate(video => video.paused), `${name} actual player stop`)
    assert.notEqual((await api('/chat')).presence.activity.kind, 'phone')
    return { first, second, receivedByNativeTool: observed.reading, ...(dispatchId ? {
      dispatchId, minimizedPlayback: true, minimizedPhoneScreenshot: join(scratch, 'minimized-watching.png'),
    } : {}) }
  }
  async function stopSharing() {
    await controls.getByRole('button', { name: '停止视觉', exact: true }).click()
    await poll(async () => !(await status()).active, 'visual lease release')
  }

  await controls.getByLabel('授权精神观看本地视频').setInputFiles(file)
  const local = await playback('local file')
  await stopSharing()
  await controls.getByLabel('HTTPS 视频直链').fill(`https://127.0.0.1:${mediaPort}/fixture.webm`)
  await controls.getByRole('button', { name: '授权精神观看网络视频', exact: true }).click()
  await poll(async () => (await status()).authorizedVideo, 'HTTPS authorization')
  assert.equal(videoRequests.length, 0)
  const remote = await playback('HTTPS direct media')
  assert(videoRequests.length > 0)
  await stopSharing()

  await api('/permissions', { mode: 'full' })
  await controls.getByLabel('允许自行选片的 HTTPS 域名').fill('vision-media.test')
  await controls.getByRole('button', { name: '授权精神从此域名选片', exact: true }).click()
  await poll(async () => (await status()).library?.host === 'vision-media.test', 'single-domain library authorization')
  await assert.rejects(() => nativeTool(mainId, 'jingshen_watch', { action: 'play', url: 'https://ungranted-media.test/bypass.webm' }), /授权/u)
  await nativeTool(mainId, 'jingshen_watch', { action: 'play', url: 'https://vision-media.test/redirect.webm' })
  await poll(async () => (await status()).playbackError === 'media-unavailable', 'browser rejects the media redirect')
  assert(!videoRequests.some(request => request.path === '/bypass.webm'))
  const libraryFirst = await playback('first chosen library clip', { url: 'https://vision-media.test/first.webm' }, firstLabel, secondLabel, true)
  const librarySecond = await playback('second chosen library clip', { url: 'https://vision-media.test/second.webm' }, secondLabel, firstLabel)
  assert(videoRequests.some(request => request.path === '/first.webm') && videoRequests.some(request => request.path === '/second.webm'))
  assert(videoRequests.every(request => !request.hasCookie))
  await stopSharing()

  // Observe, rather than replace, the real browser camera track so pause proves it actually stopped.
  await page.evaluate(() => {
    window.visionSmokeTracks = []
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await get(options)
      window.visionSmokeTracks.push(...stream.getVideoTracks())
      return stream
    }
  })
  const startCamera = () => controls.getByRole('button', { name: '开启摄像头', exact: true }).click()
  await startCamera()
  const camera = await poll(async () => {
    const value = await status()
    return value.source === 'camera' && value.reading
  }, 'live camera inference')
  const before = await api('/trace', undefined, true)
  assert(!before.trace.some(entry => entry.images?.length))
  const captureReceipt = page.waitForResponse(response => new URL(response.url()).pathname === '/personal-spirit/api/vision/image')
  await controls.getByRole('button', { name: '发送当前画面', exact: true }).click()
  const receipt = await captureReceipt
  assert.equal(receipt.status(), 202, await receipt.text())
  const image = await poll(async () => (await api('/trace', undefined, true)).trace.find(entry =>
    entry.sessionId === mainId && entry.images?.some(item => item.mediaType === 'image/jpeg' && item.bytes > 0)),
  'explicit image bytes in the same native main provider request')
  await api('/control', { action: 'pause' })
  await poll(() => page.evaluate(() => window.visionSmokeTracks.length > 0
    && window.visionSmokeTracks.every(track => track.readyState === 'ended')), 'owner pause stops actual media tracks')
  assert.equal((await status()).active, false)
  await api('/control', { action: 'resume' })
  await startCamera()
  await poll(async () => (await status()).source === 'camera', 'new opt-in after resume')
  await minimize()
  await poll(async () => !(await status()).active && await page.evaluate(() =>
    window.visionSmokeTracks.length > 1 && window.visionSmokeTracks.every(track => track.readyState === 'ended')),
  'minimizing releases real camera tracks and the visual lease')
  await openWindow()
  await startCamera()
  await poll(async () => (await status()).source === 'camera', 'new opt-in after re-opening the window')
  await page.close()
  await poll(async () => !(await status()).active, 'closing the page releases its active visual lease')
  assert(observations.length > 5 && observations.every(frame => !frame.foundPixels))
  const observedCadenceMs = observations.flatMap((frame, index) => {
    const previous = observations[index - 1]
    return previous && frame.seq === previous.seq + 1 ? [frame.capturedAt - previous.capturedAt] : []
  })
  const report = join(scratch, 'report.json')
  writeFileSync(report, JSON.stringify({ passed: true, runtimeVersion, mainId, browser: browser.version(),
    buildSha256: digest(join(snapshot, 'lib/index.js')),
    clientSha256: digest(join(snapshot, 'lib/client.js')),
    servedClientSha256,
    detectorSha256: digest(join(snapshot, 'src/vision-assets/efficientdet_lite0.tflite')),
    model: 'Deterministic image-capable protocol fixture. Object recognition ran in Chromium using local MediaPipe WASM.',
    local, remote, library: { first: libraryFirst, second: librarySecond, refusedCrossDomainAndRedirect: true },
    videoRequests, camera, nativeModelImages: image.images, observations, observedCadenceMs,
    pauseStoppedTracks: true, minimizingStoppedCameraTracks: true, closingPageEndedLease: true }, null, 2))
  process.stdout.write(`${report}\n`)
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(scratch, 'browser-failure.png') }).catch(() => {})
    const visionText = await page.locator('.spirit-vision').textContent({ timeout: 500 }).catch(() => undefined)
    if (visionText) browserErrors.push(visionText)
    writeFileSync(join(scratch, 'browser-errors.json'), JSON.stringify(browserErrors.map(value =>
      value.replace(/token=[A-Za-z0-9_-]+/g, 'token=[redacted]')), null, 2))
  }
  process.stderr.write(`Vision smoke evidence directory ${scratch}\n`)
  throw error
} finally {
  await browser?.close()
  https?.close()
  child.kill('SIGTERM')
}
