#!/usr/bin/env node
/**
 * Controlled integration test against the real Harness 0.2.2-rc.5 host.
 * This file is both a CLI driver and a test-only Cordis companion plugin.
 * Its local deterministic adapter emits protocol fixtures, not model reasoning.
 * No provider account, paid request, or external message is used.
 *
 * node tests/runtime-smoke.mjs --runtime /path/to/rc5-install --scratch /tmp/spirit-runtime-test
 * Use --suite open-activity to exercise the real idle timer in a separate profile.
 * Build Spirit first. The driver snapshots the package and uses an isolated DSH_HOME.
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { verifyChatRuntime } from './chat-runtime.mjs'
import { verifyMediationRuntime } from './mediation-runtime.mjs'
import { verifyNativeInteractionsRuntime } from './native-interactions-runtime.mjs'
import { verifyVoiceRuntime } from './voice-runtime.mjs'

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
  for (const part of message.content ?? []) {
    if (part.type !== 'text') continue
    const relayedAt = message.source?.kind === 'spirit' ? part.text.indexOf(`\n\n${MARKER}`) : -1
    const at = relayedAt < 0 ? 0 : relayedAt + 2
    if (part.text.startsWith(MARKER, at)) return { script: JSON.parse(part.text.slice(at + MARKER.length)) }
  }
  const content = textOf(message)
  const start = content.indexOf('{')
  if (start < 0) return
  try {
    const parsed = JSON.parse(content.slice(start))
    const packet = [...flatten(parsed)].find(item => typeof item.dispatchId === 'string' && typeof item.opportunity?.id === 'string')
    if (packet) return { packet }
  } catch { /* Ordinary prose is not a fixture command. */ }
}

export const name = 'spirit-runtime-fixture'
export const inject = ['llm', 'agents', 'agentPresets', 'agentTeams', 'subagents', 'jobs', 'permissionPresets', 'sandboxPolicy', 'sessionController',
  'sessionPersistence', 'workspaceRegistry', 'approval', 'webServer', 'attachments']

