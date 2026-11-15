#!/usr/bin/env node
/**
 * Controlled integration test against the real Harness 0.2.2-rc.3 host.
 * This file is both a CLI driver and a test-only Cordis companion plugin.
 * Its local deterministic adapter emits protocol fixtures, not model reasoning.
 * No provider account, paid request, or external message is used.
 *
 * node tests/runtime-smoke.mjs --runtime /path/to/rc3-install --scratch /tmp/spirit-runtime-test
 * Build Spirit first. The driver snapshots the package and uses an isolated DSH_HOME.
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { DatabaseSync } from 'node:sqlite'

const FILE = fileURLToPath(import.meta.url)
const PACKAGE = resolve(dirname(FILE), '..')
const PROVIDER = 'spirit-fixture'
const MARKER = '[[SPIRIT_RUNTIME_FIXTURE]]'
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
const callId = (scriptId, index) => `spirit-fixture:${scriptId}:${index}`
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`
const textOf = message => (message?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n')
const flatten = function* (value) {
  if (!value || typeof value !== 'object') return
  yield value
  for (const child of Object.values(value)) if (child && typeof child === 'object') yield* flatten(child)
}
function fixtureInput(message) {
  const content = textOf(message), marker = content.indexOf(MARKER)
  if (marker >= 0) return { script: JSON.parse(content.slice(marker + MARKER.length)) }
  const start = content.indexOf('{')
  if (start < 0) return
  try {
    const parsed = JSON.parse(content.slice(start))
    const packet = [...flatten(parsed)].find(item => typeof item.dispatchId === 'string' && typeof item.opportunity?.id === 'string')
    if (packet) return { packet }
  } catch { /* Ordinary prose is not a fixture command. */ }
}

export const name = 'spirit-runtime-fixture'
export const inject = ['llm', 'agents', 'agentPresets', 'sessionController', 'sessionPersistence', 'workspaceRegistry', 'approval', 'webServer']

