#!/usr/bin/env node
/**
 * Run an in-place profile upgrade against two locally installed Harness runtimes.
 * node tests/upgrade-smoke.mjs --old-runtime DIR --old-package DIR --new-runtime DIR [--new-package DIR] [--scratch NEW_DIR]
 * The package directories need built lib/ files. The current checkout needs installed dependencies.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import * as runtimeFixture from './runtime-smoke.mjs'

const file = fileURLToPath(import.meta.url)
const repo = fileURLToPath(new URL('..', import.meta.url))
const fixture = fileURLToPath(new URL('./runtime-smoke.mjs', import.meta.url))
const provider = 'spirit-fixture'
const packageName = 'dsh-jingshen'

export const name = runtimeFixture.name
export const inject = [...runtimeFixture.inject, 'pluginManager']

export async function apply(ctx) {
  const token = process.env.SPIRIT_TEST_TOKEN
  assert(token && ctx.webServer.host === '127.0.0.1', 'Only the isolated loopback test host can load the upgrade fixture')
  const steps = []
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    if (decision.kind !== 'reject') {
      steps.push({ sessionId: agent.id, messageIds: messages.map(message => message.id),
        preset: ctx.agentPresets.composedPreset(agent.ctx) })
    }
    return decision
  })
  ctx.webServer.register({ kind: 'exact', path: '/__spirit-upgrade', handler: async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`
      || req.headers.host !== new URL(ctx.webServer.getOrigin()).host) {
      res.writeHead(403).end(); return
    }
    const plugins = await ctx.pluginManager.listPlugins()
    const { presets } = await ctx.agentPresets.remoteExportList()
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ plugins, presets, steps }))
  } })
  await runtimeFixture.apply(ctx)
}

async function main() {
  const args = new Map()
  for (let index = 2; index < process.argv.length; index += 2) {
    const [flag, value] = process.argv.slice(index, index + 2)
    assert(['--old-runtime', '--old-package', '--new-runtime', '--new-package', '--scratch'].includes(flag) && value && !value.startsWith('--'), `Unexpected option: ${flag}`)
    args.set(flag, resolve(value))
  }
  for (const flag of ['--old-runtime', '--old-package', '--new-runtime']) assert(args.has(flag), `Required option: ${flag}`)

  function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
  function release(packageRoot, runtime, packageVersion, harnessVersion) {
    assert.equal(readJson(join(packageRoot, 'package.json')).version, packageVersion)
    assert.equal(readJson(join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')).version, harnessVersion)
    return { packageRoot, runtime, packageVersion, harnessVersion,
      sha256: createHash('sha256').update(readFileSync(join(packageRoot, 'lib/index.js'))).digest('hex') }
  }
  const oldRelease = release(args.get('--old-package'), args.get('--old-runtime'), '0.2.0', '0.2.2-rc.3')
  const newRelease = release(args.get('--new-package') ?? repo, args.get('--new-runtime'), '0.3.0', '0.2.2-rc.5')
  const scratch = args.has('--scratch') ? args.get('--scratch') : mkdtempSync(join(tmpdir(), 'spirit-upgrade-'))
  if (args.has('--scratch')) mkdirSync(scratch, { mode: 0o700 })
  const home = join(scratch, 'home'), state = join(scratch, 'state'), address = join(scratch, 'address.json')
  const modules = join(home, 'profiles', 'upgrade-test', 'node_modules'), profile = dirname(modules)
  const token = randomBytes(32).toString('hex'), report = { oldRelease, newRelease, checks: [] }
  mkdirSync(modules, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-upgrade-test', private: true,
    dependencies: { [packageName]: 'file:./node_modules/dsh-jingshen' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', packageName] } } }))
  writeFileSync(join(profile, 'cordis.yml'), '[]\n')
  writeFileSync(join(profile, 'cordis.patch.yml'), [
    '- id: dsh-spirit', '  config:', `    stateDir: ${JSON.stringify(state)}`, '    openIntervalMinutes: 0',
    '- id: agent-default-model', '  config:', `    provider: ${provider}`, '    model: fixture-one', '    reasoningEffort: low',
    ...['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-title-llm'].flatMap(id => [`- id: ${id}`, '  disabled: true']),
    '- insert:', '    - id: spirit-runtime-fixture', `      name: ${JSON.stringify(join(modules, packageName, 'tests/upgrade-smoke.mjs'))}`, '',
  ].join('\n'))

  let child, origin, bootNumber = 0
  async function request(route, data, fixtureRequest = true) {
    const response = await fetch(`${origin}${fixtureRequest ? '/__spirit-fixture' : '/personal-spirit/api'}${route}`, {
      method: data === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${token}`, 'x-personal-spirit': '1', 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    const value = await response.json()
    assert(response.ok, `${route} returned ${response.status}: ${JSON.stringify(value)}`)
    return value
  }
  async function inventory() {
    const response = await fetch(`${origin}/__spirit-upgrade`, {
      signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${token}` },
    })
    assert(response.ok)
    return response.json()
  }
  const panel = (route = '/state', data) => request(route, data, false)
  const inspect = id => request(`/inspect?sessionId=${encodeURIComponent(id)}`)
  const trace = () => request('/trace')
  const nativePermission = log => log.events.findLast(event => event.type === 'permission/preset')?.data.preset
  const toolEvent = (log, callId) => log.events.findLast(event => event.type === 'tool/result' && event.data.message.toolCallId === callId)
  const byId = (items, id) => items.find(item => item.id === id)
  const dispatchMessages = (log, id) => log.events.filter(event => event.type === 'user/message' && event.data.source.requestId === id)
  const sentWork = log => log.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'spirit').map(event => event.data.id)
  function record(check, evidence) {
    report.checks.push({ check, ...evidence })
    console.log(`PASS ${check}`)
  }
  async function poll(check, description, { failFast = false } = {}) {
    const deadline = Date.now() + 30_000
    let lastError
    while (Date.now() < deadline) {
      try { const value = await check(); if (value) return value } catch (error) { if (failFast) throw error; lastError = error }
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${description}`, { cause: lastError })
  }
  async function startTool(sessionId, tool, toolArgs, wait = true) {
    const id = randomUUID(), callId = `spirit-fixture:${id}:0`
    const log = await request('/turn', { sessionId, script: { id, calls: [{ name: tool, args: toolArgs }] }, wait })
    return { callId, log }
  }
  async function runTool(sessionId, tool, toolArgs) {
    const { callId, log } = await startTool(sessionId, tool, toolArgs)
    const message = toolEvent(log, callId)?.data.message
    if (!message) throw new Error(`Missing native tool result for ${tool}: ${JSON.stringify((await panel()).permissions)}`)
    let text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    assert(!message.isError, text)
    const spill = /Full formatted result stored at: ([^\n]+?\.txt)\./.exec(text)?.[1]
    if (spill) text = readFileSync(spill, 'utf8')
    return { value: JSON.parse(text), messageId: log.messageId }
  }
  async function boot(build) {
    const snapshot = join(scratch, `spirit-${build.packageVersion}`)
    if (!existsSync(snapshot)) {
      mkdirSync(join(snapshot, 'node_modules'), { recursive: true })
      for (const entry of ['package.json', 'cordis.patch.yml', 'lib', 'upstream', 'marketplace/locale']) {
        cpSync(join(build.packageRoot, entry), join(snapshot, entry), { recursive: true })
      }
      mkdirSync(join(snapshot, 'tests'))
      cpSync(file, join(snapshot, 'tests/upgrade-smoke.mjs'))
      cpSync(fixture, join(snapshot, 'tests/runtime-smoke.mjs'))
      symlinkSync(join(build.runtime, 'node_modules/@deepseek-ai'), join(snapshot, 'node_modules/@deepseek-ai'), 'dir')
      for (const dependency of ['zod', 'proper-lockfile']) symlinkSync(join(repo, 'node_modules', dependency), join(snapshot, 'node_modules', dependency), 'dir')
    }
    for (const [target, path] of [[packageName, snapshot], ['@deepseek-ai', join(build.runtime, 'node_modules/@deepseek-ai')]]) {
      rmSync(join(modules, target), { force: true })
      symlinkSync(path, join(modules, target), 'dir')
    }
    rmSync(address, { force: true })
    const logFile = join(scratch, `host-${++bootNumber}-${build.harnessVersion}.log`)
    child = spawn(process.execPath, [join(build.runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'upgrade-test', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: scratch, env: { ...process.env, DSH_HOME: home, SPIRIT_TEST_RUNTIME: build.runtime, SPIRIT_TEST_TOKEN: token, SPIRIT_TEST_ADDRESS_FILE: address },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '', processError
    child.on('error', error => { processError = error })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; writeFileSync(logFile, output) })
    await poll(() => {
      if (processError) throw processError
      assert(child.exitCode === null && child.signalCode === null, `Host exited; inspect ${logFile}`)
      return existsSync(address)
    }, 'host address', { failFast: true })
    origin = readJson(address).origin
    const ready = await request('/ready')
    assert.deepEqual(ready.providers.map(item => item.id), [provider])
    return poll(async () => { const value = await panel(); return value.mainId && value }, 'Spirit panel')
  }
  async function stop() {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise(done => child.once('exit', (_code, signal) => done(signal)))
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000)
    child.kill('SIGTERM')
    try { assert.notEqual(await exited, 'SIGKILL', 'Harness did not shut down gracefully') }
    finally { clearTimeout(timeout) }
  }

  const legacyPreset = 'dsh-personal-spirit'
  const waiting = (statement, wait) => ({ statement, reason: 'Test the persistence of an explicit unfinished intention', state: 'waiting',
    revisit: { at: new Date(Date.now() + wait).toISOString() } })
  const sensitiveCall = title => ({ action: 'create', title, cwd: join(scratch, title), reason: 'Exercise the actual native approval path' })
  const waitForApproval = callId => poll(async () => (await trace()).pending.find(entry => entry.callId === callId), 'native approval')

  try {
    const initial = await boot(oldRelease), mainId = initial.mainId
    const mainWorkspace = (await request('/workspaces')).find(workspace => workspace.sessionIds.includes(mainId))
    assert(mainWorkspace)
    const legacyMain = await request('/native-create', { sessionId: mainId, workspaceId: mainWorkspace.id, agentPreset: legacyPreset })
    assert.equal(legacyMain.agentPreset, legacyPreset)
    const seeded = await runTool(mainId, 'spirit_read', {})
    assert.equal((await inspect(mainId)).preset, legacyPreset)
    const oldInventory = await inventory()
    assert(oldInventory.presets.some(value => value.id === legacyPreset))
    assert.equal(oldInventory.steps.find(step => step.messageIds.includes(seeded.messageId))?.preset, legacyPreset)
    const archivedConversation = await request('/native-create', { workspaceId: mainWorkspace.id, agentPreset: legacyPreset })
    const legacyId = archivedConversation.sessionId
    const archived = await request('/turn', { sessionId: legacyId, script: { id: randomUUID(), calls: [] } })
    const archivedMessage = archived.events.find(event => event.type === 'user/message' && event.data.id === archived.messageId)
    assert(archivedMessage)
    assert.equal(archived.preset, legacyPreset)
    await panel('/permissions', { mode: 'full' })
    assert.equal(nativePermission(await inspect(mainId)), 'danger-full-access')
    await panel('/permissions', { mode: 'ask' })

    const selfArgs = { title: 'Work from a grant that will be withdrawn', origin: 'self', request: 'Read fixture material', reason: 'Autonomous fixture request' }
    const revokedId = (await runTool(mainId, 'spirit_start', selfArgs)).value.task.id
    const revoked = byId((await panel()).tasks, revokedId)
    assert.equal(revoked.experience.source.kind, 'self')
    const oldWorker = await poll(async () => { const log = await inspect(revoked.sessionId); return log.status === 'idle' && sentWork(log).length && log }, 'old worker admission')
    const stoppedId = (await runTool(mainId, 'spirit_start', { title: 'Work the owner will stop' })).value.task.id
    const stopped = byId((await panel()).tasks, stoppedId)
    await panel('/stop', { id: stoppedId })
    await panel('/permissions', { mode: 'ask' })
    const oldCall = await startTool(mainId, 'spirit_sessions', sensitiveCall('old-pending-approval'), false)
    await waitForApproval(oldCall.callId)
    const oldApproval = (await inspect(mainId)).events.find(event => event.type === 'approval/asked' && event.data.callId === oldCall.callId)
    assert(oldApproval)
    await panel('/permissions', { mode: 'ask' })
    const oldDenied = await poll(async () => (await inspect(mainId)).events.find(event => event.type === 'approval/decided' && event.data.id === oldApproval.data.id), 'old approval cancellation')
    assert.equal(oldDenied.data.outcome, 'cancelled')

    await request('/behavior', { autonomy: 'silent' })
    const accepted = (await runTool(mainId, 'spirit_intent', waiting('Accepted without a decision in the old host', 3000))).value.intent
    const prior = await poll(async () => {
      const before = await panel()
      const revisit = before.revisits.find(entry => entry.intentId === accepted.id)
      const opportunity = byId(before.opportunities, revisit?.opportunityId)
      return opportunity?.state === 'awaiting_decision' && opportunity
    }, 'old host accepted opportunity without decision')
    const pending = (await runTool(mainId, 'spirit_intent', waiting('Still waiting at the time of upgrade', 5000))).value.intent
    const before = await panel(), oldMain = await inspect(mainId)
    assert.equal(byId(before.tasks, stoppedId).ended.by, 'human')
    assert(revoked.experience.source.grantRevision < before.permissions.revision)
    assert.equal(nativePermission(oldMain), 'workspace-write')
    assert.equal(dispatchMessages(oldMain, prior.dispatchId).length, 1)
    await stop()

    const upgraded = await boot(newRelease), upgradedMain = await inspect(mainId)
    assert.equal(upgraded.mainId, mainId)
    assert.deepEqual(upgradedMain.model, oldMain.model)
    assert((await request('/workspaces')).some(workspace => workspace.id === mainWorkspace.id && workspace.sessionIds.includes(mainId)))
    assert.deepEqual(upgradedMain.events.find(event => event.type === 'user/message' && event.data.id === seeded.messageId),
      oldMain.events.find(event => event.type === 'user/message' && event.data.id === seeded.messageId))
    const roster = (await request(`/roster?sessionId=${encodeURIComponent(mainId)}`)).tools
    assert(['spirit_intent', 'spirit_orient', 'bash', 'read'].every(tool => roster.includes(tool)))
    const first = await runTool(mainId, 'spirit_read', {})
    const upgradedInventory = await inventory()
    const spiritPresets = upgradedInventory.presets.filter(value => /^dsh-(?:personal-)?spirit$/.test(value.id) || value.name?.startsWith('精神'))
    const spiritPlugins = upgradedInventory.plugins.filter(value => value.moduleName === packageName)
    const spiritPresetPlugins = upgradedInventory.plugins.filter(value => /dsh-spirit-(?:legacy-)?preset$/.test(value.entryId))
    assert.deepEqual(spiritPresets.map(value => value.id), ['dsh-spirit'])
    assert(spiritPresets[0].isDefault && !spiritPresets[0].broken)
    assert.equal(spiritPlugins.length, 1)
    assert.equal(spiritPlugins[0].fiberPhase, 'active')
    assert.equal(spiritPresetPlugins.length, 1)
    assert.equal(upgradedMain.preset, 'dsh-spirit')
    const firstStep = upgradedInventory.steps.find(step => step.sessionId === mainId)
    assert(firstStep?.messageIds.includes(first.messageId), 'The first upgraded model step should admit the controlled prompt')
    assert.equal(firstStep.preset, 'dsh-spirit')
    const firstModel = (await trace()).trace.find(step => step.sessionId === mainId)
    assert(firstModel?.tools.includes('spirit_orient'), 'The first upgraded model request has current Spirit tools')
    assert(firstModel.working?.activeIntents.some(intent => intent.id === pending.id && intent.revision === pending.revision))
    const legacyConversation = await inspect(legacyId)
    assert.deepEqual(legacyConversation.events.find(event => event.type === 'user/message' && event.data.id === archived.messageId), archivedMessage)
    assert.equal(legacyConversation.preset, 'dsh-spirit')
    const conversationTurn = await runTool(legacyId, 'spirit_read', {})
    const conversationStep = (await inventory()).steps.find(step => step.sessionId === legacyId)
    assert(conversationStep?.messageIds.includes(conversationTurn.messageId))
    assert.equal(conversationStep.preset, 'dsh-spirit')
    record('the started legacy sessions use the only Spirit preset on their first upgraded model requests', {
      mainId, legacyConversationId: legacyId, workspaceId: mainWorkspace.id, preset: upgradedMain.preset, spiritPresets, spiritPlugins, spiritPresetPlugins,
    })

    assert.equal(upgraded.permissions.revision, before.permissions.revision)
    assert.equal(upgraded.permissions.status, 'applied')
    assert.equal(upgraded.permissions.mode, 'ask')
    assert.equal(nativePermission(upgradedMain), 'workspace-write')
    assert(upgradedMain.events.some(event => event.type === 'approval/decided' && event.data.id === oldApproval.data.id && event.data.outcome === 'cancelled'))
    assert(!(await trace()).pending.some(entry => entry.callId === oldCall.callId))
    const sessionCount = (await request('/sessions')).items.length
    const newCall = await startTool(mainId, 'spirit_sessions', sensitiveCall('new-pending-approval'), false)
    const newApproval = await waitForApproval(newCall.callId)
    const newAsked = (await inspect(mainId)).events.find(event => event.type === 'approval/asked' && event.data.callId === newCall.callId)
    assert(newAsked)
    assert.notEqual(newAsked.data.id, oldApproval.data.id)
    await request('/approval', { id: newApproval.id, outcome: 'rejected' })
    const rejected = await poll(async () => toolEvent(await inspect(mainId), newCall.callId), 'native rejection result')
    assert(rejected.data.message.isError)
    assert.equal((await request('/sessions')).items.length, sessionCount)
    assert(!existsSync(join(scratch, 'old-pending-approval')) && !existsSync(join(scratch, 'new-pending-approval')))
    record('owner permission revision and cancelled approval are retained and a new sensitive call requires a new approval', { revision: upgraded.permissions.revision, oldApprovalId: oldApproval.data.id, newApprovalId: newAsked.data.id })

    const recoveredWork = byId(upgraded.tasks, revokedId)
    assert.equal(recoveredWork.sessionId, revoked.sessionId)
    assert.equal(recoveredWork.experience.recovery?.sessionId, revoked.sessionId)
    assert.deepEqual(recoveredWork.experience.source, revoked.experience.source)
    assert.deepEqual(byId(upgraded.tasks, stoppedId).ended, byId(before.tasks, stoppedId).ended)
    assert.deepEqual(byId(upgraded.intentions, pending.id), { ...pending, title: pending.statement })
    assert.deepEqual(byId(upgraded.intentions, accepted.id), { ...accepted, title: accepted.statement })
    await delay(1200)
    assert.deepEqual(sentWork(await inspect(revoked.sessionId)), sentWork(oldWorker))
    assert(!(await trace()).trace.some(row => row.sessionId === revoked.sessionId || row.sessionId === stopped.sessionId))
    assert.equal(byId((await panel()).opportunities, prior.id).state, 'awaiting_decision')
    assert.equal(dispatchMessages(await inspect(mainId), prior.dispatchId).length, 1)
    assert(!(await trace()).trace.some(entry => entry.dispatchId === prior.dispatchId))
    record('revoked work, owner-stopped work and the accepted dispatch do not replay automatically', { revokedId, stoppedId, oldDispatchId: prior.dispatchId, intentId: pending.id })

    await runTool(mainId, 'spirit_read', { action: 'retry', opportunityId: prior.id, reason: 'Explicitly retry the undecided fixture opportunity' })
    const recovered = await poll(async () => { const value = byId((await panel()).opportunities, prior.id); return value?.state === 'settled' && value }, 'explicit recovery')
    assert.notEqual(recovered.dispatchId, prior.dispatchId)
    const reawakened = await poll(async () => {
      const after = await panel()
      const revisit = after.revisits.find(entry => entry.intentId === pending.id)
      const opportunity = byId(after.opportunities, revisit?.opportunityId)
      return opportunity?.state === 'settled' && opportunity
    }, 'stored one-shot revisit')
    const after = await inspect(mainId)
    for (const dispatchId of [prior.dispatchId, recovered.dispatchId, reawakened.dispatchId]) assert.equal(dispatchMessages(after, dispatchId).length, 1)
    assert.equal(byId((await panel()).intentions, pending.id).state, 'waiting')
    record('explicit recovery uses a fresh native dispatch and the stored revisit executes once', { opportunityId: prior.id, recoveryDispatchId: recovered.dispatchId, revisitDispatchId: reawakened.dispatchId })

    await stop()
    const restarted = await boot(newRelease)
    assert.equal(restarted.mainId, mainId)
    for (const [sessionId, previous] of [[mainId, oldMain], [legacyId, archived]]) {
      const log = await inspect(sessionId)
      assert.equal(log.preset, 'dsh-spirit')
      const migrated = log.events.filter(event => event.seq > previous.events.at(-1).seq && event.type === 'agent-preset/selected')
      assert.deepEqual(migrated.map(event => event.data.agentPreset), ['dsh-spirit'])
    }
    record('the migrated preset selection persists through a subsequent rc.5 restart', { mainId, legacyConversationId: legacyId })

    const full = await panel('/permissions', { mode: 'full' })
    assert.equal(full.permissions.status, 'applied')
    const { sessionId: fullConversationId } = await request('/native-create', { workspaceId: mainWorkspace.id })
    const fullConversation = await inspect(fullConversationId)
    assert.equal(fullConversation.preset, 'dsh-spirit')
    assert.equal(nativePermission(fullConversation), 'danger-full-access')
    await runTool(fullConversationId, 'spirit_read', {})

    const fullTaskId = (await runTool(mainId, 'spirit_start', { origin: 'self', title: 'New work under full permissions',
      request: 'Inspect the local fixture record', reason: 'Verify a fresh worker can receive and complete work after the upgrade' })).value.task.id
    const fullWorkerId = byId((await panel()).tasks, fullTaskId).sessionId
    const fullWorker = await poll(async () => {
      const controls = (await panel()).permissions
      assert.notEqual(controls.status, 'error', controls.detail)
      const log = await inspect(fullWorkerId).catch(() => undefined)
      return log?.status === 'idle' && sentWork(log).length && log
    }, 'full-permission worker admission', { failFast: true })
    assert.equal(nativePermission(fullWorker), 'danger-full-access')
    assert.equal(sentWork(fullWorker).length, 1)
    assert((await trace()).trace.some(entry => entry.sessionId === fullWorkerId))
    const completion = 'The isolated worker received the original Spirit dispatch.'
    await runTool(fullWorkerId, 'spirit_report', { state: 'ready', summary: completion })
    const final = await panel(), completed = byId(final.tasks, fullTaskId)
    assert.equal(final.permissions.status, 'applied')
    assert.equal(completed.ended?.outcome, 'completed')
    assert.equal(completed.experience.result?.text, completion)
    record('new conversations and workers use full permissions and the worker completes its first task', {
      fullConversationId, fullTaskId, fullWorkerId, dispatchMessageId: sentWork(fullWorker)[0],
    })
    report.passed = true
  } catch (error) {
    report.passed = false
    report.error = error.stack ?? String(error)
    throw error
  } finally {
    try { await stop() } finally {
      writeFileSync(join(scratch, 'report.json'), JSON.stringify(report, null, 2))
      console.log(`Evidence: ${join(scratch, 'report.json')}`)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === file) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