/** Test-only surface: authenticated loopback input and observation, never tools.execute(). */
export async function apply(ctx) {
  const token = process.env.SPIRIT_TEST_TOKEN
  if (!token || !process.env.SPIRIT_TEST_RUNTIME) throw new Error('The runtime fixture is only loadable by its isolated test driver')
  if (ctx.webServer.host !== '127.0.0.1') throw new Error('The runtime fixture requires an IPv4 loopback listener')
  const requireRuntime = createRequire(join(process.env.SPIRIT_TEST_RUNTIME, 'package.json'))
  const { LlmAdapter, LlmError, createUserMessage } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-llm')).href)
  const { setSandboxMode } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-sandbox-policy')).href)
  const { setApprovalPolicy } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-user-approval')).href)
  const trace = [], lifecycle = [], published = [], pending = new Map(), heldStreams = new Map()
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') {
      published.push({ sessionId: agent.id, attemptId: frame.attemptId, text: frame.chunk.text })
      if (published.length > 4000) published.shift()
    }
  })
  for (const event of ['subagent/start', 'subagent/end']) {
    ctx.on(event, info => { lifecycle.push({ event, ...info }) })
  }
  const overflowOnce = new Set()
  let autonomyBehavior = 'ack'
  let visionPlayUrl
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
  const visionFixture = process.env.SPIRIT_TEST_IMAGE_FIXTURE === '1'
  const models = ['fixture-one', 'fixture-two'].map(id => ({ provider: PROVIDER, id, name: `Deterministic protocol fixture: ${id}`,
    inputModalities: visionFixture ? ['text', 'image'] : ['text'], context: { contextWindow: 1_000_000 }, defaultMaxTokens: 4096,
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
      if (options.purpose === 'spirit-mediation') {
        const contents = options.messages.map(textOf).join('\n')
        const args = contents.includes('PROBE_REVIEW_CHANGE')
          ? { disposition: 'revise', text: '我重新看过了，这才是我准备交付的答复。', reason: '按本轮实际请求修订测试草稿。' }
          : contents.includes('PROBE_REVIEW_QUIET') ? { disposition: 'silent', reason: '本轮选择安静。' }
          : { disposition: 'publish', reason: '已核对这条测试答复与本轮输入。' }
        trace.push({ at: new Date().toISOString(), sessionId: options.sessionId, provider: options.provider, model: options.model,
          purpose: options.purpose, tools: (options.tools ?? []).map(tool => tool.name), decision: args.disposition })
        const block = { type: 'tool-call', id: randomUUID(), name: 'spirit_review_reply', arguments: JSON.stringify(args) }
        yield { type: 'block-start', index: 0, blockType: block.type }
        yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
        yield { type: 'block-end', index: 0, block }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      const latest = options.messages.findLast(message => message.role === 'user'
        && ['user', 'spirit', 'agent-message', 'subagent-settled'].includes(message.source?.kind))
      if (options.purpose !== 'compaction' && overflowOnce.delete(options.sessionId)) {
        throw new LlmError('Controlled provider reports its context window exhausted', 'CONTEXT_WINDOW_EXCEEDED')
      }
      const input = options.purpose !== 'compaction' && latest && fixtureInput(latest)
      const contextMessage = options.messages.findLast(message => message.source?.kind === 'runtime-context'
        && textOf(message).includes('精神当前活动'))
      const contextLine = contextMessage && textOf(contextMessage).split('\n').find(line => line.startsWith('{"mainId":'))
      const working = contextLine && JSON.parse(contextLine)
      const seen = new Set(options.messages.flatMap(message => message.content ?? []).filter(part => part.type === 'tool-call').map(part => part.id))
      let next
      if (input?.packet && autonomyBehavior === 'ack') {
        const id = callId(input.packet.dispatchId, 0)
        if (!seen.has(id)) next = { id, name: 'spirit_decide', args: { opportunityId: input.packet.opportunity.id,
          dispatchId: input.packet.dispatchId, decision: 'refrain', reason: '确定性运行时测试记录了显式回执；这不代表真实模型已经学习或判断了事情' } }
      } else if (input?.packet && autonomyBehavior === 'say') {
        const id = callId(input.packet.dispatchId, 0)
        if (!seen.has(id)) next = { id, name: 'spirit_say', args: { text: '开放机会中由模型选择发出的本地测试消息。' } }
      } else if (input?.packet && autonomyBehavior === 'vision-play' && visionPlayUrl) {
        const id = callId(input.packet.dispatchId, 0)
        if (!seen.has(id)) {
          next = { id, name: 'spirit_watch', args: { action: 'play', url: visionPlayUrl } }
          visionPlayUrl = undefined
        }
      } else if (input?.script) {
        const index = (input.script.calls ?? []).findIndex((call, index) => !seen.has(callId(input.script.id, index))
          && !(call.name === 'spirit_reply' && options.messages.some(message => message.role === 'assistant' && textOf(message) === call.args.text)))
        if (index >= 0) next = { ...input.script.calls[index], id: callId(input.script.id, index) }
      }
      const heldId = input?.script?.hold ? input.script.id
        : input?.packet && autonomyBehavior === 'hold' ? input.packet.dispatchId : undefined
      const nativeImages = []
      if (visionFixture) for (const part of options.messages.flatMap(message => message.content ?? [])) {
        if (part.type !== 'image') continue
        const stored = await ctx.attachments.readImage(part.attachment, options.signal)
        nativeImages.push({ mediaType: stored.ref.mediaType, bytes: stored.data.byteLength })
      }
      trace.push({ at: new Date().toISOString(), sessionId: options.sessionId, provider: options.provider, model: options.model,
        reasoningEffort: options.reasoningEffort, purpose: options.purpose, tools: (options.tools ?? []).map(tool => tool.name),
        ...(working ? { working } : {}), ...(input?.script ? { scriptId: input.script.id } : {}),
        ...(visionFixture ? { images: nativeImages } : {}),
        ...(next ? { call: next } : {}), ...(input?.packet ? { opportunityId: input.packet.opportunity.id, dispatchId: input.packet.dispatchId } : {}),
        ...(input?.script?.probe ? { sawProbe: options.messages.some(message => message !== latest && textOf(message).includes(input.script.probe)) } : {}),
        ...(heldId ? { hold: true } : {}) })
      if (trace.length > 2000) trace.shift()
      let blockIndex = 0
      if (input?.script?.privateProbe) {
        const text = input.script.privateProbe
        yield { type: 'block-start', index: blockIndex, blockType: 'reasoning' }
        yield { type: 'reasoning-delta', index: blockIndex, text }
        yield { type: 'block-end', index: blockIndex++, block: { type: 'reasoning', text } }
      }
      if (input?.script?.draft && (next || heldId)) {
        const text = input.script.draft
        yield { type: 'block-start', index: blockIndex, blockType: 'text' }
        yield { type: 'text-delta', index: blockIndex, text }
        yield { type: 'block-end', index: blockIndex++, block: { type: 'text', text } }
      }
      if (heldId && !next) {
        await new Promise((resolveHold, reject) => {
          const finish = () => {
            heldStreams.delete(heldId)
            options.signal?.removeEventListener('abort', abort)
          }
          const abort = () => {
            finish()
            reject(options.signal?.reason ?? new Error('Fixture held stream cancelled'))
          }
          heldStreams.set(heldId, () => { finish(); resolveHold() })
          options.signal?.addEventListener('abort', abort, { once: true })
          if (options.signal?.aborted) abort()
        })
      }
      if (input?.packet && (autonomyBehavior === 'omit'
        || (autonomyBehavior === 'say' || autonomyBehavior === 'vision-play') && !next)) {
        yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const block = next ? { type: 'tool-call', id: next.id, name: next.name, arguments: JSON.stringify(next.args) }
        : { type: 'text', text: input?.script?.reply ?? 'Controlled runtime fixture settled. No live-model reasoning was exercised.' }
      yield { type: 'block-start', index: blockIndex, blockType: block.type }
      yield next ? { type: 'tool-call-delta', index: blockIndex, id: block.id, name: block.name, argumentsDelta: block.arguments }
        : { type: 'text-delta', index: blockIndex, text: block.text }
      yield { type: 'block-end', index: blockIndex, block }
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
      yield { type: 'finish', reason: { kind: next ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter([PROVIDER], new FixtureAdapter())
  if (process.env.SPIRIT_TEST_NATIVE_APPROVAL_UI !== '1') ctx.on('approval/request', (request, _next) => new Promise(resolveAnswer => {
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
  const readEvents = async sessionId => {
    await ctx.sessionPersistence.flush()
    const handle = await ctx.sessionPersistence.open(sessionId, 'read'), events = []
    try {
      for (let offset = 0;;) {
        const page = await handle.read(offset, 512)
        if (!page.events.length) break
        events.push(...page.events); offset += page.events.length
      }
    } finally { await handle[Symbol.asyncDispose]() }
    return events
  }
  const inspect = async sessionId => {
    const agent = await agentFor(sessionId)
    const events = await readEvents(sessionId)
    return { sessionId, header: agent.session.header, preset: ctx.agentPresets.presetForSession(agent.session), status: agent.status, model: agent.model.current(), events,
      permissionPreset: ctx.permissionPresets.current(agent.session), sandbox: ctx.sandboxPolicy.overrideOf(agent.session),
      approval: ctx.approval.overrideOf(agent.session), teamEnabled: ctx.agentTeams.isEnabled(agent),
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
      if (req.method === 'GET' && route === '/trace') return json(res, 200, { trace, lifecycle, published, held: [...heldStreams.keys()], pending: [...pending.values()].map(value => value.item) })
      if (req.method === 'GET' && route === '/native-remote-events') {
        const gateway = ctx.get('typertGateway')
        return json(res, 200, { ownerConnected: gateway?.hasLiveClient() ?? false, pending: gateway?.getPendingRemoteEvents() ?? [] })
      }
      if (req.method === 'GET' && route === '/flush-barrier') return json(res, 200, flushBarrier
        ? { id: flushBarrier.id, entered: flushBarrier.entered, enteredAt: flushBarrier.enteredAt, released: false } : lastBarrier ?? { armed: false })
      if (req.method === 'GET' && route === '/inspect') return json(res, 200, await inspect(url.searchParams.get('sessionId')))
      if (req.method === 'GET' && route === '/logs') return json(res, 200, await readEvents(url.searchParams.get('sessionId')))
      if (req.method === 'GET' && route === '/jobs') {
        const owner = url.searchParams.get('sessionId')
        return json(res, 200, ctx.jobs.list(owner).filter(job => job.owner === owner))
      }
      if (req.method === 'GET' && route === '/member') {
        const agent = ctx.agents.get(url.searchParams.get('sessionId'))
        return json(res, 200, agent ? { resident: true, header: agent.session.header, status: agent.status,
          names: ctx.subagents.namesOf(agent), root: ctx.subagents.rootOf(agent).id, teamEnabled: ctx.agentTeams.isEnabled(agent),
          sandbox: ctx.sandboxPolicy.overrideOf(agent.session), approval: ctx.approval.overrideOf(agent.session), nextStep: agent.inbox.nextStep.length,
          nextTurn: agent.inbox.nextTurn.length } : { resident: false })
      }
      if (req.method === 'GET' && route === '/roster') {
        const agent = await agentFor(url.searchParams.get('sessionId'))
        const toolSet = await agent.ctx.tools.resolve({ agent, modelSelection: agent.model.current(), signal: AbortSignal.timeout(10_000) })
        try { return json(res, 200, { tools: [...toolSet.view(agent).keys()] }) } finally { toolSet.dispose() }
      }
      if (req.method === 'GET' && route === '/sessions') return json(res, 200, await ctx.sessionController.list({}, new AbortController().signal))
      if (req.method === 'GET' && route === '/presets') return json(res, 200, await ctx.agentPresets.remoteExportList())
      if (req.method === 'GET' && route === '/workspaces') return json(res, 200, ctx.workspaceRegistry.list()
        .map(value => ({ id: value.id, path: value.path, sessionIds: [...value.sessionIds] })))
      if (req.method === 'POST' && route === '/overflow-once') {
        const { sessionId } = await readBody(req); overflowOnce.add(sessionId); return json(res, 200, { armed: true })
      }
      if (req.method === 'POST' && route === '/project-workspace') {
        const directory = join(process.cwd(), 'owner-project-fixture')
        mkdirSync(directory, { recursive: true })
        const workspace = await ctx.workspaceRegistry.resolveByPath(directory) ?? await ctx.workspaceRegistry.create(directory, '本人项目')
        return json(res, 200, { id: workspace.id, path: workspace.path })
      }
      if (req.method === 'POST' && route === '/native-create') return json(res, 200, await ctx.sessionController.create(await readBody(req)))
      if (req.method === 'POST' && route === '/native-custom-permissions') {
        const { sessionId } = await readBody(req), agent = await agentFor(sessionId)
        setSandboxMode(agent.session, 'read-only')
        setApprovalPolicy(agent.session, 'never')
        return json(res, 200, await inspect(sessionId))
      }
      if (req.method === 'POST' && route === '/native-team') {
        const { sessionId, enabled } = await readBody(req), agent = await agentFor(sessionId)
        assert.equal(typeof enabled, 'boolean')
        await ctx.agentTeams.setEnabled(agent, enabled)
        return json(res, 200, { enabled: ctx.agentTeams.isEnabled(agent) })
      }
      if (req.method === 'POST' && route === '/release-stream') {
        const { scriptId } = await readBody(req), release = heldStreams.get(scriptId)
        return json(res, 200, { released: Boolean(release && (release(), true)) })
      }
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
        if (visionFixture && body.autonomy === 'vision-play' && typeof body.url === 'string') visionPlayUrl = body.url
        else if (!['ack', 'silent', 'hold', 'omit', 'say'].includes(body.autonomy)) throw new Error('Unknown fixture autonomy behavior')
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
  const runtime = resolve(args.runtime ?? '/workspace/scratch/harness-rc5')
  const scratch = resolve(args.scratch ?? `/tmp/spirit-runtime-validation-${Date.now()}`)
  const packageSource = resolve(args.package ?? PACKAGE)
  const suite = args.suite ?? 'default'
  assert(['default', 'open-activity', 'mediation', 'chat', 'voice', 'approval-ui'].includes(suite), `Unknown runtime suite ${suite}`)
  const reportPath = join(scratch, 'report.json'), addressFile = join(scratch, 'runtime-address.json')
  const runtimeVersion = JSON.parse(readFileSync(join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'))).version
  assert.equal(runtimeVersion, '0.2.2-rc.5', 'This controlled integration test targets an exact Harness generation')
  assert(existsSync(join(packageSource, 'lib/index.js')), 'Build Spirit before running runtime-smoke.mjs')
  const packageManifest = JSON.parse(readFileSync(join(packageSource, 'package.json')))
  const packageName = packageManifest.name
  const build = { packageName, packageVersion: packageManifest.version,
    indexSha256: createHash('sha256').update(readFileSync(join(packageSource, 'lib/index.js'))).digest('hex'),
    fixtureSha256: createHash('sha256').update(readFileSync(FILE)).digest('hex') }
  mkdirSync(scratch, { recursive: true })
  const home = join(scratch, 'home'), profile = join(home, 'profiles', 'spirit-runtime-test'), snapshot = join(scratch, 'package'), state = join(scratch, 'state')
  assert(!existsSync(join(state, 'personal.sqlite')), 'Use a fresh scratch directory; restart is tested within one run')
  mkdirSync(snapshot, { recursive: true }); mkdirSync(state, { recursive: true })
  for (const entry of ['package.json', 'cordis.patch.yml', 'lib', 'src', 'media', 'upstream', 'scripts', 'tests', 'docs', 'README.md', 'LICENSE', 'NOTICE', 'screenshots.json', 'marketplace/locale', 'marketplace/RELEASE-VALIDATION.md', 'tsconfig.json', 'tsdown.config.ts', 'vitest.config.ts']) {
    if (existsSync(join(packageSource, entry))) cpSync(join(packageSource, entry), join(snapshot, entry), { recursive: true })
  }
  mkdirSync(join(snapshot, 'node_modules'), { recursive: true })
  symlinkSync(join(runtime, 'node_modules/@deepseek-ai'), join(snapshot, 'node_modules/@deepseek-ai'), 'dir')
  for (const dependency of ['zod', 'proper-lockfile', '@mediapipe']) symlinkSync(join(packageSource, 'node_modules', dependency), join(snapshot, 'node_modules', dependency), 'dir')
  const binary = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  if (suite === 'approval-ui') {
    // Install through the normal Web loader so the browser serves this candidate's compiled client.
    const run = promisify(execFile), options = { cwd: scratch, env: { ...process.env, DSH_HOME: home, npm_config_offline: 'true', DSH_TELEMETRY_DISABLED: '1' },
      timeout: 45_000, maxBuffer: 2_000_000 }
    await run(process.execPath, [binary, '--profile', 'spirit-runtime-test', '--from-default-profile', 'web', '--dump-config'], options)
    await run(process.execPath, [binary, 'plugin', '--profile', 'spirit-runtime-test', 'add', `link:${snapshot}`], options)
  } else {
    mkdirSync(dirname(join(profile, 'node_modules', packageName)), { recursive: true })
    symlinkSync(snapshot, join(profile, 'node_modules', packageName), 'dir')
    symlinkSync(join(runtime, 'node_modules/@deepseek-ai'), join(profile, 'node_modules/@deepseek-ai'), 'dir')
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-spirit-runtime-test', private: true,
      dependencies: { [packageName]: `file:${snapshot}` }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', packageName] } } }, null, 2))
    writeFileSync(join(profile, 'cordis.yml'), '[]\n')
  }
  writeFileSync(join(profile, 'cordis.patch.yml'), [
    '- id: dsh-spirit', '  config:', `    stateDir: ${JSON.stringify(state)}`, '    concurrency: 2',
    `    openIntervalMinutes: ${['open-activity', 'chat'].includes(suite) ? 0.05 : 0}`,
    '- id: agent-default-model', '  config:', `    provider: ${PROVIDER}`, '    model: fixture-one', '    reasoningEffort: low',
    ...['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-title-llm'].flatMap(id => [`- id: ${id}`, '  disabled: true']),
    '- insert:', '    - id: spirit-runtime-fixture', `      name: ${JSON.stringify(FILE)}`, '',
  ].join('\n'))
  const token = randomBytes(32).toString('hex'), checks = [], nativeArtifacts = []
  let child, origin, browserUrl, bootNumber = 0, processError
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
  const logs = sessionId => request(`/logs?sessionId=${encodeURIComponent(sessionId)}`)
  const jobs = sessionId => request(`/jobs?sessionId=${encodeURIComponent(sessionId)}`)
  const member = sessionId => request(`/member?sessionId=${encodeURIComponent(sessionId)}`)
  const turn = (sessionId, script, wait = true) => request('/turn', { sessionId, script, wait })
  const scriptText = script => `${MARKER}${JSON.stringify(script)}`
  const toolResult = (events, script, index) =>
    events.findLast(event => event.type === 'tool/result' && event.data.message.toolCallId === callId(script.id, index))
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
  const complete = async (mainId, childId) => {
    const finalTrace = await request('/trace')
    writeFileSync(join(scratch, 'native-evidence.json'), JSON.stringify({ artifacts: nativeArtifacts, ...finalTrace,
      main: await inspect(mainId), ...(childId ? { child: await inspect(childId) } : {}),
      opportunities: sqlValues('spirit_autonomy_opportunity'), decisions: sqlValues('spirit_autonomy_decision') }, null, 2))
    writeFileSync(reportPath, JSON.stringify({ passed: true, kind: 'controlled-runtime-integration', suite,
      disclaimer: 'Deterministic local protocol fixtures; no live-model reasoning or learning evaluated.',
      runtimeVersion, build, checks, evidence: join(scratch, 'native-evidence.json') }, null, 2))
    process.stdout.write(`Controlled runtime integration passed. Evidence: ${reportPath}\n`)
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
    child = spawn(process.execPath, [binary, '--profile', 'spirit-runtime-test', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: scratch, env: { ...process.env, DSH_HOME: home, SPIRIT_TEST_RUNTIME: runtime, SPIRIT_TEST_TOKEN: token, SPIRIT_TEST_ADDRESS_FILE: addressFile,
        SPIRIT_TEST_NATIVE_APPROVAL_UI: suite === 'approval-ui' ? '1' : '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const append = chunk => { output += chunk; writeFileSync(log, output); browserUrl ??= /^dsh web: (https?:\/\/\S+)$/m.exec(output)?.[1] }
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
    if (suite === 'approval-ui') {
      await poll(() => browserUrl, 'official Web entry URL')
      await verifyNativeInteractionsRuntime({ browserUrl, mainId, state, scratch, request, inspect, scriptText, evidence, complete, poll })
      return
    }
    if (suite === 'voice') {
      await verifyVoiceRuntime({ origin, mainId, request, inspect, turn, scriptText, evidence, complete, poll })
      return
    }
    if (suite === 'chat') {
      await verifyChatRuntime({ mainId, request, run, inspect, turn, scriptText, evidence, complete, stop, boot, poll, sqlValues, delay })
      return
    }
    if (suite === 'mediation') {
      await verifyMediationRuntime({ mainId, state, request, run, inspect, turn, evidence, complete, poll, findSessionId, scriptText })
      return
    }
    if (suite === 'open-activity') {
      const intervalWindow = 4500
      const openOpportunities = () => sqlValues('spirit_autonomy_opportunity').filter(value => value.openGrant !== undefined)
      await delay(intervalWindow)
      assert.equal(openOpportunities().length, 0)
      assert.equal((await request('/trace')).trace.length, 0, 'Ask mode leaves the event-free native model idle')
      await request('/permissions', { mode: 'full' }, false)
      const opened = await poll(() => openOpportunities().find(value => value.state === 'settled'),
        'idle timer offers and the real native model acknowledges a no-event opportunity', 15_000)
      assert.equal(opened.eventCount, 0)
      assert.equal(opened.revisitCount, 0)
      const stateAfterOpen = await inspect(mainId)
      const input = stateAfterOpen.events.find(event => event.type === 'user/message' && event.data.source?.requestId === opened.dispatchId)
      assert.equal(input?.data.source.kind, 'spirit')
      assert.equal(input.data.source.fromSessionId, mainId)
      assert(stateAfterOpen.events.some(event => event.type === 'tool/call' && event.data.name === 'spirit_decide'))
      assert(sqlValues('spirit_autonomy_decision').some(value => value.opportunityId === opened.id && value.decision === 'refrain'))
      evidence('full access offers an event-free idle opportunity and preserves the native self-authored input', { opportunityId: opened.id })
      const orientation = (await request('/state', undefined, false)).orientation
      const quiet = await run(mainId, 'spirit_orient', { expectedRevision: orientation.revision, outlook: 'quiet fixture',
        reason: 'exercise the idle admission policy', attention: 'quiet' })
      assert.equal(quiet.result.attention, 'quiet')
      const quietCount = openOpportunities().length
      await delay(intervalWindow)
      assert.equal(openOpportunities().length, quietCount, 'Quiet suppresses spontaneous opportunities across another due interval')
      evidence('quiet orientation suppresses further event-free model requests')
      const reopened = await run(mainId, 'spirit_orient', { expectedRevision: quiet.result.revision, outlook: 'reopened fixture',
        reason: 'exercise the owner pause boundary', attention: 'open' })
      assert.equal(reopened.result.attention, 'open')
      await request('/control', { action: 'pause' }, false)
      const pausedCount = openOpportunities().length, traceAtPause = (await request('/trace')).trace.length
      await delay(intervalWindow)
      assert.equal(openOpportunities().length, pausedCount)
      assert.equal((await request('/trace')).trace.length, traceAtPause)
      evidence('owner pause keeps an open orientation idle across another due interval')

      await request('/behavior', { autonomy: 'hold' })
      await request('/control', { action: 'resume' }, false)
      const accepting = await poll(async () => (await request('/trace')).trace.find(row => row.dispatchId && row.hold),
        'a second event-free opportunity enters a real native model request', 15_000)
      assert.equal(accepting.sessionId, mainId)
      await request('/permissions', { mode: 'ask' }, false)
      await poll(async () => (await inspect(mainId)).status === 'idle', 'revoked opportunity exits the native request')
      assert.equal((await request('/release-stream', { scriptId: accepting.dispatchId })).released, false)
      const normal = await run(mainId, 'spirit_read', {})
      assert(normal.log.events.some(event => event.type === 'user/message' && event.data.id === normal.log.messageId
        && event.data.source.kind === 'user'))
      assert(normal.log.events.some(event => event.type === 'user/message' && event.data.source.kind === 'spirit'
        && event.data.source.requestId === accepting.dispatchId))
      assert(!sqlValues('spirit_autonomy_decision').some(value => value.opportunityId === accepting.opportunityId))
      const revokedOpportunity = openOpportunities().find(value => value.id === accepting.opportunityId)
      assert.equal(revokedOpportunity?.state, 'cancelled')
      evidence('withdrawing full access aborts an admitted idle model turn and still accepts later owner input', { opportunityId: accepting.opportunityId })

      await request('/behavior', { autonomy: 'omit' })
      await request('/permissions', { mode: 'full' }, false)
      const silent = await poll(async () => (await request('/trace')).trace.find(row =>
        row.dispatchId && row.dispatchId !== opened.dispatchId && row.dispatchId !== accepting.dispatchId),
      'the real native stream accepts an event-free opportunity and produces no text or tool calls', 15_000)
      const later = await poll(async () => (await request('/trace')).trace.find(row => row.dispatchId
        && ![opened.dispatchId, accepting.dispatchId, silent.dispatchId].includes(row.dispatchId)),
      'another event-free opportunity follows an empty native turn', 15_000)
      assert.notEqual(later.opportunityId, silent.opportunityId)
      const silentEvents = (await inspect(mainId)).events
      const silentInputIndex = silentEvents.findIndex(event => event.type === 'user/message' && event.data.source?.requestId === silent.dispatchId)
      const silentEndIndex = silentEvents.findIndex((event, index) => index > silentInputIndex && event.type === 'turn/end')
      assert(silentInputIndex >= 0 && silentEndIndex > silentInputIndex)
      assert.equal(silentEvents[silentEndIndex].data.reason.kind, 'completed')
      const emptyTurn = silentEvents.slice(silentInputIndex, silentEndIndex)
      assert(!emptyTurn.some(event => event.type === 'tool/call'
        || event.type === 'assistant/message' && textOf(event.data.message).trim()))
      assert(!sqlValues('spirit_autonomy_decision').some(value => value.opportunityId === silent.opportunityId))
      const returned = openOpportunities().find(value => value.id === silent.opportunityId)
      assert.equal(returned?.state, 'settled')
      assert.equal(returned.endedWithoutDecision?.endSeq, silentEvents[silentEndIndex].seq)
      evidence('an event-free opportunity can end silently without recording a judgment or blocking the next opportunity',
        { silentOpportunityId: silent.opportunityId, laterOpportunityId: later.opportunityId })
      await complete(mainId)
      return
    }
    const initialMain = await inspect(mainId)
    const presets = await request('/presets')
    const spiritPresets = presets.presets.filter(value =>
      value.id === 'dsh-personal-spirit' || value.id === 'dsh-spirit' || value.name?.includes('精神'))
    assert.deepEqual(spiritPresets.map(value => value.id), ['dsh-spirit'], 'The real Web selector lists one Spirit preset')
    assert.equal(spiritPresets[0].broken, undefined)
    evidence('the native preset selector offers a single Spirit entry')
    assert.equal(initialMain.header.cwd, join(state, 'workspace'))
    const initialWorkspaces = await request('/workspaces')
    assert(!initialWorkspaces.some(value => value.sessionIds.includes(mainId)), 'The native main retains its cwd without becoming a text entry in the work tree')
    nativeArtifacts.push({ name: 'initial-native-session-metadata', model: initialMain.model, header: initialMain.header,
      workspaces: initialWorkspaces, events: initialMain.events })
    const projectWorkspace = await request('/project-workspace', {})
    assert.equal(initialMain.preset, 'dsh-spirit')
    const ordinary = await request('/native-create', { sessionId: mainId, workspaceId: projectWorkspace.id })
    assert.notEqual(ordinary.sessionId, mainId, 'Restored workspace navigation cannot claim the main session')
    const ordinaryBlank = await request('/native-create', { sessionId: ordinary.sessionId, workspaceId: projectWorkspace.id })
    assert.equal(ordinaryBlank.sessionId, ordinary.sessionId)
    const mainRoster = (await request(`/roster?sessionId=${encodeURIComponent(mainId)}`)).tools
    assert(['spirit_read', 'spirit_intent', 'spirit_decide', 'spirit_sessions', 'bash', 'read'].every(name => mainRoster.includes(name)))
    const explicitlyStandard = await request('/native-create', { sessionId: ordinary.sessionId, workspaceId: projectWorkspace.id, agentPreset: 'standard' })
    assert.equal(explicitlyStandard.sessionId, ordinary.sessionId)
    assert.equal((await inspect(ordinary.sessionId)).preset, 'standard', 'Explicit owner preset selection survives ordinary workspace reuse')
    await request('/native-create', { sessionId: ordinary.sessionId, workspaceId: projectWorkspace.id })
    assert.equal((await inspect(ordinary.sessionId)).preset, 'standard')
    assert.equal((await inspect(mainId)).preset, 'dsh-spirit')
    const unmanaged = await request('/native-create', { sessionId: `unmanaged-fixture-${randomUUID()}`, agentPreset: 'standard',
      permissionPreset: 'workspace-write', workspaceId: projectWorkspace.id })
    assert.equal((await inspect(unmanaged.sessionId)).preset, 'standard', 'A different native preset stays outside Spirit')
    assert(!(await request(`/roster?sessionId=${encodeURIComponent(unmanaged.sessionId)}`)).tools.includes('spirit_intent'))
    nativeArtifacts.push({ name: 'native-workspace-and-private-main', ordinaryBlank, explicitlyStandard, unmanaged, mainRoster })
    const mounted = await run(mainId, 'spirit_read', {})
    evidence('full package mounts and native agent executes Spirit tools', { mainId, runtimeVersion })
    assert(mounted.log.events.some(event => event.type === 'tool/call' && event.data.name === 'spirit_read'))
    const roster = (await request('/trace')).trace.find(value => value.sessionId === mainId)?.tools ?? []
    assert(roster.includes('spirit_read') && roster.includes('spirit_sessions') && roster.includes('spirit_intent') && roster.includes('spirit_decide'))
    assert(roster.includes('bash') && roster.includes('read'), 'Native Spirit preset capabilities remain mounted after implicit blank reuse')
    assert(!roster.some(name => /^spirit_(control|permissions|permission|set_access|set_state)$/.test(name)), 'Owner permission and activity setters must not be model tools')
    evidence('model tool roster exposes continuity tools without owner control setters')
    evidence('normal Workspace navigation cannot take the private main, while standard and participating project blanks retain their own presets')
    await request('/permissions', { mode: 'full' }, false)
    const nativeConversation = await request('/native-create', { workspaceId: projectWorkspace.id })
    assert.equal(nativeConversation.agentPreset, 'dsh-spirit')
    const personalId = nativeConversation.sessionId
    const state1 = (await run(mainId, 'spirit_orient', { expectedRevision: 0, outlook: 'check-source-before-attribution', reason: 'fixture shared practice', attention: 'quiet' })).result
    assert.equal(state1.revision, 1)
    const shared = (await run(mainId, 'spirit_intent', { statement: 'shared fixture work', reason: 'cross-session carry', state: 'waiting',
      revisit: { at: new Date(Date.now() + 180_000).toISOString() } })).result.intent
    const firstTurn = randomUUID()
    await request('/turn', { sessionId: personalId, script: { id: firstTurn, calls: [] } })
    const firstRequest = (await request('/trace')).trace.find(row => row.scriptId === firstTurn)
    assert.equal(firstRequest?.working?.orientation?.outlook, state1.outlook, 'A brand new session sees the existing orientation on its first model request')
    assert(firstRequest.working.activeIntents.some(item => item.id === shared.id && item.revision === 1))
    assert(!firstRequest.call)
    const cancelled = (await run(personalId, 'spirit_intent', { id: shared.id, expectedRevision: 1, statement: shared.statement, reason: 'user conversation changed the ongoing work', state: 'cancelled' })).result.intent
    assert.equal(cancelled.sessionId, mainId); assert.equal(cancelled.state, 'cancelled')
    assert(cancelled.updatedBy.reference.startsWith(personalId))
    assert.equal(sqlValues('spirit_autonomy_revisit').find(entry => entry.intentId === shared.id).state, 'stale')
    const state2 = (await run(personalId, 'spirit_orient', { expectedRevision: 1, outlook: 'revised-in-personal-conversation', reason: 'the first practice omitted a condition' })).result
    assert.equal(state2.source.sessionId, personalId)
    assert.equal(state2.attention, 'quiet')
    const stale = await run(mainId, 'spirit_orient', { expectedRevision: 1, outlook: 'overwrite', reason: 'obsolete context' }, { allowError: true })
    assert.match(stale.result.error, /修订|版本/)
    const exchange = (await run(mainId, 'spirit_read', { action: 'exchanges' })).result.items.find(item => item.sessionId === personalId)
    assert(exchange?.ownerExcerpt && exchange.assistantExcerpt && exchange.throughSeq > exchange.startSeq)
    evidence('native owner-created conversation inherits active work on its first request and can revise it for the whole profile')
    const refusal = await run(personalId, 'spirit_decline', { reason: 'decided against this request' })
    assert.equal(refusal.result.decision.kind, 'ignore')
    assert.equal(refusal.result.decision.audit.decidedBy, 'self')
    assert.equal(refusal.result.decision.ticketId, undefined)
    evidence('declining a real owner request records model authorship and creates no task')

    // A provider-confirmed overflow exercises the normal rc.5 automatic recovery
    // path. The deliberately content-free summary cannot restore plugin state.
    await request('/overflow-once', { sessionId: mainId })
    const overflowing = randomUUID()
    await request('/turn', { sessionId: mainId, script: { id: overflowing, calls: [] } })
    const compacted = await inspect(mainId)
    assert(compacted.events.some(event => event.type === 'compaction/summary'), 'the host actually replaced history with a summary')
    const afterCompact = randomUUID()
    await request('/turn', { sessionId: mainId, script: { id: afterCompact, calls: [] } })
    const continued = (await request('/trace')).trace.find(row => row.scriptId === afterCompact)
    assert.equal(continued?.working?.orientation?.revision, state2.revision)
    assert(!continued.working.activeIntents.some(item => item.id === shared.id))
    evidence('real rc.5 context overflow and native compaction retain the current orientation and do not revive cancelled work')

    const subagentRuns = async () => (await request('/trace')).lifecycle
    const completedRun = async start => poll(async () => (await subagentRuns()).find(value => value.event === 'subagent/end'
      && value.runId === start.runId), `settlement of ${start.id}`)
    const delegate = async (rootId, provider, name, script) => {
      const prior = new Set((await subagentRuns()).map(value => value.runId))
      const launched = await run(rootId, provider === 'fork' ? 'subagent_fork' : 'subagent', {
        name, description: 'Native runtime delegation fixture', prompt: scriptText(script),
      })
      assert.match(String(launched.result), new RegExp(`started subagent ${name}`))
      const started = await poll(async () => (await subagentRuns()).find(value => value.event === 'subagent/start'
        && value.parentSessionId === rootId && value.provider === provider && !prior.has(value.runId)), `native ${provider} starts ${name}`)
      assert.equal(started.local, true)
      return started
    }
    const settledNotice = async (start, reply) => poll(async () => (await logs(start.parentSessionId)).find(event =>
      event.type === 'user/message' && event.data.source?.kind === 'subagent-settled' && event.data.source.senderSessionId === start.id
      && (!reply || textOf(event.data).includes(reply))), `native completion notice for ${start.id}`)
    const seenScript = script => poll(async () => (await request('/trace')).trace.find(entry => entry.scriptId === script.id),
      `native request for fixture ${script.id}`)
    const teamMode = enabled => request('/native-team', { sessionId: mainId, enabled })
    assert.equal((await teamMode(false)).enabled, false)
    const contextProbe = `completed root context ${randomUUID()}`
    await turn(mainId, { id: randomUUID(), reply: contextProbe })
    const spawnedScript = { id: randomUUID(), probe: contextProbe, reply: `isolated result ${randomUUID()}` }
    const spawned = await delegate(mainId, 'spawn', 'isolated', spawnedScript)
    assert.equal((await completedRun(spawned)).stopReason, 'completed')
    const spawnedRequest = await seenScript(spawnedScript)
    assert.equal(spawnedRequest.sessionId, spawned.id)
    assert.equal(spawnedRequest.sawProbe, false, 'A fresh native spawn starts with its assigned task')
    assert(!spawnedRequest.tools.some(name => name.startsWith('team_task_')))
    assert(!spawnedRequest.tools.some(name => name.startsWith('spirit_')), 'A delegated worker does not become a personal conversation')
    const offNotice = await settledNotice(spawned, spawnedScript.reply)
    assert.equal(offNotice.data.source.stopReason, 'completed')
    evidence('Team disabled leaves ordinary native spawn operational with isolated context and a child-attributed result', { childId: spawned.id })

    assert.equal((await teamMode(true)).enabled, true)
    const task = (await run(mainId, 'team_task_create', { subject: 'Verify shared task',
      description: 'Claim this fixture task and report back to the Team Lead' })).result
    assert.equal(task.revision, 1)
    assert.equal(task.status, 'pending')
    const sharedFile = join(initialMain.header.cwd, 'team-shared-fixture.txt')
    const sharedFileText = `Shared workspace fixture ${randomUUID()}`
    writeFileSync(sharedFile, `${sharedFileText}\n`)
    const forkScript = { id: randomUUID(), probe: contextProbe, reply: `fork result ${randomUUID()}`, calls: [
      { name: 'team_task_list', args: {} },
      { name: 'team_task_update', args: { task_id: task.id, expected_revision: 1, action: 'claim' } },
      { name: 'team_task_update', args: { task_id: task.id, expected_revision: 2, action: 'complete' } },
      { name: 'read', args: { file_path: sharedFile } },
    ] }
    const forked = await delegate(mainId, 'fork', 'board-member', forkScript)
    assert.equal((await completedRun(forked)).stopReason, 'completed')
    const forkRequest = await seenScript(forkScript)
    assert.equal(forkRequest.sessionId, forked.id)
    assert.equal(forkRequest.sawProbe, true, 'A native fork reads completed parent context')
    assert(forkRequest.tools.includes('team_task_list'))
    assert(!forkRequest.tools.some(name => name.startsWith('spirit_')))
    const forkLog = await logs(forked.id)
    const listed = decodedResult(toolResult(forkLog, forkScript, 0)).tasks.find(value => value.id === task.id)
    assert.equal(listed?.status, 'pending')
    const claimed = decodedResult(toolResult(forkLog, forkScript, 1))
    assert.equal(claimed.owner, 'board-member')
    assert.equal(claimed.revision, 2)
    assert.equal(decodedResult(toolResult(forkLog, forkScript, 2)).status, 'completed')
    assert(textOf(toolResult(forkLog, forkScript, 3)?.data.message).includes(sharedFileText),
      'The delegated worker can read the shared native workspace via the regular host tool')
    const forkNotice = await settledNotice(forked, forkScript.reply)
    const rootTask = (await run(mainId, 'team_task_get', { task_id: task.id })).result
    assert.equal(rootTask.owner, 'board-member')
    assert.equal(rootTask.revision, 3)
    assert.equal(rootTask.status, 'completed')
    assert.deepEqual((await logs(mainId)).filter(event => event.type === 'team/task' && event.data.task.id === task.id)
      .map(event => event.data.task.revision), [1, 2, 3])
    nativeArtifacts.push({ name: 'native-team-board-and-fork', offNotice, forkNotice, forkLog, rootTask })
    evidence('native fork sees completed root context, mutates the shared Team task board as a named member and returns a child-attributed result',
      { childId: forked.id, taskId: task.id })

    const relayText = `team member result ${randomUUID()}`
    const relayScript = { id: randomUUID(), calls: [{ name: 'send_message', args: { agent: 'lead', message: relayText } }] }
    const teammate = await delegate(mainId, 'spawn', 'messenger', relayScript)
    assert.equal((await completedRun(teammate)).stopReason, 'completed')
    const memberRelay = await poll(async () => (await logs(mainId)).find(event => event.type === 'user/message'
      && event.data.source?.kind === 'agent-message' && event.data.source.senderSessionId === teammate.id && textOf(event.data).includes(relayText)),
    'native Team member message reaches the Lead with member provenance')
    const rosterResult = (await run(mainId, 'list_agents', {})).result
    assert.match(String(rosterResult), /lead \[/)
    assert.match(String(rosterResult), /messenger \[/)
    const ownerHistory = (await run(mainId, 'spirit_read', { action: 'exchanges' })).result.items
    assert(ownerHistory.every(entry => !entry.ownerExcerpt.startsWith('Background subagent ')
      && !entry.ownerExcerpt.startsWith('Agent messenger sent a message:')))
    nativeArtifacts.push({ name: 'native-member-relay', memberRelay, roster: rosterResult })
    evidence('Team member messages and the live roster preserve native member names and authorship', { childId: teammate.id })

    const otherChildScript = { id: randomUUID(), hold: true, reply: `unrelated delegate completed ${randomUUID()}` }
    const otherChild = await delegate(unmanaged.sessionId, 'spawn', 'unrelated-child', otherChildScript)
    await seenScript(otherChildScript)
    const otherChildBefore = await member(otherChild.id)
    assert.equal(otherChildBefore.root, unmanaged.sessionId)
    assert.equal(otherChildBefore.sandbox, 'workspace-write')
    const otherScript = { id: randomUUID(), hold: true, reply: `unrelated completed ${randomUUID()}` }
    await turn(unmanaged.sessionId, otherScript, false)
    await seenScript(otherScript)
    assert.equal((await inspect(unmanaged.sessionId)).permissionPreset, 'workspace-write')
    const assertAbortedDelegation = async (name, action, background = false) => {
      const heldScript = { id: randomUUID(), hold: true, reply: `cancelled child must not finish ${randomUUID()}`,
        calls: background ? [{ name: 'bash', args: { description: 'Start finite delegated fixture process',
          command: `${shellQuote(process.execPath)} -e 'setTimeout(() => {}, 15000)'`, run_in_background: true } }] : [] }
      const active = await delegate(mainId, 'spawn', name, heldScript)
      await poll(async () => (await request('/trace')).trace.some(entry => entry.scriptId === heldScript.id && !entry.call),
        `fixture child ${name} enters its abortable stream`)
      const runningJob = background && await poll(async () => (await jobs(active.id)).find(job => job.status === 'running'),
        'delegated native process registers a running job')
      const live = await member(active.id)
      assert.equal(live.root, mainId)
      assert.equal(live.names.self, name)
      assert.equal(live.names.parent, 'lead')
      assert.equal(live.header.origin, 'subagent')
      assert.equal(live.header.parentSession, mainId)
      assert.equal(live.teamEnabled, true)
      assert.equal(live.status, 'running')
      assert.equal(live.sandbox, 'danger-full-access')
      assert.equal(live.approval, 'never')
      const queued = { id: randomUUID(), calls: [{ name: 'team_task_create', args: {
        subject: 'Stale native input', description: 'This queued follow-up must never execute after a control change',
      } }] }
      await run(mainId, 'send_message', { agent: name, message: scriptText(queued) })
      const inbox = await member(active.id)
      assert(inbox.nextStep + inbox.nextTurn > 0, 'The native member had an accepted queued follow-up')
      await action()
      assert.equal((await completedRun(active)).stopReason, 'aborted')
      assert.equal((await request('/release-stream', { scriptId: heldScript.id })).released, false)
      assert.equal((await member(active.id)).resident, false)
      const stoppedJob = runningJob && await poll(async () => (await logs(active.id)).find(event =>
        event.type === 'job/settled' && event.data.jobId === runningJob.id && event.data.status === 'killed'),
      'owner revocation kills the delegated background job', 6000)
      if (stoppedJob) {
        // rc.5 replaces the cause of a still-stopping job if its owner tears down first.
        assert(['kill', 'teardown'].includes(stoppedJob.data.cause))
        assert.equal(stoppedJob.data.producerReported, true)
        assert.match(stoppedJob.data.detail, /精神委派的权限或活动状态已改变/)
      }
      const other = await inspect(unmanaged.sessionId)
      assert.equal(other.status, 'running')
      assert.equal(other.permissionPreset, 'workspace-write')
      const unrelatedDelegate = await member(otherChild.id)
      assert.equal(unrelatedDelegate.status, 'running')
      assert.equal(unrelatedDelegate.sandbox, otherChildBefore.sandbox)
      assert.equal(unrelatedDelegate.approval, otherChildBefore.approval)
      return { active, heldScript, queued, live, inbox, ...(stoppedJob ? { stoppedJob } : {}) }
    }
    const revoked = await assertAbortedDelegation('revoked', () => request('/permissions', { mode: 'ask' }, false), true)
    assert.equal((await inspect(mainId)).permissionPreset, 'workspace-write')
    await request('/permissions', { mode: 'full' }, false)
    const stopped = await assertAbortedDelegation('stopped', async () => {
      await request('/control', { action: 'stop' }, false)
      await request('/control', { action: 'resume' }, false)
    })
    await run(mainId, 'team_task_list', {})
    assert.equal((await request('/release-stream', { scriptId: otherScript.id })).released, true)
    assert.equal((await request('/release-stream', { scriptId: otherChildScript.id })).released, true)
    assert.equal((await completedRun(otherChild)).stopReason, 'completed')
    const unrelatedNotice = await settledNotice(otherChild, otherChildScript.reply)
    await poll(async () => (await inspect(unmanaged.sessionId)).status === 'idle', 'unrelated native root completes independently')
    const afterControls = await request('/trace'), controlledRoot = await logs(mainId)
    for (const cancelledRun of [revoked, stopped]) {
      const { active, heldScript, queued } = cancelledRun
      assert.equal(afterControls.lifecycle.filter(value => value.event === 'subagent/start' && value.id === active.id).length, 1)
      assert(!afterControls.trace.some(value => value.scriptId === queued.id))
      assert(!controlledRoot.some(event => event.type === 'user/message' && event.data.source?.senderSessionId === active.id))
      assert(!controlledRoot.some(event => event.type === 'assistant/message' && textOf(event.data.message).includes(heldScript.reply)))
      assert(!(await logs(active.id)).some(event => event.type === 'tool/call' && event.data.callId === callId(queued.id, 0)))
    }
    assert(!controlledRoot.some(event => event.type === 'team/task' && event.data.task.subject === 'Stale native input'))
    const unrelated = await inspect(unmanaged.sessionId)
    assert.equal(unrelated.permissionPreset, 'workspace-write')
    assert(unrelated.events.some(event => event.type.startsWith('assistant/') && JSON.stringify(event.data).includes(otherScript.reply)))
    nativeArtifacts.push({ name: 'native-delegation-control-boundaries', revoked, stopped, unrelated, unrelatedNotice })
    evidence('native delegation revocation and stop abort work and background jobs without replaying queued work or affecting another preset')

    await request('/permissions', { mode: 'ask' }, false)
    const explicit = { id: randomUUID(), hold: true, reply: `new explicitly delegated work ${randomUUID()}` }
    await run(mainId, 'send_message', { agent: 'revoked', message: scriptText(explicit) })
    assert.equal((await seenScript(explicit)).sessionId, revoked.active.id)
    const resumed = await member(revoked.active.id)
    assert.equal(resumed.sandbox, 'workspace-write')
    assert.equal(resumed.approval, 'never')
    assert.equal((await request('/release-stream', { scriptId: explicit.id })).released, true)
    await settledNotice(revoked.active, explicit.reply)
    assert(!(await request('/trace')).trace.some(value => value.scriptId === revoked.queued.id))
    nativeArtifacts.push({ name: 'native-delegation-explicit-resume-under-ask', resumed })
    evidence('a new native follow-up can continue the member under workspace access without restoring the revoked input')
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
    assert.equal((await inspect(mainId)).teamEnabled, true)
    const restoredTask = (await run(mainId, 'team_task_get', { task_id: task.id })).result
    assert.equal(restoredTask.owner, 'board-member')
    assert.equal(restoredTask.revision, 3)
    assert.equal(restoredTask.status, 'completed')
    evidence('restart preserves the selected Team mode and shared task history in the native Lead Session')
    const restoredWorkspaces = await request('/workspaces')
    assert(!restoredWorkspaces.some(value => value.sessionIds.includes(mainId)), 'Restart keeps the private main outside ordinary workspace navigation')
    assert(restoredWorkspaces.some(value => value.id === projectWorkspace.id && value.sessionIds.includes(ordinary.sessionId)))
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
    await complete(mainId, childId)
  } catch (error) {
    writeFileSync(join(scratch, 'native-failure-evidence.json'), JSON.stringify({ artifacts: nativeArtifacts,
      ...(origin ? { runtime: await request('/trace').catch(value => ({ error: String(value) })) } : {}) }, null, 2))
    writeFileSync(reportPath, JSON.stringify({ passed: false, kind: 'controlled-runtime-integration', suite, runtimeVersion, build, checks, error: String(error), stack: error?.stack }, null, 2))
    throw error
  } finally { await stop() }
}

if (process.argv[1] && resolve(process.argv[1]) === FILE) {
  main().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1 })
}
