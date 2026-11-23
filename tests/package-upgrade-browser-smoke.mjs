#!/usr/bin/env node
/** Upgrade the distributed 0.4.3 package through the official CLI and continue its conversation in Chromium. */
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const [runtimeArg, oldArg, targetArg] = process.argv.slice(2)
assert(runtimeArg && oldArg && targetArg, 'Usage: node tests/package-upgrade-browser-smoke.mjs RC5_INSTALL OLD_TARBALL NEW_TARBALL')
const runtime = resolve(runtimeArg), oldArchive = resolve(oldArg), targetArchive = resolve(targetArg)
const binary = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')
assert.equal(json(join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')).version, '0.2.2-rc.5')
assert.equal(sha256(oldArchive), 'd4e6e845a37a5fd35f5b50541adf849bcb55f493207717de312c4e05b378184b',
  'The source archive matches the public 0.4.3 release record')
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPIRIT_VOICE_SMOKE_PLAYWRIGHT || 'playwright')
const scratch = mkdtempSync(join(tmpdir(), 'spirit-package-upgrade-'))
console.log(`Evidence directory: ${scratch}`)
const home = join(scratch, 'home'), profile = join(home, 'profiles/spirit-upgrade')
const addressFile = join(scratch, 'address.json'), stateDir = join(scratch, 'state')
const token = randomBytes(32).toString('hex'), fixture = join(scratch, 'fixture')
cpSync(dirname(fileURLToPath(import.meta.url)), fixture, { recursive: true })
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', SPIRIT_TEST_RUNTIME: runtime,
  SPIRIT_TEST_TOKEN: token, SPIRIT_TEST_ADDRESS_FILE: addressFile }
const run = promisify(execFile)
const cli = async (...args) => (await run(process.execPath, [binary, ...args], { cwd: scratch, env, timeout: 60_000 })).stdout
const plugin = (...args) => cli('plugin', '--profile', 'spirit-upgrade', ...args)
let child, browser, origin, entry, bootNumber = 0, page
const pageErrors = [], evidence = { harness: '0.2.2-rc.5', checks: [] }