/** Test-only surface: authenticated loopback input and observation, never tools.execute(). */
export async function apply(ctx) {
  const token = process.env.SPIRIT_TEST_TOKEN
  if (!token || !process.env.SPIRIT_TEST_RUNTIME) throw new Error('The runtime fixture is only loadable by its isolated test driver')
  if (ctx.webServer.host !== '127.0.0.1') throw new Error('The runtime fixture requires an IPv4 loopback listener')
  const requireRuntime = createRequire(join(process.env.SPIRIT_TEST_RUNTIME, 'package.json'))
  const { LlmAdapter, createUserMessage } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-llm')).href)
  const trace = [], pending = new Map()
  let autonomyBehavior = 'ack'
  // Optional, explicitly labeled fault injection: persist normally, then delay exactly one flush completion.
  // This changes timing only; the real service operation, result, tool execution, and approvals remain intact.
  const persistence = ctx.sessionPersistence, nativeFlush = persistence.flush.bind(persistence)
  const originalFlushDescriptor = Object.getOwnPropertyDescriptor(persistence, 'flush')
  let flushHookInstalled = true
  let flushBarrier, lastBarrier
  const gatedFlush = async (...args) => {
    const result = await nativeFlush(...args)
    if (flushBarrier && !flushBarrier.entered) {
      const claimed = flushBarrier
      claimed.entered = true; claimed.enteredAt = new Date().toISOString()
      await claimed.wait
    }
    return result
  }
  persistence.flush = gatedFlush
  const releaseFlush = () => {
    if (!flushBarrier) return
    const current = flushBarrier; flushBarrier = undefined
    lastBarrier = { id: current.id, entered: current.entered, released: true }
    current.release()
  }
  const restoreFlush = () => {
    releaseFlush()
    if (!flushHookInstalled) return
    if (originalFlushDescriptor) Object.defineProperty(persistence, 'flush', originalFlushDescriptor)
    else delete persistence.flush
    flushHookInstalled = false
  }
  const models = ['fixture-one', 'fixture-two'].map(id => ({ provider: PROVIDER, id, name: `Deterministic protocol fixture: ${id}`,
    inputModalities: ['text'], context: { contextWindow: 1_000_000 }, defaultMaxTokens: 4096,
    reasoning: { efforts: [{ id: 'low', name: 'Fixture low' }, { id: 'high', name: 'Fixture high' }], defaultEffort: 'low' } }))
  class FixtureAdapter extends LlmAdapter {
    providerInfo() { return { id: PROVIDER, name: 'Local deterministic integration fixture' } }
    async listModels() { return models }
    async resolveModel(_provider, model) {
      const selected = models.find(value => value.id === model)
      if (!selected) throw new Error(`Unknown fixture model ${model}`)
      return selected
    }
    async *stream(options) {
      options.signal?.throwIfAborted()
      const latest = options.messages.findLast(message => message.role === 'user' && ['user', 'spirit'].includes(message.source?.kind))
      const input = latest && fixtureInput(latest)
      const seen = new Set(options.messages.flatMap(message => message.content ?? []).filter(part => part.type === 'tool-call').map(part => part.id))
      let next
      if (input?.packet && autonomyBehavior === 'ack') {
        const id = callId(input.packet.dispatchId, 0)
        if (!seen.has(id)) next = { id, name: 'spirit_decide', args: { opportunityId: input.packet.opportunity.id,
          dispatchId: input.packet.dispatchId, decision: 'refrain', reason: '确定性运行时测试记录了显式回执；这不代表真实模型已经学习或判断了事情' } }
      } else if (input?.script) {
        const index = (input.script.calls ?? []).findIndex((_call, index) => !seen.has(callId(input.script.id, index)))
        if (index >= 0) next = { ...input.script.calls[index], id: callId(input.script.id, index) }
      }
      trace.push({ at: new Date().toISOString(), sessionId: options.sessionId, provider: options.provider, model: options.model,
        reasoningEffort: options.reasoningEffort, purpose: options.purpose, tools: (options.tools ?? []).map(tool => tool.name),
        ...(next ? { call: next } : {}), ...(input?.packet ? { opportunityId: input.packet.opportunity.id, dispatchId: input.packet.dispatchId } : {}),
        ...(input?.script?.hold ? { hold: true } : {}) })
      if (trace.length > 2000) trace.shift()
      if (input?.script?.hold && !next) {
        await new Promise((_resolve, reject) => {
          const abort = () => reject(options.signal?.reason ?? new Error('Fixture held stream cancelled'))
          options.signal?.addEventListener('abort', abort, { once: true })
          if (options.signal?.aborted) abort()
        })
      }
      const block = next ? { type: 'tool-call', id: next.id, name: next.name, arguments: JSON.stringify(next.args) }
        : { type: 'text', text: 'Controlled runtime fixture settled. No live-model reasoning was exercised.' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield next ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
        : { type: 'text-delta', index: 0, text: block.text }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
      yield { type: 'finish', reason: { kind: next ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter([PROVIDER], new FixtureAdapter())
  ctx.on('approval/request', (request, _next) => new Promise(resolveAnswer => {
    const id = randomUUID(), item = { id, sessionId: request.agent?.id, toolName: request.toolName,
      callId: request.callId, reason: request.reason }
    const finish = outcome => { pending.delete(id); request.signal?.removeEventListener('abort', abort); resolveAnswer(outcome) }
    const abort = () => finish('cancelled')
    pending.set(id, { item, finish })
    request.signal?.addEventListener('abort', abort, { once: true })
    if (request.signal?.aborted) abort()
  }), { prepend: true })
  const agentFor = async sessionId => {
    const value = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in value) throw new Error(JSON.stringify(value.error))
    return value.agent
  }
  const inspect = async sessionId => {
    const agent = await agentFor(sessionId)
    await ctx.sessionPersistence.flush()
    const handle = await ctx.sessionPersistence.open(sessionId, 'read'), events = []
    try {
      for (let offset = 0;;) {
        const page = await handle.read(offset, 512)
        if (!page.events.length) break
        events.push(...page.events); offset += page.events.length
      }
    } finally { await handle[Symbol.asyncDispose]() }
    return { sessionId, header: agent.session.header, preset: ctx.agentPresets.presetForSession(agent.session), status: agent.status, model: agent.model.current(), events,
      inbox: { nextTurn: agent.inbox.nextTurn.length, nextStep: agent.inbox.nextStep.length } }
  }
  const readBody = async req => {
    let body = ''
    for await (const chunk of req) { body += chunk; if (body.length > 131072) throw new Error('Fixture request too large') }
    return body ? JSON.parse(body) : {}
  }
  ctx.webServer.register({ kind: 'prefix', path: '/__spirit-fixture', handler: async (req, res) => {
    const origin = ctx.webServer.getOrigin(), expectedHost = new URL(origin).host
    if (req.headers.authorization !== `Bearer ${token}` || req.headers.host !== expectedHost
      || req.headers.origin && req.headers.origin !== origin) { json(res, 403, { error: 'Fixture local authorization required' }); return }
    try {
      const url = new URL(req.url, origin), route = url.pathname.slice('/__spirit-fixture'.length)
      if (req.method === 'GET' && route === '/ready') return json(res, 200, { ready: true, provider: PROVIDER, providers: ctx.llm.listProviders() })
      if (req.method === 'GET' && route === '/trace') return json(res, 200, { trace, pending: [...pending.values()].map(value => value.item) })
      if (req.method === 'GET' && route === '/flush-barrier') return json(res, 200, flushBarrier
        ? { id: flushBarrier.id, entered: flushBarrier.entered, enteredAt: flushBarrier.enteredAt, released: false } : lastBarrier ?? { armed: false })
      if (req.method === 'GET' && route === '/inspect') return json(res, 200, await inspect(url.searchParams.get('sessionId')))
      if (req.method === 'GET' && route === '/roster') {
        const agent = await agentFor(url.searchParams.get('sessionId'))
        const toolSet = await agent.ctx.tools.resolve({ agent, modelSelection: agent.model.current(), signal: AbortSignal.timeout(10_000) })
        try { return json(res, 200, { tools: [...toolSet.view(agent).keys()] }) } finally { toolSet.dispose() }
      }
      if (req.method === 'GET' && route === '/sessions') return json(res, 200, await ctx.sessionController.list({}, new AbortController().signal))
      if (req.method === 'GET' && route === '/workspaces') return json(res, 200, ctx.workspaceRegistry.list()
        .map(value => ({ id: value.id, path: value.path, sessionIds: [...value.sessionIds] })))
      if (req.method === 'POST' && route === '/native-create') return json(res, 200, await ctx.sessionController.create(await readBody(req)))
      if (req.method === 'POST' && route === '/turn') {
        const body = await readBody(req), agent = await agentFor(body.sessionId)
        const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `${MARKER}${JSON.stringify(body.script)}` }] })
        agent.followup(message)
        if (body.wait !== false) { await agent.whenIdle(); return json(res, 200, { messageId: message.id, ...await inspect(agent.id) }) }
        return json(res, 202, { messageId: message.id })
      }
      if (req.method === 'POST' && route === '/approval') {
        const body = await readBody(req), item = pending.get(body.id)
        if (!item || !['allowed-once', 'rejected', 'cancelled'].includes(body.outcome)) throw new Error('Unknown pending approval or outcome')
        item.finish(body.outcome); return json(res, 200, { answered: body.id, outcome: body.outcome })
      }
      if (req.method === 'POST' && route === '/behavior') {
        const body = await readBody(req)
        if (!['ack', 'silent'].includes(body.autonomy)) throw new Error('Unknown fixture autonomy behavior')
        autonomyBehavior = body.autonomy; return json(res, 200, { autonomy: autonomyBehavior })
      }
      if (req.method === 'POST' && route === '/flush-barrier') {
        const body = await readBody(req)
        if (body.action === 'arm') {
          if (!flushHookInstalled) throw new Error('Native flush hook has already been restored')
          if (flushBarrier) throw new Error('A native flush barrier is already armed')
          let release
          const wait = new Promise(resolveWait => { release = resolveWait })
          flushBarrier = { id: randomUUID(), entered: false, wait, release }
          return json(res, 200, { id: flushBarrier.id, armed: true })
        }
        if (body.action === 'release') { releaseFlush(); return json(res, 200, lastBarrier ?? { armed: false }) }
        if (body.action === 'restore') { restoreFlush(); return json(res, 200, { restored: true }) }
        throw new Error('Unknown native flush barrier action')
      }
      json(res, 404, { error: 'Unknown fixture route' })
    } catch (error) { json(res, 400, { error: String(error), stack: error?.stack }) }
  } })
  ctx.effect(() => () => { restoreFlush(); for (const value of pending.values()) value.finish('cancelled') })
  writeFileSync(process.env.SPIRIT_TEST_ADDRESS_FILE, JSON.stringify({ pid: process.pid, origin: ctx.webServer.getOrigin() }))
}

async function poll(check, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value } catch (error) { if (error?.fatal) throw error; last = error }
    await delay(100)
  }
  throw new Error(`Timed out: ${label}${last ? `; ${last}` : ''}`)
}
function parseArgs(args) {
  const value = {}
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (!key.startsWith('--') || !args[index + 1]) throw new Error(`Expected --name value, got ${key}`)
    value[key.slice(2)] = args[++index]
  }
  return value
}
function decodedResult(event) {
  const message = event?.data?.message
  assert(message, 'The native log must contain a tool/result message')
  let content = textOf(message)
  assert(!message.isError, `Native tool failed: ${content}`)
  // Native output spilling is part of the real execution path. Read its test-created artifact instead of mistaking a truncated JSON preview for a value.
  const spill = /Full formatted result stored at: ([^\n]+?\.txt)\./.exec(content)?.[1]
  if (spill && existsSync(spill)) content = readFileSync(spill, 'utf8')
  try { return JSON.parse(content) } catch { return content }
}
function findSessionId(value) {
  return [...flatten(value)].find(item => typeof item.sessionId === 'string')?.sessionId
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const runtime = resolve(args.runtime ?? '/workspace/scratch/spirit-runtime-rc3')
  const scratch = resolve(args.scratch ?? `/tmp/spirit-runtime-validation-${Date.now()}`)
  const packageSource = resolve(args.package ?? PACKAGE)
  const reportPath = join(scratch, 'report.json'), addressFile = join(scratch, 'runtime-address.json')
  const runtimeVersion = JSON.parse(readFileSync(join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'))).version
  assert.equal(runtimeVersion, '0.2.2-rc.3', 'This controlled integration test targets an exact Harness generation')
  assert(existsSync(join(packageSource, 'lib/index.js')), 'Build Spirit before running runtime-smoke.mjs')
  const packageManifest = JSON.parse(readFileSync(join(packageSource, 'package.json')))
  const packageName = packageManifest.name
  const build = { packageName, packageVersion: packageManifest.version,
    indexSha256: createHash('sha256').update(readFileSync(join(packageSource, 'lib/index.js'))).digest('hex'),
    fixtureSha256: createHash('sha256').update(readFileSync(FILE)).digest('hex') }
  mkdirSync(scratch, { recursive: true })
  const home = join(scratch, 'home'), profile = join(home, 'profiles', 'spirit-runtime-test'), snapshot = join(scratch, 'package'), state = join(scratch, 'state')
  assert(!existsSync(join(state, 'personal.sqlite')), 'Use a fresh scratch directory; restart is tested within one run')
  mkdirSync(join(profile, 'node_modules'), { recursive: true }); mkdirSync(snapshot, { recursive: true }); mkdirSync(state, { recursive: true })
  for (const entry of ['package.json', 'cordis.patch.yml', 'lib', 'src', 'upstream', 'scripts', 'tests', 'marketplace/locale', 'tsconfig.json', 'tsdown.config.ts', 'vitest.config.ts']) {
    if (existsSync(join(packageSource, entry))) cpSync(join(packageSource, entry), join(snapshot, entry), { recursive: true })
  }
  mkdirSync(join(snapshot, 'node_modules'), { recursive: true })
  symlinkSync(join(runtime, 'node_modules/@deepseek-ai'), join(snapshot, 'node_modules/@deepseek-ai'), 'dir')
  for (const dependency of ['zod', 'proper-lockfile']) symlinkSync(join(packageSource, 'node_modules', dependency), join(snapshot, 'node_modules', dependency), 'dir')
  mkdirSync(dirname(join(profile, 'node_modules', packageName)), { recursive: true })
  symlinkSync(snapshot, join(profile, 'node_modules', packageName), 'dir')
  symlinkSync(join(runtime, 'node_modules/@deepseek-ai'), join(profile, 'node_modules/@deepseek-ai'), 'dir')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-spirit-runtime-test', private: true,
    dependencies: { [packageName]: `file:${snapshot}` }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', packageName] } } }, null, 2))
  writeFileSync(join(profile, 'cordis.yml'), '[]\n')
  writeFileSync(join(profile, 'cordis.patch.yml'), [
    '- id: dsh-spirit', '  config:', `    stateDir: ${JSON.stringify(state)}`, '    concurrency: 2',
    '- id: agent-default-model', '  config:', `    provider: ${PROVIDER}`, '    model: fixture-one', '    reasoningEffort: low',
    ...['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-title-llm'].flatMap(id => [`- id: ${id}`, '  disabled: true']),
    '- insert:', '    - id: spirit-runtime-fixture', `      name: ${JSON.stringify(FILE)}`, '',
  ].join('\n'))
  const token = randomBytes(32).toString('hex'), checks = [], nativeArtifacts = []
  let child, origin, bootNumber = 0, processError
  const evidence = (name, value) => { checks.push({ name, passed: true, ...value }); process.stdout.write(`PASS ${name}\n`) }
  const request = async (route, data, fixture = true) => {
    const response = await fetch(`${origin}${fixture ? '/__spirit-fixture' : '/personal-spirit/api'}${route}`, {
      method: data === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${token}`, 'x-personal-spirit': '1', ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
    const value = await response.json()
    if (!response.ok) throw new Error(`${response.status} ${route}: ${JSON.stringify(value)}`)
    return value
  }
  const inspect = sessionId => request(`/inspect?sessionId=${encodeURIComponent(sessionId)}`)
  const run = async (sessionId, name, toolArgs, options = {}) => {
    const id = randomUUID(), result = await request('/turn', { sessionId, script: { id, calls: [{ name, args: toolArgs }] }, wait: options.wait !== false })
    if (options.wait === false) return { id, callId: callId(id, 0), ...result }
    const event = result.events.findLast(item => item.type === 'tool/result' && item.data.message.toolCallId === callId(id, 0))
    nativeArtifacts.push({ name, args: toolArgs, event })
    return { result: options.allowError && event?.data.message.isError ? { error: textOf(event.data.message) } : decodedResult(event), log: result, event }
  }
  const sqlValues = table => {
    const db = new DatabaseSync(join(state, 'personal.sqlite'), { readOnly: true })
    try { return db.prepare(`SELECT value FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.value)) } finally { db.close() }
  }
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const stopped = new Promise(resolveExit => child.once('exit', resolveExit))
    child.kill('SIGTERM')
    let timeout
    try { await Promise.race([stopped, new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Runtime shutdown timed out')), 20_000) })]) }
    finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
  }
  const boot = async () => {
    bootNumber++; rmSync(addressFile, { force: true }); processError = undefined
    const log = join(scratch, `host-${bootNumber}.log`)
    child = spawn(process.execPath, [join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'spirit-runtime-test', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: scratch, env: { ...process.env, DSH_HOME: home, SPIRIT_TEST_RUNTIME: runtime, SPIRIT_TEST_TOKEN: token, SPIRIT_TEST_ADDRESS_FILE: addressFile },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const append = chunk => { output += chunk; writeFileSync(log, output) }
    child.stdout.on('data', append); child.stderr.on('data', append)
    child.once('error', error => { processError = error })
    await poll(() => {
      if (processError) throw Object.assign(processError, { fatal: true })
      if (child.exitCode !== null || child.signalCode !== null) throw Object.assign(new Error(`Harness exited ${child.exitCode ?? child.signalCode}; inspect ${log}`), { fatal: true })
      if (!existsSync(addressFile)) return
      origin = JSON.parse(readFileSync(addressFile)).origin
      return true
    }, 'fixture host startup', 60_000)
    await poll(async () => { const value = await request('/state', undefined, false); return value.mainId && value }, 'Spirit full mount', 45_000)
    return request('/state', undefined, false)
  }
  try {
    let panel = await boot(), mainId = panel.mainId
    const ready = await request('/ready')
    assert.deepEqual(ready.providers.map(value => value.id), [PROVIDER], 'Only the no-network fixture provider is registered')
    const initialMain = await inspect(mainId)
    assert.equal(initialMain.header.cwd, join(state, 'workspace'))
    const initialWorkspaces = await request('/workspaces')
    assert(initialWorkspaces.some(value => value.path === initialMain.header.cwd && value.sessionIds.includes(mainId)), 'Main session must belong to a native Workspace, not only have a cwd')
    nativeArtifacts.push({ name: 'initial-native-session-metadata', model: initialMain.model, header: initialMain.header,
      workspaces: initialWorkspaces, events: initialMain.events })
    // Exactly the Web connectWorkspace path: a named blank Session, Workspace, and no agentPreset field.
    const mainWorkspace = initialWorkspaces.find(value => value.sessionIds.includes(mainId))
    assert.equal(initialMain.preset, 'dsh-spirit')
    const reused = await request('/native-create', { sessionId: mainId, workspaceId: mainWorkspace.id })
    assert.equal(reused.sessionId, mainId)
    assert.equal(reused.agentPreset, 'dsh-spirit')
    assert.equal((await inspect(mainId)).preset, 'dsh-spirit', 'Implicit native blank reuse must preserve the managed Spirit preset')
    const reusedRoster = (await request(`/roster?sessionId=${encodeURIComponent(mainId)}`)).tools
    assert(['spirit_read', 'spirit_intent', 'spirit_decide', 'spirit_sessions', 'bash', 'read'].every(name => reusedRoster.includes(name)),
      'Implicit native blank reuse preserves both Spirit tools and its native preset composition before any prompt')
    const explicitlyStandard = await request('/native-create', { sessionId: mainId, workspaceId: mainWorkspace.id, agentPreset: 'standard' })
    assert.equal(explicitlyStandard.sessionId, mainId)
    assert.equal((await inspect(mainId)).preset, 'standard', 'An explicit owner preset choice must remain native behavior')
    await request('/native-create', { sessionId: mainId, workspaceId: mainWorkspace.id })
    assert.equal((await inspect(mainId)).preset, 'standard', 'Later implicit reuse must preserve an explicitly changed managed preset too')
    await request('/native-create', { sessionId: mainId, workspaceId: mainWorkspace.id, agentPreset: 'dsh-spirit' })
    assert.equal((await inspect(mainId)).preset, 'dsh-spirit')
    const unmanaged = await request('/native-create', { sessionId: `unmanaged-fixture-${randomUUID()}`, workspaceId: mainWorkspace.id })
    assert.equal((await inspect(unmanaged.sessionId)).preset, 'standard', 'Unmanaged native sessions retain the host default')
    assert(!(await request(`/roster?sessionId=${encodeURIComponent(unmanaged.sessionId)}`)).tools.includes('spirit_intent'), 'Spirit tool bindings must not leak into unmanaged native sessions')
    nativeArtifacts.push({ name: 'native-blank-main-reuse', reused, reusedRoster, explicitlyStandard, unmanaged,
      restoredMain: { preset: (await inspect(mainId)).preset, workspaceId: mainWorkspace.id } })
    const mounted = await run(mainId, 'spirit_read', {})
    evidence('full package mounts and native agent executes Spirit tools', { mainId, runtimeVersion })
    assert(mounted.log.events.some(event => event.type === 'tool/call' && event.data.name === 'spirit_read'))
    const roster = (await request('/trace')).trace.find(value => value.sessionId === mainId)?.tools ?? []
    assert(roster.includes('spirit_read') && roster.includes('spirit_sessions') && roster.includes('spirit_intent') && roster.includes('spirit_decide'))
    assert(roster.includes('bash') && roster.includes('read'), 'Native Spirit preset capabilities remain mounted after implicit blank reuse')
    assert(!roster.some(name => /^spirit_(control|permissions|permission|set_access|set_state)$/.test(name)), 'Owner permission and activity setters must not be model tools')
    evidence('model tool roster exposes continuity tools without owner control setters')
    evidence('native blank reuse preserves Spirit preset and tools while respecting explicit and unmanaged choices')
    await request('/permissions', { mode: 'full' }, false)
    const catalog = await run(mainId, 'spirit_sessions', { action: 'models' })
    assert([...flatten(catalog.result)].some(value => value.id === 'high'))
    const childCreated = await run(mainId, 'spirit_sessions', { action: 'create', title: 'Runtime fixture child', cwd: join(state, 'fixture-child'),
      selection: { provider: PROVIDER, model: 'fixture-one', reasoningEffort: 'low' }, reason: '测试原生会话创建，不连接外部服务' })
    const childId = findSessionId(childCreated.result)
    assert(childId && childId !== mainId, 'Spirit must return the native created session ID')
    const posted = await run(mainId, 'spirit_sessions', { action: 'post', sessionId: childId, text: 'Runtime provenance fixture.',
      mode: 'queue', reason: '测试自身来源不会伪装成本人' })
    assert([...flatten(posted.result)].some(value => value.accepted === true))
    await poll(async () => (await inspect(childId)).status === 'idle', 'child turn completion')
    const childLog = await inspect(childId)
    assert((await request('/workspaces')).some(value => value.path === childLog.header.cwd && value.sessionIds.includes(childId)), 'Created child must have native Workspace membership')
    const relay = childLog.events.find(event => event.type === 'user/message' && event.data.source.kind === 'spirit')
    assert(relay, 'Posted input retains Spirit provenance in the native durable log')
    assert.equal(relay.data.source.fromSessionId, mainId)
    const nativeRead = await run(mainId, 'spirit_sessions', { action: 'read', sessionId: childId, maxMessages: 100 })
    assert([...flatten(nativeRead.result)].some(value => value.kind === 'spirit' && value.fromSessionId === mainId))
    evidence('native create/read/post preserves self attribution and workspace membership', { childId, messageId: relay.data.id })
    await run(mainId, 'spirit_sessions', { action: 'model', sessionId: childId,
      selection: { provider: PROVIDER, model: 'fixture-two', reasoningEffort: 'high' }, reason: '测试原生模型与推理强度的持久选择' })
    await run(mainId, 'spirit_sessions', { action: 'post', sessionId: childId, text: 'Force the selected fixture model into a real request.', mode: 'queue', reason: '检验下一原生请求采用所选配置' })
    await poll(async () => (await inspect(childId)).status === 'idle', 'selected model turn')
    assert.deepEqual((await inspect(childId)).model, { provider: PROVIDER, model: 'fixture-two', reasoningEffort: 'high' })
    assert((await request('/trace')).trace.some(value => value.sessionId === childId && value.model === 'fixture-two' && value.reasoningEffort === 'high'))
    evidence('session-local model and reasoning effort reach native requests')

    await request('/permissions', { mode: 'ask' }, false)
    const before = (await request('/sessions')).items.length
    const rejectedCall = await run(mainId, 'spirit_sessions', { action: 'create', title: 'Must not exist after reject',
      cwd: join(state, 'rejected-child'), reason: '测试敏感操作等待真实原生批准' }, { wait: false })
    const pending = await poll(async () => (await request('/trace')).pending.find(value => value.callId === rejectedCall.callId), 'native approval pending')
    assert.equal((await request('/sessions')).items.length, before)
    const waitingLog = await inspect(mainId)
    assert(waitingLog.events.some(value => value.type === 'approval/asked' && value.data.callId === rejectedCall.callId))
    await request('/approval', { id: pending.id, outcome: 'rejected' })
    await poll(async () => (await inspect(mainId)).status === 'idle', 'rejected approval turn')
    const rejectedLog = await inspect(mainId)
    assert(rejectedLog.events.findLast(value => value.type === 'tool/result' && value.data.message.toolCallId === rejectedCall.callId)?.data.message.isError)
    assert(rejectedLog.events.some(value => value.type === 'approval/decided' && value.data.outcome === 'rejected'))
    assert.equal((await request('/sessions')).items.length, before)
    evidence('ask mode awaits and records native rejection before mutation')
    const pausedCall = await run(mainId, 'spirit_sessions', { action: 'create', title: 'Must not exist after paused approval',
      cwd: join(state, 'paused-approval-child'), reason: '测试本人暂停会撤回仍在等待的原生批准' }, { wait: false })
    await poll(async () => (await request('/trace')).pending.find(value => value.callId === pausedCall.callId), 'second native approval pending')
    await request('/control', { action: 'pause' }, false)
    await poll(async () => (await inspect(mainId)).status === 'idle', 'pause withdraws active approval')
    assert.equal((await request('/sessions')).items.length, before)
    assert(!(await request('/trace')).pending.some(value => value.callId === pausedCall.callId))
    assert((await inspect(mainId)).events.some(value => value.type === 'approval/decided' && value.data.outcome === 'cancelled'))
    await request('/control', { action: 'resume' }, false)
    evidence('pause withdraws a pending native approval before its mutation')
    const changedCall = await run(mainId, 'spirit_sessions', { action: 'create', title: 'Must not exist after changed grant',
      cwd: join(state, 'changed-grant-child'), reason: '测试等待批准期间权限修改使旧授权失效' }, { wait: false })
    const changing = await poll(async () => (await request('/trace')).pending.find(value => value.callId === changedCall.callId), 'approval before owner permission changes')
    await request('/permissions', { mode: 'full' }, false)
    await request('/permissions', { mode: 'ask' }, false)
    const stillPending = (await request('/trace')).pending.find(value => value.id === changing.id)
    if (stillPending) await request('/approval', { id: changing.id, outcome: 'allowed-once' })
    await poll(async () => (await inspect(mainId)).status === 'idle', 'changed permission grant rejected')
    assert.equal((await request('/sessions')).items.length, before)
    assert((await inspect(mainId)).events.findLast(value => value.type === 'tool/result' && value.data.message.toolCallId === changedCall.callId)?.data.message.isError)
    evidence('permission changes invalidate an outstanding native approval grant')
    await request('/permissions', { mode: 'full' }, false)
    const approvalCount = (await inspect(mainId)).events.filter(value => value.type === 'approval/asked').length
    await run(mainId, 'spirit_sessions', { action: 'create', title: 'Full permission fixture', cwd: join(state, 'full-child'), reason: '检验本人已选完全访问' })
    assert.equal((await inspect(mainId)).events.filter(value => value.type === 'approval/asked').length, approvalCount)
    evidence('full permission uses the selected standing access without extra asks')

    const change = await run(mainId, 'spirit_change', { action: 'begin', targets: ['spirit'],
      reason: '只在独立的运行时测试安装中验证可恢复的源码改动', priorLimitations: '尚未证明实际宿主中的验证命令与回退路径能一起工作',
      criteria: ['候选文件通过 Node 语法检查', '应用后文件存在，回退后移除'], evidence: ['受控的原生工具调用与本地候选目录'], retainedContent: ['保持现有插件源代码原样'] })
    const changeRecord = [...flatten(change.result)].find(value => value.schema === 1 && value.targets?.[0]?.candidateDirectory)
    assert(changeRecord, 'Self-change must return a recorded candidate directory')
    const probe = 'runtime-fixture-probe.cjs', candidateProbe = join(changeRecord.targets[0].candidateDirectory, probe)
    assert(resolve(candidateProbe).startsWith(`${state}/`), 'The fixture edits only the isolated candidate')
    writeFileSync(candidateProbe, 'module.exports = ;\n')
    const verificationChecks = [{ target: 'spirit', command: `${shellQuote(process.execPath)} --check ${shellQuote(probe)}` }]
    const failedCheck = await run(mainId, 'spirit_change', { action: 'verify', id: changeRecord.id, checks: verificationChecks, timeoutMs: 10_000 })
    assert([...flatten(failedCheck.result)].some(value => value.state === 'verification-failed'))
    const refusedApply = await run(mainId, 'spirit_change', { action: 'apply', id: changeRecord.id }, { allowError: true })
    assert(refusedApply.event.data.message.isError)
    assert(!existsSync(join(snapshot, probe)))
    writeFileSync(candidateProbe, 'module.exports = Object.freeze({ fixture: true });\n')
    const verified = await run(mainId, 'spirit_change', { action: 'verify', id: changeRecord.id, checks: verificationChecks, timeoutMs: 10_000 })
    assert([...flatten(verified.result)].some(value => value.state === 'verified'))
    await run(mainId, 'spirit_change', { action: 'apply', id: changeRecord.id })
    assert.equal(readFileSync(join(snapshot, probe), 'utf8'), readFileSync(candidateProbe, 'utf8'))
    const rolledBack = await run(mainId, 'spirit_change', { action: 'rollback', id: changeRecord.id })
    assert([...flatten(rolledBack.result)].some(value => value.state === 'rolled-back'))
    assert(!existsSync(join(snapshot, probe)))
    evidence('self-change verifies through native shell, refuses failed checks, applies and rolls back a local candidate', { changeId: changeRecord.id })

    await request('/behavior', { autonomy: 'silent' })
    const silentIntent = await run(mainId, 'spirit_intent', { statement: '接收不等于判断的测试意向', reason: '验证接收过的机会在恢复后不会被伪报完成或重复派发',
      state: 'waiting', revisit: { at: new Date(Date.now() + 3500).toISOString() } })
    const silentIntentId = [...flatten(silentIntent.result)].find(value => value.statement === '接收不等于判断的测试意向')?.id
    const unacknowledged = await poll(() => {
      const revisit = sqlValues('spirit_autonomy_revisit').find(value => value.intentId === silentIntentId)
      return sqlValues('spirit_autonomy_opportunity').find(value => value.id === revisit?.opportunityId && value.state === 'awaiting_decision')
    }, 'accepted opportunity without a model decision')
    await poll(async () => (await inspect(mainId)).status === 'idle', 'silent fixture turn ends')
    const originalRelayCount = (await inspect(mainId)).events.filter(value => value.type === 'user/message' && value.data.source.requestId === unacknowledged.dispatchId).length
    assert.equal(originalRelayCount, 1)
    const due = new Date(Date.now() + 3500).toISOString()
    const intentResult = await run(mainId, 'spirit_intent', { statement: '持久的测试意向', reason: '仅验证模型选择的一次性再考虑在进程重启后仍有效',
      state: 'waiting', revisit: { at: due } })
    const intentId = [...flatten(intentResult.result)].find(value => value.statement === '持久的测试意向')?.id
    assert(intentId)
    await stop()
    await delay(Math.max(0, Date.parse(due) - Date.now() + 100))
    panel = await boot(); assert.equal(panel.mainId, mainId)
    const restoredWorkspaces = await request('/workspaces')
    assert(restoredWorkspaces.some(value => value.sessionIds.includes(mainId)))
    assert(restoredWorkspaces.some(value => value.sessionIds.includes(childId)))
    assert.deepEqual((await inspect(childId)).model, { provider: PROVIDER, model: 'fixture-two', reasoningEffort: 'high' })
    assert((await inspect(childId)).events.some(value => value.type === 'user/message' && value.data.id === relay.data.id))
    await delay(1200)
    assert.equal(sqlValues('spirit_autonomy_opportunity').find(value => value.id === unacknowledged.id)?.state, 'awaiting_decision')
    assert.equal(sqlValues('spirit_autonomy_opportunity').find(value => value.id === unacknowledged.id)?.dispatchId, unacknowledged.dispatchId)
    assert.equal((await inspect(mainId)).events.filter(value => value.type === 'user/message' && value.data.source.requestId === unacknowledged.dispatchId).length, 1)
    assert(!(await request('/trace')).trace.some(value => value.dispatchId === unacknowledged.dispatchId))
    evidence('restart preserves awaiting_decision and never duplicates an accepted background turn')
    await run(mainId, 'spirit_read', { action: 'retry', opportunityId: unacknowledged.id, reason: '测试明确重试未记录判断的机会' })
    const retried = await poll(() => sqlValues('spirit_autonomy_opportunity').find(value => value.id === unacknowledged.id && value.state === 'settled'), 'explicit retry is acknowledged')
    assert.notEqual(retried.dispatchId, unacknowledged.dispatchId)
    const settled = await poll(() => {
      const revisit = sqlValues('spirit_autonomy_revisit').find(value => value.intentId === intentId)
      return sqlValues('spirit_autonomy_opportunity').find(value => value.id === revisit?.opportunityId && value.state === 'settled')
    }, 'restored revisit acknowledged by native model turn')
    const restored = await inspect(mainId)
    assert(restored.events.some(value => value.type === 'tool/call' && value.data.name === 'spirit_decide'))
    assert(sqlValues('spirit_autonomy_decision').some(value => value.opportunityId === settled.id && value.decision === 'refrain'))
    assert.equal(sqlValues('spirit_autonomy_intent').find(value => value.id === intentId)?.state, 'waiting')
    evidence('restart preserves native logs/model choice and one-shot revisit reaches spirit_decide', { opportunityId: settled.id, dispatchId: settled.dispatchId })

    const sessionsBeforeRace = (await request('/sessions')).items.length
    await request('/turn', { sessionId: childId, script: { id: randomUUID(), hold: true, calls: [] }, wait: false })
    await poll(async () => (await request('/trace')).trace.some(value => value.sessionId === childId && value.hold), 'child held before permission/pause race')
    const queuedScript = { id: randomUUID(), calls: [{ name: 'spirit_sessions', args: { action: 'create', title: 'Queued mutation must be cancelled',
      cwd: join(state, 'stale-queue-child'), reason: '验证本人控制改变后旧队列不会重新执行' } }] }
    await request('/turn', { sessionId: childId, script: queuedScript, wait: false })
    assert((await inspect(childId)).inbox.nextTurn > 0)
    await Promise.allSettled([request('/permissions', { mode: 'full' }, false), request('/control', { action: 'pause' }, false)])
    await poll(async () => (await inspect(childId)).status === 'idle', 'parallel owner controls cancel child')
    await request('/control', { action: 'resume' }, false)
    const converged = await poll(async () => { const value = await request('/state', undefined, false); return value.permissions?.status !== 'pending' && value }, 'permission synchronization converges after pause/resume')
    assert.equal(converged.permissions.status, 'applied')
    await delay(300)
    const cancelledQueue = await inspect(childId)
    assert.equal(cancelledQueue.inbox.nextTurn + cancelledQueue.inbox.nextStep, 0)
    assert(!cancelledQueue.events.some(value => value.type === 'tool/call' && value.data.callId === callId(queuedScript.id, 0)))
    assert.equal((await request('/sessions')).items.length, sessionsBeforeRace)
    evidence('parallel permission/pause controls converge and revoke queued native activity')

    await request('/flush-barrier', { action: 'arm' })
    // Capture rejections immediately: superseded owner requests are allowed to reject, but must never leave the latest state pending.
    const pausing = request('/control', { action: 'pause' }, false).then(value => ({ value }), error => ({ error: String(error) }))
    await poll(async () => (await request('/flush-barrier')).entered, 'pause reaches held native flush completion')
    const resuming = request('/control', { action: 'resume' }, false).then(value => ({ value }), error => ({ error: String(error) }))
    await poll(async () => (await request('/state', undefined, false)).autonomy?.state === 'running', 'resume records latest owner revision while earlier flush is held')
    await request('/flush-barrier', { action: 'release' })
    await Promise.all([pausing, resuming])
    const afterHeldPause = await request('/state', undefined, false)
    assert.equal(afterHeldPause.autonomy.state, 'running'); assert.equal(afterHeldPause.permissions.status, 'applied')
    evidence('fault injection: delayed native pause flush cannot overtake newer resume permission state')

    await request('/flush-barrier', { action: 'arm' })
    const settingAsk = request('/permissions', { mode: 'ask' }, false).then(value => ({ value }), error => ({ error: String(error) }))
    await poll(async () => (await request('/flush-barrier')).entered, 'permission sync reaches held native flush completion')
    const overlappingPause = request('/control', { action: 'pause' }, false).then(value => ({ value }), error => ({ error: String(error) }))
    await poll(async () => (await request('/state', undefined, false)).autonomy?.state === 'paused', 'overlapping pause records owner state')
    const overlappingResume = request('/control', { action: 'resume' }, false).then(value => ({ value }), error => ({ error: String(error) }))
    await poll(async () => (await request('/state', undefined, false)).autonomy?.state === 'running', 'overlapping resume records owner state')
    await request('/flush-barrier', { action: 'release' })
    await Promise.all([settingAsk, overlappingPause, overlappingResume])
    const afterHeldPermission = await request('/state', undefined, false)
    assert.equal(afterHeldPermission.autonomy.state, 'running'); assert.equal(afterHeldPermission.permissions.status, 'applied')
    assert.equal(afterHeldPermission.permissions.mode, 'ask')
    evidence('fault injection: permission/pause/resume overlap reconciles the latest owner revision')
    await request('/flush-barrier', { action: 'restore' })
    await request('/permissions', { mode: 'full' }, false)

    await run(mainId, 'spirit_intent', { statement: '暂停时不派发', reason: '验证暂停只保留机会', state: 'waiting', revisit: { at: new Date(Date.now() + 3500).toISOString() } })
    await request('/control', { action: 'pause' }, false)
    const callsAtPause = (await request('/trace')).trace.length
    const pausedPrompt = { id: randomUUID(), calls: [{ name: 'spirit_sessions', args: { action: 'create', title: 'Direct prompt while paused',
      cwd: join(state, 'direct-paused-child'), reason: '只验证暂停期间直接原生输入不触发模型或工具' } }] }
    const pausedNative = await request('/turn', { sessionId: mainId, script: pausedPrompt })
    assert(!(await request('/trace')).trace.some(value => value.call?.id === callId(pausedPrompt.id, 0)))
    assert(!pausedNative.events.some(value => value.type === 'tool/call' && value.data.callId === callId(pausedPrompt.id, 0)))
    assert.equal((await request('/trace')).trace.length, callsAtPause)
    assert.equal(pausedNative.events.findLast(value => value.type === 'turn/end')?.data.reason.kind, 'blocked')
    assert.equal(pausedNative.inbox.nextTurn + pausedNative.inbox.nextStep, 0, 'Native pre-step rejection does not pretend the claimed message is still queued')
    nativeArtifacts.push({ name: 'direct-native-prompt-during-pause', messageId: pausedNative.messageId, inbox: pausedNative.inbox,
      turnEnd: pausedNative.events.findLast(value => value.type === 'turn/end') })
    evidence('direct native input while paused invokes neither model stream nor tool action')
    await delay(4500)
    assert.equal((await request('/trace')).trace.length, callsAtPause)
    evidence('pause prevents deadline dispatch while keeping unresolved intentions')
    await request('/control', { action: 'resume' }, false)
    await poll(async () => (await request('/trace')).trace.length > callsAtPause, 'resume reconsideration')
    await poll(async () => (await inspect(mainId)).status === 'idle', 'resume acknowledgement')
    assert(!(await inspect(mainId)).events.some(value => value.type === 'tool/call' && value.data.callId === callId(pausedPrompt.id, 0)), 'Resume must not replay the rejected direct prompt')
    const held = { id: randomUUID(), hold: true, calls: [] }
    await request('/turn', { sessionId: mainId, script: held, wait: false })
    await poll(async () => (await request('/trace')).trace.some(value => value.hold), 'held native stream')
    await request('/control', { action: 'pause' }, false)
    await poll(async () => (await inspect(mainId)).status === 'idle', 'pause cancels active native stream')
    await request('/control', { action: 'resume' }, false)
    await run(mainId, 'spirit_intent', { statement: '停止后不复活', reason: '验证停止取消既有意向和机会', state: 'waiting', revisit: { at: new Date(Date.now() + 3500).toISOString() } })
    await request('/control', { action: 'stop' }, false)
    const callsAtStop = (await request('/trace')).trace.length
    await delay(4500)
    assert.equal((await request('/trace')).trace.length, callsAtStop)
    assert(sqlValues('spirit_autonomy_intent').filter(value => value.state !== 'done').every(value => value.state === 'cancelled'))
    evidence('pause cancels active inference and stop prevents future autonomous actions')
    const finalTrace = await request('/trace')
    writeFileSync(join(scratch, 'native-evidence.json'), JSON.stringify({ artifacts: nativeArtifacts, trace: finalTrace.trace,
      main: await inspect(mainId), child: await inspect(childId), opportunities: sqlValues('spirit_autonomy_opportunity'), decisions: sqlValues('spirit_autonomy_decision') }, null, 2))
    writeFileSync(reportPath, JSON.stringify({ passed: true, kind: 'controlled-runtime-integration', disclaimer: 'Deterministic local protocol fixtures; no live-model reasoning or learning evaluated.',
      runtimeVersion, build, checks, evidence: join(scratch, 'native-evidence.json') }, null, 2))
    process.stdout.write(`Controlled runtime integration passed. Evidence: ${reportPath}\n`)
  } catch (error) {
    writeFileSync(join(scratch, 'native-failure-evidence.json'), JSON.stringify({ artifacts: nativeArtifacts,
      ...(origin ? { runtime: await request('/trace').catch(value => ({ error: String(value) })) } : {}) }, null, 2))
    writeFileSync(reportPath, JSON.stringify({ passed: false, kind: 'controlled-runtime-integration', runtimeVersion, build, checks, error: String(error), stack: error?.stack }, null, 2))
    throw error
  } finally { await stop() }
}

if (process.argv[1] && resolve(process.argv[1]) === FILE) {
  main().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1 })
}