async function poll(check, description) {
  const until = Date.now() + 35_000
  while (Date.now() < until) {
    const value = await check()
    if (value) return value
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}`)
}
async function request(route, data, fixtureRoute = false, mounting = false) {
  const response = await fetch(origin + (fixtureRoute ? '/__spirit-fixture' : '/personal-spirit/api') + route, {
    method: data === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'x-personal-spirit': '1', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  if (mounting && response.status === 404) return undefined
  if (!response.ok) assert.fail(`${response.status} ${route}: ${await response.text()}`)
  return response.json()
}
const fixtureRequest = (route, data) => request(route, data, true)
const inspect = sessionId => fixtureRequest(`/inspect?sessionId=${encodeURIComponent(sessionId)}`)
async function boot() {
  rmSync(addressFile, { force: true })
  entry = undefined
  const log = join(scratch, `host-${++bootNumber}.log`)
  child = spawn(process.execPath, [binary, '--profile', 'spirit-upgrade', '--host', '127.0.0.1', '--port', '0', '--no-open'],
    { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    output += chunk
    writeFileSync(log, output.replace(/token=[A-Za-z0-9_-]+/g, 'token=[redacted]'))
    entry ??= /^dsh web: (https?:\/\/\S+)$/m.exec(output)?.[1]
  })
  await poll(() => {
    assert(child.exitCode === null && child.signalCode === null, `Host exited, see ${log}`)
    return entry && existsSync(addressFile)
  }, 'Web entry and local fixture')
  origin = json(addressFile).origin
  const { providers } = await fixtureRequest('/ready')
  assert.deepEqual(providers.map(item => item.id), ['spirit-fixture'])
  await poll(async () => (await request('/state', undefined, false, true))?.mainId, 'Spirit mount')
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const kill = setTimeout(() => child.kill('SIGKILL'), 15000)
  try {
    const [, signal] = await exited
    assert.notEqual(signal, 'SIGKILL', 'Harness shuts down gracefully')
  } finally { clearTimeout(kill) }
}
async function openConversation() {
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'zh-CN' })
  page.on('pageerror', error => pageErrors.push(String(error)))
  await page.goto(entry)
  const launcher = page.locator('button.jingshen-launcher')
  const notice = page.getByRole('dialog', { name: '预览版说明' })
  await launcher.or(notice).first().waitFor()
  await launcher.waitFor()
  assert.equal(await launcher.count(), 1)
  const window = page.locator('.jingshen-window')
  await poll(async () => {
    if (await notice.isVisible()) await notice.getByRole('button', { name: '继续' }).click()
    if (await window.isVisible()) return true
    await launcher.click({ timeout: 1000 }).catch(error => {
      if (error.name !== 'TimeoutError') throw error
    })
  }, 'the fish window')
  return page
}
async function send(page, text) {
  const window = page.locator('.jingshen-window')
  await window.getByRole('textbox', { name: '给精神发消息' }).fill(text)
  await window.getByRole('button', { name: '发送消息' }).click()
  return poll(async () => {
    const chat = await request('/chat?after=0&limit=100')
    const owner = chat.messages.find(item => item.author === 'owner' && item.text === text)
    const reply = owner && chat.messages.find(item => item.author === 'spirit' && item.cursor > owner.cursor)
    return reply && { chat, owner, reply }
  }, 'the owner message and mediated reply')
}
async function installedVersion() {
  const [result] = JSON.parse(await plugin('list', '--depth', '0', '--json'))
  assert.deepEqual(Object.keys(result.dependencies), ['dsh-jingshen'])
  return result.dependencies['dsh-jingshen'].version
}
const checkpoints = [
  ['0.4.3', oldArchive],
  ['0.4.5', targetArchive],
]
try {
  await cli('--profile', 'spirit-upgrade', '--from-default-profile', 'web', '--dump-config')
  writeFileSync(join(profile, 'cordis.patch.yml'), [
    '- id: dsh-spirit', '  config:', `    stateDir: ${JSON.stringify(stateDir)}`, '    openIntervalMinutes: 0',
    '- id: agent-default-model', '  config:', '    provider: spirit-fixture', '    model: fixture-one', '    reasoningEffort: low',
    ...['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-title-llm'].flatMap(id => [`- id: ${id}`, '  disabled: true']),
    '- insert:', '    - id: spirit-runtime-fixture', `      name: ${JSON.stringify(join(fixture, 'runtime-smoke.mjs'))}`, '',
  ].join('\n'))
  await plugin('add', oldArchive)
  assert.equal(await installedVersion(), checkpoints[0][0])
  await boot()
  browser = await chromium.launch({ executablePath: process.env.SPIRIT_CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true })
  evidence.browser = browser.version()
  page = await openConversation()
  const old = await send(page, '请保留这次对话的原始记录。')
  const before = await request('/permissions', { mode: 'full' })
  const nativeBefore = await inspect(old.chat.mainId)
  assert.equal(nativeBefore.preset, 'dsh-spirit')
  const workspace = await fixtureRequest('/project-workspace', {})
  const project = await fixtureRequest('/native-create', { workspaceId: workspace.id, agentPreset: 'dsh-spirit' })
  assert.equal(project.agentPreset, 'dsh-spirit')
  const statement = '升级后保留这个尚未完成的意向。'
  await fixtureRequest('/turn', { sessionId: project.sessionId, script: { id: randomUUID(), calls: [{
    name: 'spirit_intent', args: { statement, reason: '种下一个待处理的持久意向。', state: 'waiting' },
  }] } })
  const remembered = (await request('/state')).intentions.find(item => item.statement === statement)
  assert.equal(remembered?.state, 'waiting')
  await page.close()
  await stop()
  evidence.checks.push('0.4.3 installed by dsh and produced real owner and assistant turns in Chromium')

  await plugin('remove', 'dsh-jingshen')
  await plugin('add', targetArchive)
  assert.equal(await installedVersion(), checkpoints[1][0])
  await boot()
  page = await openConversation()
  const restored = await request('/chat?after=0&limit=100')
  assert.equal(restored.mainId, old.chat.mainId)
  assert.deepEqual(restored.messages, old.chat.messages)
  const visibleOwner = page.locator('.jingshen-window').getByText(old.owner.text, { exact: true })
  await visibleOwner.waitFor()
  assert.equal(await visibleOwner.count(), 1)
  const after = await request('/state')
  assert.deepEqual(after.permissions, before.permissions)
  assert.deepEqual(after.intentions.find(item => item.id === remembered.id), remembered)
  const nativeAfter = await inspect(restored.mainId)
  assert.equal(nativeAfter.preset, 'dsh-jingshen')
  assert.equal(nativeAfter.header.cwd, nativeBefore.header.cwd)
  const migratedProject = await inspect(project.sessionId)
  assert.equal(migratedProject.preset, 'dsh-jingshen')
  assert((await fixtureRequest('/workspaces')).find(item => item.id === workspace.id).sessionIds.includes(project.sessionId))
  const { presets } = await fixtureRequest('/presets')
  assert.deepEqual(presets.filter(item => /^(dsh-(personal-)?spirit|dsh-jingshen)$/.test(item.id)).map(item => item.id), ['dsh-jingshen'])
  evidence.checks.push('Same profile retains chat, permissions, an unfinished intention and project membership, with one installed package and one selectable new preset')

  const continued = await send(page, '现在请继续这段对话。')
  assert.equal(continued.chat.mainId, restored.mainId)
  assert.deepEqual(continued.chat.messages.slice(0, restored.messages.length), restored.messages)
  assert(continued.owner.cursor > restored.cursor)
  assert.equal(continued.reply.source.sessionId, restored.mainId)
  await page.getByRole('button', { name: '缩小窗口' }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  const installed = page.locator('[data-plugin-group="bundles"] [data-plugin-package]')
  await installed.first().waitFor()
  assert.deepEqual(await installed.evaluateAll(cards => cards.map(card => card.getAttribute('data-plugin-package'))), ['dsh-jingshen'])
  assert.equal(await installed.getByRole('button', { name: '查看 精神', exact: true }).count(), 1)
  await page.locator('.jingshen-launcher').waitFor({ state: 'hidden' })
  const pluginListScreenshot = join(scratch, 'installed-plugins.png')
  await page.screenshot({ path: pluginListScreenshot })
  evidence.checks.push({ check: 'The official Chinese Plugins screen shows one installed card titled 精神', screenshot: pluginListScreenshot })
  await page.close()
  await stop()
  await boot()
  const restarted = await request('/chat?after=0&limit=100')
  assert.equal(restarted.mainId, restored.mainId)
  assert.deepEqual(restarted.messages, continued.chat.messages)
  assert.equal((await inspect(restarted.mainId)).preset, 'dsh-jingshen')
  assert.deepEqual(pageErrors, [])
  evidence.checks.push('The upgraded browser continues the same history once, and it survives restart')
  evidence.archives = checkpoints.map(([version, file]) => ({ version, sha256: sha256(file) }))
  evidence.passed = true
} catch (error) {
  evidence.error = error.stack ?? String(error)
  evidence.passed = false
  await page?.screenshot({ path: join(scratch, 'failure.png') }).catch(() => {})
  throw error
} finally {
  writeFileSync(join(scratch, 'report.json'), JSON.stringify(evidence, null, 2))
  await browser?.close()
  await stop()
}
