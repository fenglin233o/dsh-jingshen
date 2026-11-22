import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import lockfile from 'proper-lockfile'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionToken, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { z } from 'zod'
import { key, latestAssignment, liveTicket } from '../upstream/src/core/index.ts'
import { PersonalService, OpenInput, workerId, type WorkRequest } from './service.ts'
import { EvidenceInput, ExaminationInput, FrameInput, MemoryInput, ReflectionInput, RevisionInput } from './experience.ts'
import { Autonomy, DecisionInput, IntentInput, RevisitInput } from './autonomy.ts'
import { SpiritControl, sensitiveSpiritCall, type AccessMode } from './control.ts'
import { HarnessBridge, preserveManagedBlankPreset, spiritMessageId } from './harness-bridge.ts'
import { SelfChangeBook, SelfChangeBeginInput, SelfChangeCheckInput } from './self-change.ts'
import { ActivationService } from './activation.ts'
import { Continuity, OrientationInput, publicSessionPage, type TurnReference } from './continuity.ts'
import { SpiritDelegation } from './delegation.ts'
import { OpportunityTurn } from './opportunity-turn.ts'
import { METHOD, MAIN, WORKER, CONVERSATION } from './prompts.ts'
import { registerHttp } from './http.ts'

export const name = 'dsh-jingshen'
export const inject = ['agents', 'agentPresets', 'sessionController', 'sessionPersistence', 'workspaceRegistry', 'permissionPresets', 'tools', 'systemPrompt', 'webServer', 'llm']
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeMetadata = { version: String(JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version),
  runtimeHash: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex') }
export interface SpiritConfig { stateDir: string; openIntervalMinutes: number; concurrency: number; maxRevisions: number; sourceRoot: string; harnessSourceRoot: string }
export const Config: s<Partial<SpiritConfig>, SpiritConfig> = s.object({
  stateDir: s.string().default(process.env.SPIRIT_STATE_DIR || join(homedir(), '.local', 'share', 'dsh-personal-spirit')).description('精神的持续记录目录；保留旧版本位置。'),
  openIntervalMinutes: s.number().min(0).max(1440).default(15).description('完全访问下、主会话空闲时提供开放判断机会的最短间隔（分钟）。0 关闭。'),
  concurrency: s.number().min(1).max(32).step(1).default(2).description('同时推进的独立事情数量。'),
  maxRevisions: s.number().min(0).step(1).default(0).description('可选的结构化修订资源上限；0 表示不设固定上限。'),
  sourceRoot: s.string().default(packageRoot).description('精神可检查和修改的安装源码目录。'),
  harnessSourceRoot: s.string().default('').description('可选的 Harness 源码目录；为空时不登记宿主源码修改目标。'),
})

const Id = z.string().trim().min(1).max(300)
const Text = z.string().trim().min(1).max(16000)
const ModelInput = z.object({ provider: Id, model: Id, reasoningEffort: Id.optional() }).strict()
export const SessionsInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().nonnegative().optional() }).strict(),
  z.object({ action: z.literal('read'), sessionId: Id, beforeSeq: z.number().int().nonnegative().optional(), throughSeq: z.number().int().min(-1).optional(), maxMessages: z.number().int().min(1).max(500).optional() }).strict(),
  z.object({ action: z.literal('search'), query: Text }).strict(),
  z.object({ action: z.literal('models') }).strict(),
  z.object({ action: z.literal('create'), title: z.string().trim().min(1).max(160), cwd: z.string().min(1).optional(), selection: ModelInput.optional(), reason: Text }).strict(),
  z.object({ action: z.literal('post'), sessionId: Id, text: Text, requestId: Id.optional(), mode: z.enum(['queue', 'steer', 'context']).default('queue'), reason: Text }).strict(),
  z.object({ action: z.literal('model'), sessionId: Id, selection: ModelInput, reason: Text }).strict(),
  z.object({ action: z.literal('stop'), sessionId: Id, reason: Text }).strict(),
  z.object({ action: z.literal('watch'), sessionId: Id, reason: Text }).strict(),
  z.object({ action: z.literal('unwatch'), sessionId: Id }).strict(),
])
export const ChangeInput = z.discriminatedUnion('action', [
  SelfChangeBeginInput.extend({ action: z.literal('begin') }),
  z.object({ action: z.literal('list'), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(20) }).strict(),
  z.object({ action: z.literal('read'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('compare'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('verify'), id: z.uuid(), checks: z.array(SelfChangeCheckInput).min(1).max(64), timeoutMs: z.number().int().min(1).max(600000).default(300000) }).strict(),
  z.object({ action: z.literal('apply'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('rollback'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('activate'), id: z.uuid(), reason: Text }).strict(),
])
const WorkSourceShape = { origin: z.enum(['auto', 'self']).default('auto'), request: Text.optional(), reason: Text.optional(),
  intentId: Id.optional(), intentRevision: z.number().int().positive().optional() }
const StartInput = OpenInput.extend(WorkSourceShape)
const ContinueInput = z.object({ ticketId: Id, ...WorkSourceShape }).strict()
const { sessionId: _intentSession, source: _intentSource, ...intentShape } = IntentInput.shape
const IntentToolInput = z.object(intentShape).strict()
const jsonValue = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null))
const brief = (value: string, limit = 8000) => value.length <= limit ? value : `${value.slice(0, limit - 40)}…［已截短，原记录可另行读取］`
const presetFor = (mode: AccessMode) => mode === 'full' ? 'danger-full-access' : 'workspace-write'
const spiritPreset = 'dsh-spirit'
const legacySpiritPreset = 'dsh-personal-spirit'

/** The rc.5 registry has no hidden alias. Resolve old saved identities to the
 * live composition before opening their logs, then record the new selection. */
function preserveLegacySpiritPreset(ctx: Context): () => void {
  const registry = ctx.agentPresets
  const previousResolve = Object.getOwnPropertyDescriptor(registry, 'resolve')
  const previousMount = Object.getOwnPropertyDescriptor(registry, 'mount')
  const nativeResolve = registry.resolve, nativeMount = registry.mount
  const alias = (id?: string) => (id ?? registry.defaultId) === legacySpiritPreset ? spiritPreset : id
  const resolve: typeof nativeResolve = id => nativeResolve.call(registry, alias(id))
  const mount: typeof nativeMount = (agentCtx, id) => nativeMount.call(registry, agentCtx, alias(id))
  Object.defineProperty(registry, 'resolve', { configurable: true, writable: true, value: resolve })
  Object.defineProperty(registry, 'mount', { configurable: true, writable: true, value: mount })
  return () => {
    if (Object.getOwnPropertyDescriptor(registry, 'mount')?.value === mount) {
      if (previousMount) Object.defineProperty(registry, 'mount', previousMount)
      else Reflect.deleteProperty(registry, 'mount')
    }
    if (Object.getOwnPropertyDescriptor(registry, 'resolve')?.value === resolve) {
      if (previousResolve) Object.defineProperty(registry, 'resolve', previousResolve)
      else Reflect.deleteProperty(registry, 'resolve')
    }
  }
}
type PermissionStatus = { status: 'applied' | 'pending' | 'error'; detail: string }
type CallScope = { agent?: Agent; revision: number; signal: AbortSignal; checkInput?: () => void }

export async function apply(ctx: Context, config: ReturnType<typeof Config>): Promise<void> {
  for (const [label, path] of [['stateDir', config.stateDir], ['sourceRoot', config.sourceRoot], ['harnessSourceRoot', config.harnessSourceRoot]] as const) {
    if (path && !isAbsolute(path)) throw new Error(`${label} 必须是绝对路径`)
  }
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 })
  const release = lockfile.lockSync(config.stateDir, { realpath: true })
  const mainId = `personal-spirit-${key(config.stateDir)}`
  const lifetime = new AbortController(), scopes = new AsyncLocalStorage<CallScope>()
  const initialized = Promise.withResolvers<void>()
  const bindings = new Map<Agent, (() => void)[]>(), disposers: (() => void)[] = []
  const turnInputs = new WeakMap<Agent, OpportunityTurn>()
  const provisioning = new Map<string, number>()
  const grants = new Map<ToolExecutionToken, number>()
  let app: PersonalService | undefined, owner: SpiritControl | undefined, autonomy: Autonomy | undefined
  let continuity: Continuity
  let changes: SelfChangeBook | undefined, activation: ActivationService | undefined
  let delegation: SpiritDelegation | undefined
  let ready = false, closed = false, syncingPermissions = 0, released = false
  let permission: PermissionStatus = { status: 'pending', detail: '正在核对本人选择与宿主权限。' }
  let permissionChain = Promise.resolve<unknown>(undefined)
  const admin = new HarnessBridge(ctx, { signal: lifetime.signal })
  const current = () => { if (!owner) throw new Error('精神尚未就绪'); return owner.current() }
  const belongs = (agent: Agent, preset = ctx.agentPresets.presetForSession(agent.session)) =>
    agent.session.header.origin !== 'subagent' && (preset ?? ctx.agentPresets.composedPreset(agent.ctx)) === spiritPreset
  const ticketFor = (sessionId: string) => app?.workerTicket(sessionId)
  const actualPermission = (): void => {
    if (!owner || syncingPermissions || permission.status !== 'applied') return
    const expected = presetFor(owner.current().mode)
    for (const agent of ctx.agents.list()) {
      if (!provisioning.has(agent.id) && owner.managed(agent.id) && belongs(agent)
        && ctx.permissionPresets.current(agent.session) !== expected) {
        permission = { status: 'error', detail: `会话 ${agent.id} 的宿主权限与本人选择不一致；请在面板重新应用权限。` }
        delegation?.revoke()
        break
      }
    }
  }
  const assertActive = (agent?: Agent, revision?: number, signal?: AbortSignal): void => {
    lifetime.signal.throwIfAborted(); signal?.throwIfAborted()
    if (!ready || closed) throw new Error('精神正在初始化或关闭')
    owner!.assertActive(revision); actualPermission()
    if (permission.status !== 'applied') throw new Error(permission.detail)
    if (agent && ctx.agents.get(agent.id) !== agent) throw new Error('会话已经关闭或被替换')
    if (agent && owner!.managed(agent.id)) {
      if (!belongs(agent)) throw new Error('当前会话使用其他预设')
      if (ctx.permissionPresets.current(agent.session) !== presetFor(current().mode)) throw new Error('当前会话的宿主权限与本人选择不一致')
    }
  }
  const bridge = new HarnessBridge(ctx, { signal: lifetime.signal, authorize: () => {
    const scope = scopes.getStore(); assertActive(scope?.agent, scope?.revision, scope?.signal)
    scope?.checkInput?.()
  } })
  const turnStart = (agent: Agent) => ctx.agents.turnBoundaryOf(agent.session).openTurnStartSeq
  const turnSource = (agent: Agent, exec: ToolRunContext): TurnReference => {
    const { openTurnStartSeq: startSeq, lastTurn } = ctx.agents.turnBoundaryOf(agent.session)
    if (startSeq === null) throw new Error('当前操作需要宿主的实际回合')
    const reference = { sessionId: agent.id, startSeq, throughSeq: agent.session.seq - 1, callId: exec.callId }
    continuity.rememberTurn(reference, lastTurn)
    return reference
  }
  const realSource = (agent: Agent, exec: ToolRunContext, args: unknown) => {
    const turn = turnSource(agent, exec)
    return { sessionId: agent.id, id: `tool:${turn.startSeq}:${exec.callId}`, text: brief(JSON.stringify(args), 8000), turn }
  }
  const checkCall = (agent: Agent, exec: Pick<ToolRunContext, 'token' | 'signal'>): void => {
    assertActive(agent, grants.get(exec.token), exec.signal)
    turnInputs.get(agent)?.assertCurrent()
  }
  const ownerRequestFor = async (agent: Agent, exec: ToolRunContext) => {
    const startSeq = turnStart(agent)
    if (startSeq === null) return undefined
    const request = await bridge.latestOwnerRequest(agent.id, exec.signal)
    checkCall(agent, exec)
    if (turnStart(agent) !== startSeq) throw new Error('本人请求所在回合已经改变')
    return request && { ...request, turn: turnSource(agent, exec) }
  }

  const resolve = async (id: string): Promise<Agent> => {
    const result = await ctx.sessionController.resolveAgent(id as SessionId)
    if ('error' in result) throw new Error(`无法打开会话 ${id}：${result.error.code}`)
    return result.agent
  }
  const setNativePermission = (agent: Agent): void => {
    syncingPermissions++
    try { ctx.permissionPresets.set(agent.session, presetFor(current().mode)) }
    finally { syncingPermissions-- }
  }
  const ensureSession = async (id: string, directory: string, title: string, reason: string, kind: 'main' | 'task' | 'initiative', modelFrom?: string, scope?: CallScope): Promise<Agent> => {
    const check = () => { if (scope) assertActive(scope.agent, scope.revision, scope.signal) }
    const native = scope ? bridge : admin
    check()
    // rc.5 writes its default permission while creating a Session, then applies the
    // requested preset. That transition belongs only to the Session being prepared.
    provisioning.set(id, (provisioning.get(id) ?? 0) + 1)
    try {
      owner!.manage(id, title, reason, kind)
      let result = await ctx.sessionController.resolveAgent(id as SessionId)
      check()
      if ('error' in result && result.error.code === 'session/not-found') {
        mkdirSync(directory, { recursive: true, mode: 0o700 })
        const created = await native.create({ sessionId: id, cwd: directory, title, agentPreset: 'dsh-spirit', permissionPreset: presetFor(current().mode), signal: scope?.signal })
        check()
        if (created.sessionId !== id) throw new Error('宿主创建了不同的会话标识；请检查原会话，不自动替换历史')
        result = await ctx.sessionController.resolveAgent(id as SessionId)
        check()
        if ('error' in result) throw new Error(result.error.code)
        if (modelFrom) {
          const source = await resolve(modelFrom), selected = source.model.current()
          check()
          if (selected) await native.selectModel(id, selected, scope?.signal)
        }
      }
      if ('error' in result) throw new Error(result.error.code)
      check()
      await native.ensureWorkspace(id, { title, signal: scope?.signal })
      check()
      if (belongs(result.agent)) { setNativePermission(result.agent); bind(result.agent) }
      return result.agent
    } finally {
      const remaining = provisioning.get(id)! - 1
      if (remaining) provisioning.set(id, remaining)
      else provisioning.delete(id)
      actualPermission()
    }
  }
  const workRequest = async (agent: Agent, exec: ToolRunContext, input: z.infer<z.ZodObject<typeof WorkSourceShape>>): Promise<WorkRequest> => {
    const { intentId, intentRevision } = input
    if ((intentId === undefined) !== (intentRevision === undefined) || intentId && input.origin !== 'self') {
      throw new Error('依据意向版本委派时需要 origin=self，并同时提供 intentId 和 intentRevision')
    }
    const ownerRequest = input.origin === 'auto' ? await ownerRequestFor(agent, exec) : undefined
    checkCall(agent, exec)
    if (ownerRequest) return ownerRequest
    if (input.origin !== 'self' || !input.request?.trim() || !input.reason?.trim()) {
      throw new Error('当前回合没有本人的真实请求。自主发起须明确 origin=self、request 与 reason，并使用现有持续授权。')
    }
    const turn = turnSource(agent, exec)
    return { kind: 'self', sessionId: agent.id, id: `tool:${turn.startSeq}:${exec.callId}`, text: input.request, reason: input.reason, grantRevision: current().revision,
      turn, ...(intentId && intentRevision !== undefined ? { intent: { id: intentId, revision: intentRevision } } : {}) }
  }

  function bind(agent: Agent): void {
    if (closed || !app || !owner || !autonomy || !changes || !owner.managed(agent.id) || !belongs(agent) || bindings.has(agent)) return
    const service = app, control = owner, thinking = autonomy, book = changes
    const task = ticketFor(agent.id), registered: (() => void)[] = []
    const inputs = new OpportunityTurn(agent.id, mainId, (id, admission) => thinking.assertDispatchCurrent(agent.id, id, admission))
    turnInputs.set(agent, inputs)
    bindings.set(agent, registered)
    registered.push(agent.ctx.on('agent/pre-step', async (step, next) => {
      // Restored inboxes may wake before plugin setup finishes. Hold admission,
      // rather than consuming that work with a temporary initialization error.
      if (!ready && !closed) await initialized.promise
      let revision: number
      try { revision = current().revision; assertActive(agent, revision, step.signal) }
      catch { return { kind: 'reject' } }
      const decision = await next()
      if (decision.kind === 'reject') return decision
      try { assertActive(agent, revision, step.signal) }
      catch { return { kind: 'reject' } }
      try { return { ...decision, messages: inputs.admit(step.turn, step.messages, decision.messages) } }
      catch {
        // A rejected step ends rc.5's driver even when another ordinary turn
        // was queued behind it. Re-wake that same input, preserving order and
        // identity. Direct owner input never inherits the expired dispatch.
        void agent.whenIdle().then(() => {
          if (closed || !bindings.has(agent) || ctx.agents.get(agent.id) !== agent || agent.status !== 'idle'
            || current().state !== 'running' || !agent.inbox.nextTurn.length) return
          const [last] = agent.inbox.splice('next-turn', -1, 1, [])
          if (last) agent.followup(last)
        }).catch(error => ctx.logger.warn('恢复后续会话输入失败：%s', String(error)))
        return { kind: 'reject' }
      }
    }))
    registered.push(agent.ctx.on('tools/pre-execute', async (exec, next) => {
      grants.set(exec.token, current().revision)
      const decision = await next()
      if (decision.kind !== 'allow') return decision
      try { checkCall(agent, exec) }
      catch (error) { return { kind: 'deny', reason: String(error) } }
      const sensitive = sensitiveSpiritCall(exec.name, exec.arguments)
      if (sensitive && current().mode === 'ask') return { kind: 'ask', reason: `精神申请执行 ${exec.name}：${brief(JSON.stringify(exec.arguments), 3000)}` }
      return decision
    }))
    registered.push(agent.ctx.tools.guard(exec => {
      try { checkCall(agent, exec) }
      catch (error) { return String(error) }
      const passive = ['spirit_memory', 'spirit_reflect'].includes(exec.name)
        || exec.name === 'spirit_read' && (exec.arguments as { action?: unknown })?.action !== 'retry'
      if (task && (workerId(service.require(task.id)) !== agent.id || !liveTicket(service.require(task.id)))
        && !passive) return '这项执行已经结束；新的行动需要有效的继续或新事项。'
      if (task && !passive) {
        try { service.assertTaskIntent(task.id) }
        catch (error) { return String(error) }
        const source = service.book.latestRequestSource(task.id)
        if (source.kind === 'self' && source.grantRevision !== current().revision) return '自主发起所依据的本人授权已经改变；需要重新判断或继续。'
      }
      if (!task && control.sessions().find(item => item.id === agent.id)?.kind === 'task'
        && !passive) return '这个历史执行会话已没有有效派工。'
    }))
    registered.push(agent.ctx.on('tools/result', exec => { grants.delete(exec.token) }))
    registered.push(agent.ctx.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: 0, text: '', interpolate: false }))
    registered.push(agent.ctx.systemPrompt.section({ name: PERSONA_SUFFIX_SECTION, order: 10000, text: '', interpolate: false }))
    registered.push(agent.ctx.systemPrompt.section({ name: 'spirit', order: 9999, interpolate: false,
      text: `${METHOD}\n${task ? WORKER : agent.id === mainId ? MAIN : CONVERSATION}\n源码目标：${JSON.stringify(book.targets)}` }))
    // rc.5 refreshes required runtime context at admission, including the first request
    // after native compaction or resume. The current state also drives the scheduler.
    registered.push(agent.ctx.systemPrompt.context({ name: 'spirit-current', order: 560, required: true, interpolate: false,
      text: () => {
        const orientation = continuity.current()
        const memories = service.book.workingMemories(6)
        const work = task && service.require(task.id)
        const activeIntents = thinking.workingIntents(8, { sessionId: agent.id, affairId: work?.id })
        return '精神当前活动（来自运行状态；引文与模型判断保留各自来源）：\n' + JSON.stringify({
          mainId, sessionId: agent.id, ownerControl: { mode: current().mode, state: current().state, revision: current().revision },
          orientation, activeIntents: activeIntents.items, activeIntentCount: activeIntents.total,
          ...(activeIntents.total > activeIntents.items.length ? { moreIntents: 'spirit_read(action=intentions,activeOnly=true)，可按会话或事情筛选当前意向' } : {}),
          awaitingDecision: thinking.awaiting(agent.id),
          ...(work ? { task: { id: work.id, title: work.title, scope: brief(work.mandate.scope, 800), ended: work.ended?.by } } : {}),
          recentExchanges: continuity.recent(3), memories,
        })
      } }))
    const register = <T extends z.ZodType>(toolName: string, description: string, schema: T, execute: (args: z.infer<T>, exec: ToolRunContext) => unknown | Promise<unknown>): void => {
      registered.push(agent.ctx.tools.register({ name: toolName, description, parameters: { type: 'object', ...z.toJSONSchema(schema) },
        output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        execute: async (args, exec) => {
          checkCall(agent, exec)
          const revision = grants.get(exec.token) ?? current().revision
          return scopes.run({ agent, revision, signal: exec.signal, checkInput: () => inputs.assertCurrent() },
            async () => jsonValue(await execute(schema.parse(args), exec)))
        } }))
    }
    register('spirit_orient', '修订所有精神会话当前共同采用的理解和做法。attention 可改变开放机会的调度。遇到其他会话的新版本须重新判断。', OrientationInput,
      (input, exec) => {
        const orientation = continuity.revise(input, turnSource(agent, exec))
        if (input.attention !== undefined) thinking.tick()
        return orientation
      })
    const ReadInput = z.object({ action: z.enum(['state', 'orientation', 'exchanges', 'trace', 'events', 'opportunity', 'intent', 'memories', 'reflections', 'intentions', 'opportunities', 'revisits', 'retry']).default('state'),
      ticketId: Id.optional(), evidenceId: Id.optional(), frame: z.number().int().positive().optional(), opportunityId: Id.optional(), intentId: Id.optional(),
      sessionId: Id.optional(), affairId: Id.optional(), activeOnly: z.boolean().optional(),
      memoryId: Id.optional(), reflectionId: Id.optional(), resultRound: z.number().int().positive().optional(),
      startSeq: z.number().int().nonnegative().optional(), throughSeq: z.number().int().nonnegative().optional(), beforeSeq: z.number().int().nonnegative().optional(),
      offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(32), reason: Text.optional() }).strict()
    register('spirit_read', '读取实际任务、经验、记忆、意向和思考机会。trace 按实际 sessionId、startSeq 追溯公开交往，可使用 nextBeforeSeq 翻页。retry 须给出理由。', ReadInput, async (input, exec) => {
      const withPage = <T,>({ items, total }: { items: readonly T[]; total: number }) => ({ items, total, offset: input.offset,
        limit: input.limit, hasMore: input.offset + input.limit < total, nextOffset: input.offset + input.limit < total ? input.offset + input.limit : null })
      const page = <T,>(values: readonly T[]) => withPage({ items: values.slice(input.offset, input.offset + input.limit), total: values.length })
      if (input.action === 'orientation') return { current: continuity.current(), history: continuity.history(input.offset, input.limit) }
      if (input.action === 'exchanges') return { items: continuity.recent(input.limit, input.offset) }
      if (input.action === 'trace') {
        if (!input.sessionId || input.startSeq === undefined) throw new Error('回溯需要真实会话的 sessionId 和 startSeq')
        const recordedEnd = continuity.throughSeq(input.sessionId, input.startSeq)
        const throughSeq = recordedEnd ?? input.throughSeq
        if (throughSeq === undefined || throughSeq < input.startSeq) throw new Error('没有该回合的索引；请提供来源中的 throughSeq')
        const page = await bridge.read(input.sessionId, { beforeSeq: input.beforeSeq, throughSeq, maxMessages: input.limit, signal: exec.signal })
        return { ...publicSessionPage(page, input.startSeq), startSeq: input.startSeq }
      }
      if (input.action === 'events') return { events: thinking.events({ opportunityId: input.opportunityId, sessionId: input.opportunityId ? undefined : agent.id, offset: input.offset, limit: input.limit }), offset: input.offset, limit: input.limit }
      if (input.action === 'opportunity') { if (!input.opportunityId) throw new Error('需要 opportunityId'); return { opportunity: thinking.getOpportunity(input.opportunityId) } }
      if (input.action === 'intent') { if (!input.intentId) throw new Error('需要 intentId'); return { intent: thinking.getIntent(input.intentId), history: withPage(thinking.intentHistoryPage(input.intentId, input.offset, input.limit)) } }
      if (input.action === 'memories') return input.memoryId ? { memory: service.book.memory(input.memoryId) } : withPage(service.book.memoryPage(input.offset, input.limit))
      if (input.action === 'reflections') return input.reflectionId ? { reflection: service.book.reflection(input.reflectionId) }
        : withPage(service.book.reflectionPage(input.offset, input.limit, input.ticketId))
      if (input.action === 'intentions') return withPage(thinking.intentPage(input))
      if (input.action === 'opportunities' || input.action === 'revisits') return withPage(thinking.recordsPage(input.action, input.offset, input.limit))
      if (input.action === 'retry') {
        if (!input.opportunityId || !input.reason) throw new Error('明确重试需要 opportunityId 和 reason')
        const opportunity = thinking.getOpportunity(input.opportunityId)
        if (opportunity.sessionId !== agent.id) throw new Error('只能重试当前会话的思考机会')
        const value = thinking.retry(input.opportunityId, input.reason); thinking.tick(); return { opportunity: value }
      }
      const ticketId = task?.id ?? input.ticketId
      if (ticketId) {
        const value = service.book.get(ticketId)
        if (input.evidenceId) { const evidence = value.evidence.find(item => item.id === input.evidenceId); if (!evidence) throw new Error('证据不存在'); return { evidence } }
        if (input.frame) { const frame = value.frames.find(item => item.number === input.frame); if (!frame) throw new Error('形态不存在'); return { frame, examinations: value.examinations.filter(item => item.frame === input.frame) } }
        if (input.resultRound) return page(value.results.filter(item => item.round === input.resultRound))
        return { task: service.require(ticketId), experience: service.book.context(ticketId) }
      }
      const tickets = service.ticketPage(input.offset, input.limit)
      return { tasks: tickets.items,
        totalTasks: tickets.total, hasMore: input.offset + input.limit < tickets.total, offset: input.offset, limit: input.limit,
        pending: withPage(service.ticketPage(input.offset, input.limit, true)), memories: withPage(service.book.memoryPage(input.offset, input.limit)),
        reflections: withPage(service.book.reflectionPage(input.offset, input.limit)), autonomy: { control: thinking.getControl(), error: thinking.error,
          intents: withPage(thinking.intentPage(input)), opportunities: withPage(thinking.recordsPage('opportunities', input.offset, input.limit)),
          revisits: withPage(thinking.recordsPage('revisits', input.offset, input.limit)), decisions: withPage(thinking.recordsPage('decisions', input.offset, input.limit)) },
        controls: current(), permission, watches: page(control.watches()), health: service.health.all }
    })
    register('spirit_decline', '自行决定不承接当前本人请求。记录本次判断，不建立或派发任务。', z.object({ reason: Text }).strict(), async (input, exec) => {
      const request = await ownerRequestFor(agent, exec)
      if (!request) throw new Error('当前回合没有本人的请求')
      return { decision: service.decline(request, input.reason, exec.callId, request.turn) }
    })
    register('spirit_start', '承接当前本人请求，或以 self 来源在持续授权内发起独立任务。明确依赖某个意向版本时同时提供 intentId、intentRevision。', StartInput, async (input, exec) => {
      const request = await workRequest(agent, exec, input)
      const value = service.open(request, { title: input.title, criteria: input.criteria })
      control.record('task-start', input.title, request.kind === 'self' ? request.reason : '本人当前回合的真实请求', agent.id)
      return { task: value }
    })
    register('spirit_continue', '把本人当前请求或明确的自主判断交给已有事情；依赖更新的意向时提供其 ID 与版本。', ContinueInput, async (input, exec) => ({ task: service.followup(input.ticketId, await workRequest(agent, exec, input)) }))
    register('spirit_stop', '停止一件事情。若依据本人的停止要求，保留本人原话及模型作出的停止判断；自主停止记录为 dropped。', z.object({ ticketId: Id.optional(), reason: Text, origin: z.enum(['owner', 'self']).default('self') }).strict(), async (input, exec) => {
      const id = task?.id ?? input.ticketId
      if (!id) throw new Error('需要 ticketId')
      const request = input.origin === 'owner' ? await ownerRequestFor(agent, exec) : undefined
      if (input.origin === 'owner' && !request) throw new Error('当前回合没有本人的停止请求')
      const value = service.stopTask(id, input.reason, request?.turn ?? turnSource(agent, exec), request)
      control.record('task-stop', value.task.title, input.reason, agent.id)
      return value
    })
    register('spirit_memory', '记录或修订有来源、有限度的记忆；模型记录不表示本人确认。', MemoryInput, (input, exec) => {
      const source = realSource(agent, exec, input)
      return { memory: task ? service.book.remember(task.id, input, source) : service.book.rememberGlobal(input, source) }
    })
    register('spirit_reflect', '记录实际理解的变化、根据、检验与限度；无需虚构矛盾或阶段。', ReflectionInput,
      (input, exec) => ({ reflection: service.book.reflect(task?.id, input, realSource(agent, exec, input)) }))
    const intentSource = (exec: ToolRunContext) => {
      const turn = turnSource(agent, exec)
      return { kind: 'self' as const, reference: `${agent.id}:tool:${exec.callId}`, turn }
    }
    const recordIntent = (input: unknown) => service.store.atomic(() => {
      const intent = thinking.recordIntent(input)
      service.reconcileIntents()
      return { intent }
    })
    register('spirit_intent', '形成、修订或放下可追溯的意向。revisit 只安排一次思考机会。', IntentToolInput,
      (input, exec) => recordIntent({ ...input, sessionId: input.expectedRevision !== undefined && input.id ? thinking.getIntent(input.id).sessionId : mainId, source: intentSource(exec) }))
    register('spirit_decide', '对收到的思考机会明确作出判断；接收消息本身不代表思考已经完成。', DecisionInput, (input, exec) => {
      if (thinking.getOpportunity(input.opportunityId).sessionId !== agent.id) throw new Error('思考机会属于另一个会话')
      return service.store.atomic(() => {
        const decision = thinking.decide(input, turnSource(agent, exec))
        service.reconcileIntents()
        return { decision }
      })
    })
    register('spirit_revisit', '根据当前意向安排一次具体时点或可观察事件后的再考虑。', z.object({ intentId: Id, expectedRevision: z.number().int().nonnegative(), reason: Text, revisit: RevisitInput }).strict(), (input, exec) => {
      const intent = thinking.getIntent(input.intentId)
      return recordIntent({ id: intent.id, expectedRevision: input.expectedRevision, sessionId: intent.sessionId, statement: intent.statement,
        reason: input.reason, state: 'waiting', source: intentSource(exec), affairId: intent.affairId,
        affairRevision: intent.affairRevision, eventIds: intent.eventIds, revisit: input.revisit })
    })
    register('spirit_sessions', '查阅、创建和联系 Harness 会话，选择模型与思考强度。发出的内容明确归于精神；post 接收回执不表示模型完成。', SessionsInput, async (input, exec) => {
      switch (input.action) {
        case 'list': return bridge.list({ limit: input.limit, offset: input.offset, signal: exec.signal })
        case 'read': return publicSessionPage(await bridge.read(input.sessionId, { ...input, signal: exec.signal }))
        case 'search': return bridge.search(input.query, exec.signal)
        case 'models': return bridge.models()
        case 'create': {
          const selected = input.selection ?? agent.model.current()
          const created = await bridge.create({ title: input.title, cwd: input.cwd ?? agent.session.header.cwd ?? join(config.stateDir, 'workspace'),
            agentPreset: 'dsh-spirit', permissionPreset: presetFor(current().mode), ...(selected ? { model: selected } : {}), signal: exec.signal })
          checkCall(agent, exec)
          control.manage(created.sessionId, input.title, input.reason, 'initiative')
          const child = await resolve(created.sessionId); checkCall(agent, exec); setNativePermission(child); bind(child)
          control.record('session-created', input.title, input.reason, created.sessionId)
          return created
        }
        case 'post': {
          const result = await bridge.post({ sessionId: input.sessionId, requestId: input.requestId ?? `tool:${exec.callId}`, text: input.text, mode: input.mode, fromSessionId: agent.id, signal: exec.signal })
          control.record('session-message', brief(input.text, 1000), input.reason, input.sessionId); return result
        }
        case 'model': return { selected: await bridge.selectModel(input.sessionId, input.selection, exec.signal) }
        case 'stop': {
          const target = ctx.agents.get(input.sessionId as SessionId)
          const result = await bridge.stop(input.sessionId, { wait: false, signal: exec.signal, cause: { kind: 'hook', reason: `精神：${input.reason}` } })
          if (target && control.managed(target.id)) delegation?.revoke(target)
          return result
        }
        case 'watch': await bridge.read(input.sessionId, { maxMessages: 1, signal: exec.signal }); checkCall(agent, exec); control.watch(input.sessionId, input.reason); return { watched: input.sessionId }
        case 'unwatch': control.unwatch(input.sessionId); return { unwatched: input.sessionId }
      }
    })
    register('spirit_change', '记录源码候选、比较、原生执行验证、应用、回退或请求激活；文件改变与运行版本生效分别记录。', ChangeInput, async (input, exec) => {
      const changeAllowed = () => {
        checkCall(agent, exec)
        if (activation?.list().some(receipt => ['requested', 'restarting', 'booting'].includes(receipt.status))) {
          throw new Error('已有版本正在等待或进行激活；先核对其结果，再验证、应用或回退其他改动。')
        }
      }
      if (['verify', 'apply', 'rollback'].includes(input.action)) changeAllowed()
      switch (input.action) {
        case 'list': {
          const values = book.list(), activated = activation?.snapshot()
          return { targets: book.targets, changes: values.slice(input.offset, input.offset + input.limit).map(record => ({
            id: record.id, createdAt: record.createdAt, state: record.state, reason: record.input.reason, priorLimitations: record.input.priorLimitations,
            recoveryScript: record.recoveryScript, verificationCount: record.verifications.length, verified: record.verified,
            activation: record.activation, runtimeActivation: activated?.receipts.findLast(receipt => receipt.changeId === record.id),
            targets: record.targets.map(target => ({ id: target.id, root: target.root,
              checkpointDirectory: target.checkpointDirectory, candidateDirectory: target.candidateDirectory,
              baselineDigest: target.baselineDigest, baselineFileCount: Object.keys(target.baseline).length })) })),
            supervisor: activated?.supervisor, total: values.length, offset: input.offset, limit: input.limit, hasMore: input.offset + input.limit < values.length }
        }
        case 'begin': { const { action: _action, ...change } = input; return book.begin(change) }
        case 'read': return { ...book.read(input.id), runtimeActivation: activation?.list().filter(receipt => receipt.changeId === input.id) }
        case 'compare': return book.compare(input.id)
        case 'verify': return book.verify(input.id, input.checks, async command => {
          changeAllowed()
          const batch = await agent.ctx.tools.execute({ agent, signal: exec.signal, maxParallelToolCalls: 1,
            calls: [{ type: 'tool-call', id: ToolCallId(`spirit-check:${exec.callId}:${key(command.target, command.command)}`), name: process.platform === 'win32' ? 'pwsh' : 'bash',
              arguments: JSON.stringify({ description: 'Verify the proposed Spirit source changes', command: command.command, workdir: command.cwd, timeoutMs: input.timeoutMs, run_in_background: false }) }] })
          const result = batch.results[0]?.result
          if (!result || result.isError) throw new Error(result?.isError ? result.error.message : '宿主没有返回检查结果')
          const value = result.value as { kind?: string; exitCode?: number | null; timedOut?: boolean; aborted?: boolean; stdout?: { text?: string; truncated?: boolean }; stderr?: { text?: string; truncated?: boolean } }
          if (value.kind !== 'foreground' || value.timedOut || value.aborted || typeof value.exitCode !== 'number') throw new Error('检查没有以前台进程完整结束；后台启动或超时不算验证通过')
          changeAllowed()
          const output = (stream?: { text?: string; truncated?: boolean }) => `${stream?.text ?? ''}${stream?.truncated ? '\n［宿主已截短此输出］' : ''}`
          return { exitCode: value.exitCode, stdout: output(value.stdout), stderr: output(value.stderr) }
        })
        case 'apply': return book.apply(input.id, changeAllowed)
        case 'rollback': return book.rollback(input.id, changeAllowed)
        case 'activate': {
          checkCall(agent, exec)
          if (!activation) throw new Error('激活服务尚未就绪')
          return activation.request(book.activationDetails(input.id), input.reason)
        }
      }
    })
    if (task) {
      register('spirit_frame', '按需明确当前对象、判断、尺度和限度。', FrameInput, input => ({ frame: service.book.frame(task.id, input) }))
      register('spirit_evidence', '记录可以追溯的材料；推断明确归为 inference。', EvidenceInput, input => ({ evidence: service.book.evidence(task.id, input) }))
      register('spirit_examine', '按当前理解自己的尺度检验，记录具体成立处和矛盾。', ExaminationInput, input => ({ examination: service.book.examine(task.id, input) }))
      register('spirit_revise', '依据具体检验修订理解，保留成立内容和形成史。', RevisionInput, input => ({ frame: service.book.revise(task.id, input) }))
      register('spirit_report', '如实报告实际成果、进展、等待或阻碍；结构化哲学表格不是交付前置条件。', z.object({
        state: z.enum(['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped']), summary: z.string().trim().min(1).max(12000), limits: z.string().max(8000).default(''),
        check: z.string().max(8000).default(''), evidenceIds: z.array(Id).max(64).default([]), question: z.string().trim().min(1).max(2000).nullable().optional(),
      }).strict(), ({ limits, check, evidenceIds, ...report }, exec) => ({ task: service.report(task.id, report, limits, evidenceIds, check, turnSource(agent, exec)) }))
    }
  }

  const synchronizePermissions = async (revision: number, discardPending = false): Promise<void> => {
    if (closed) throw new Error('精神正在关闭')
    if (current().revision !== revision) throw new Error('本人控制已更新，等待最新选择')
    permission = { status: 'pending', detail: '正在将本人选择应用到所有托管会话。' }
    try {
      const target = current()
      if (target.revision !== revision) throw new Error('本人控制已更新，等待最新选择')
      ctx.permissionPresets.resolve(presetFor(target.mode))
      for (const item of owner!.sessions()) {
        if (current().revision !== revision) throw new Error('应用过程中本人控制已更新')
        const result = await ctx.sessionController.resolveAgent(item.id as SessionId)
        if ('error' in result) {
          if (result.error.code === 'session/not-found') continue
          throw new Error(`${item.id}：${result.error.code}`)
        }
        if (current().revision !== revision) throw new Error('应用过程中本人控制已更新')
        if (!belongs(result.agent)) continue
        if (discardPending) result.agent.cancel({ kind: 'user' }, { keepInbox: false })
        setNativePermission(result.agent); bind(result.agent)
      }
      if (discardPending) cancelManaged('user')
      await ctx.sessionPersistence.flush()
      if (current().revision !== revision) throw new Error('本人控制已更新')
      permission = { status: 'applied', detail: target.mode === 'full' ? '所有托管会话使用宿主完全访问预设。' : '所有托管会话使用宿主工作区写入与询问预设；精神的跨会话和源码敏感操作逐次询问。' }
      actualPermission()
    } catch (error) {
      if (current().revision === revision) permission = { status: 'error', detail: String(error) }
      throw error
    }
  }
  const cancelManaged = (kind: 'user' | 'disposed', keepInbox = false): void => {
    delegation?.revoke()
    for (const item of owner?.sessions() ?? []) {
      const agent = ctx.agents.get(item.id as SessionId)
      if (agent && belongs(agent)) agent.cancel({ kind }, { keepInbox })
    }
  }
  const syncAutonomy = (): void => {
    if (!autonomy) return
    const value = current(), mode = value.state === 'running' ? 'active' : value.state
    if (autonomy.getControl().mode !== mode) autonomy.control(mode, value.reason)
  }
  const snapshot = () => {
    actualPermission()
    const control = current(), thinking = autonomy!.snapshot()
    const recoverable = thinking.opportunities.some(item => item.state === 'awaiting_decision' || item.state === 'retry')
    return jsonValue({ ...app!.snapshot(), mainId, orientation: continuity.current(), permissions: { mode: control.mode, ...permission, nativePreset: presetFor(control.mode),
      scope: '主会话、事务会话、使用精神预设的个人会话，以及这些会话当前授权的原生委派。', revision: control.revision },
      autonomy: { state: control.state, reason: control.reason, recoverable, error: thinking.error },
      sessions: owner!.sessions().map(item => { const agent = ctx.agents.get(item.id as SessionId), model = agent?.model.current();
        return { ...item, status: agent?.status ?? 'stored', model: model ? `${model.provider}/${model.model}` : '', effort: model?.reasoningEffort ?? '' } }),
      intentions: thinking.intents.map(intent => ({ ...intent, title: intent.statement })), opportunities: thinking.opportunities, revisits: thinking.revisits,
      activity: owner!.activity(), changes: changes!.list().map(change => ({ id: change.id, at: change.createdAt, summary: change.input.priorLimitations,
        reason: change.input.reason, status: change.state, activation: change.activation })), activation: activation?.snapshot() })
  }
  const shutdown = async (): Promise<void> => {
    if (closed) return
    closed = true; ready = false; lifetime.abort(new Error('精神插件正在关闭'))
    initialized.resolve()
    disposers.splice(0).reverse().forEach(dispose => dispose())
    for (const registered of bindings.values()) registered.reverse().forEach(dispose => dispose())
    bindings.clear(); grants.clear()
    cancelManaged('disposed', true)
    try { await delegation?.close(); await autonomy?.close(); await app?.stop() }
    finally { if (!released) { released = true; release() } }
  }

  try {
    app = new PersonalService(config.stateDir, {
      ensure: async (sessionId, directory, title, ownerSession) => {
        const scope: CallScope = { revision: current().revision, signal: lifetime.signal }
        assertActive(undefined, scope.revision, scope.signal)
        await scopes.run(scope, () => ensureSession(sessionId, directory, title, '持续事情的独立执行会话', 'task', ownerSession, scope))
      },
      send: async (sessionId, requestId, text, notice) => {
        const scope: CallScope = { revision: current().revision, signal: lifetime.signal }
        assertActive(undefined, scope.revision, scope.signal)
        const task = ticketFor(sessionId)
        if (!task && autonomy) {
          autonomy.observe({ id: `task-result:${requestId}`, sessionId, kind: notice ? 'task-status' : 'task-result', summary: brief(text),
            source: { kind: 'system', reference: requestId } })
          autonomy.tick(); return
        }
        if (task) scope.checkInput = () => {
          app!.assertTaskIntent(task.id)
          const source = app!.book.latestRequestSource(task.id)
          if (source.kind === 'self' && source.grantRevision !== scope.revision) throw new Error('自主发起所依据的本人授权已经改变')
          if (workerId(app!.require(task.id)) !== sessionId || !liveTicket(app!.require(task.id))) throw new Error('原执行已经结束')
        }
        await scopes.run(scope, async () => {
          const agent = await resolve(sessionId)
          assertActive(agent, scope.revision, scope.signal)
          scope.checkInput?.()
          bind(agent)
          await bridge.post({ sessionId, requestId, text, mode: notice ? 'context' : 'queue', fromSessionId: mainId, signal: scope.signal })
        })
      },
      stop: async sessionId => {
        const agent = ctx.agents.get(sessionId as SessionId)
        if (!agent) return
        delegation?.revoke(agent)
        agent.cancel(closed ? { kind: 'disposed' } : { kind: 'hook', reason: '精神的事项执行已结束' }, { keepInbox: closed })
        // This may run in the stopping worker's own tool or during its plugin activation.
        await ctx.sessionPersistence.flush()
      },
    }, config.concurrency, config.maxRevisions === 0 ? Number.POSITIVE_INFINITY : config.maxRevisions, {
      paused: () => !ready || closed || !owner || owner.current().state !== 'running' || permission.status !== 'applied',
      initiativeAllowed: request => ready && !closed && owner?.current().state === 'running' && permission.status === 'applied' && owner.current().revision === request.grantRevision,
      intentCurrent: intent => autonomy?.isCurrentIntent(intent.id, intent.revision),
    })
    owner = new SpiritControl(app.store)
    delegation = new SpiritDelegation(ctx, {
      owns: root => !!owner?.managed(root.id) && ctx.agents.get(root.id) === root && belongs(root),
      revision: () => current().revision,
      assert: (root, revision, signal) => {
        assertActive(root, revision, signal)
        const task = ticketFor(root.id)
        if (task && (workerId(app!.require(task.id)) !== root.id || !liveTicket(app!.require(task.id)))) {
          throw new Error('原执行已经结束')
        }
        if (task) {
          const source = app!.book.get(task.id).latestSource
          if (source.kind === 'self' && source.grantRevision !== revision) throw new Error('原执行所依据的本人授权已经改变')
        }
      },
    })
    continuity = new Continuity(app.store)
    disposers.push(preserveLegacySpiritPreset(ctx))
    disposers.push(preserveManagedBlankPreset(ctx, id => !closed && !ctx.workspaceRegistry.archivedSessionIds.includes(id as SessionId)))
    changes = new SelfChangeBook({ stateDir: config.stateDir, targets: [{ id: 'spirit', root: config.sourceRoot, label: '精神插件', activation: 'plugin-reload' },
      ...(config.harnessSourceRoot ? [{ id: 'harness', root: config.harnessSourceRoot, label: 'DeepSeek Harness', activation: 'host-restart' as const }] : [])] })
    activation = new ActivationService({ stateDir: config.stateDir })
    autonomy = new Autonomy(app.store, { deliberate: async (packet, signal) => {
      const scope: CallScope = { revision: current().revision, signal }
      assertActive(undefined, scope.revision, signal)
      await scopes.run(scope, async () => {
        const agent = await resolve(packet.opportunity.sessionId)
        assertActive(agent, scope.revision, signal); bind(agent)
        const selected = agent.model.current()
        if (!selected) throw new Error('会话尚未选择可用模型；思考机会保留供稍后重试')
        await ctx.llm.resolveCallConfig(selected, signal)
        assertActive(agent, scope.revision, signal)
        await bridge.post({ sessionId: agent.id, requestId: packet.dispatchId, text: JSON.stringify(packet), mode: 'queue', fromSessionId: mainId, signal,
          beforeEnqueue: live => {
            assertActive(live, scope.revision, signal)
            autonomy!.assertReadyToDeliver(live.id, packet.dispatchId, signal)
            const model = live.model.current()
            if (!model || model.provider !== selected.provider || model.model !== selected.model || model.reasoningEffort !== selected.reasoningEffort) {
              throw new Error('思考机会发送前模型选择已经改变')
            }
          },
        })
        owner!.record('deliberation', '已将一次思考机会交给模型；尚不表示它已经作出判断。', packet.opportunity.reason, agent.id)
      })
    } }, { concurrency: config.concurrency, openActivity: {
      sessionId: mainId, intervalMs: config.openIntervalMinutes * 60_000,
      grant: () => current().mode === 'full' && current().state === 'running' ? current().revision : undefined,
      willing: () => continuity.current().attention === 'open',
      idle: () => {
        const main = ctx.agents.get(mainId as SessionId)
        return ready && permission.status === 'applied' && main?.status === 'idle' && !!main.model.current()
          && !main.inbox.nextTurn.length && !main.inbox.nextStep.length
      },
    } })
    syncAutonomy()
    const participate = (agent: Agent, preset = ctx.agentPresets.presetForSession(agent.session)) => {
      if (preset === legacySpiritPreset && ctx.agentPresets.composedPreset(agent.ctx) === spiritPreset) {
        agent.session.append('agent-preset/selected', { agentPreset: spiritPreset })
        preset = spiritPreset
      }
      if (agent.session.header.origin === 'subagent') return
      const selected = belongs(agent, preset)
      const existing = owner!.session(agent.id)
      if (!selected && existing) {
        delegation?.revoke(agent)
        if (existing.kind === 'conversation') {
          owner!.releaseConversation(agent.id)
          if (existing.previousPermission && ctx.permissionPresets.current(agent.session) === presetFor(current().mode)) {
            ctx.permissionPresets.set(agent.session, existing.previousPermission)
          }
        }
        bindings.get(agent)?.reverse().forEach(dispose => dispose()); bindings.delete(agent)
        return
      }
      if (selected && !existing) {
        const native = ctx.permissionPresets.current(agent.session)
        // A custom combination has no preset to reapply. Keep it intact when
        // joining would replace an explicit native permission configuration.
        if (native === 'custom') return
        owner!.manage(agent.id, '个人会话', '本人在此会话使用精神预设', 'conversation', native)
      }
      if (owner!.managed(agent.id)) { setNativePermission(agent); bind(agent) }
    }
    disposers.push(ctx.on('agent/created', ({ agent }) => { participate(agent) }))
    disposers.push(ctx.on('agent-preset/selected', (id, preset) => {
      const agent = ctx.agents.get(id as SessionId)
      if (agent) participate(agent, preset)
    }))
    disposers.push(ctx.on('agent/disposed', ({ agent }) => { bindings.get(agent)?.reverse().forEach(dispose => dispose()); bindings.delete(agent) }))
    disposers.push(ctx.on('agent/status', ({ agent, status }) => {
      if (closed || status !== 'idle') return
      const task = ticketFor(agent.id)
      if (task && workerId(app!.require(task.id)) === agent.id) app!.idle(task.id)
    }))
    disposers.push(ctx.on('agent/error', ({ agent, error }) => {
      if (closed) return
      const task = ticketFor(agent.id)
      if (task && workerId(app!.require(task.id)) === agent.id && liveTicket(app!.require(task.id))) {
        app!.report(task.id, { state: 'failed', summary: brief(String(error), 12000) }); app!.idle(task.id)
      }
      if (owner!.managed(agent.id)) owner!.record('agent-error', brief(String(error)), undefined, agent.id)
    }))
    disposers.push(ctx.on('session/event', (session, event) => {
      if (closed) return
      if (event.type === 'turn/end') {
        const agent = ctx.agents.get(session.id)
        const admitted = agent && turnInputs.get(agent)?.finish(event.data.turn)
        if (admitted && event.data.reason.kind === 'completed') {
          for (const id of admitted) autonomy!.recordOpenTurnEnd(session.id, id, event.data.turn, event.seq)
        }
      }
      if (owner!.managed(session.id) && ['permission/preset', 'sandbox/mode', 'approval/policy'].includes(event.type)) actualPermission()
      if (['user/message', 'assistant/message', 'turn/end'].includes(event.type) && owner!.managed(session.id)) {
        const boundary = ctx.agents.turnBoundaryOf(session)
        continuity.observe(session.id, boundary.openTurnStartSeq, boundary.lastTurn, event)
      }
      if (event.type !== 'user/message') return
      const source = event.data.source as { kind: string; principal?: unknown }
      const text = event.data.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
      const task = ticketFor(session.id)
      if (task && workerId(app!.require(task.id)) === session.id && liveTicket(app!.require(task.id))) {
        if (source.kind === 'user' && !Object.hasOwn(source, 'principal')) app!.book.userEvidence(task.id, event.data.id, text, session.id)
        else {
          const read = task.inputs.filter(input => spiritMessageId(session.id, input.id) === event.data.id).map(input => input.id)
          if (read.length) app!.engine.inputsRead(task.id, read)
        }
      }
      if (session.id !== mainId && source.kind === 'user' && !Object.hasOwn(source, 'principal') && text.trim() && owner!.watches().some(item => item.id === session.id)) {
        autonomy!.observe({ id: `watched:${key(session.id, event.data.id)}`, sessionId: mainId, kind: 'conversation-message',
          summary: brief(`会话 ${session.id} 收到本人消息：\n${text}`), source: { kind: 'user', reference: `${session.id}:${event.data.id}` } })
        autonomy!.tick()
      }
    }))
    await ensureSession(mainId, join(config.stateDir, 'workspace'), '精神', '与本人交互和持续安排工作的主会话', 'main')
    for (const ticket of app.store.tickets.list()) if (latestAssignment(ticket)) owner.manage(workerId(ticket), ticket.title, '持续事情的执行记录', 'task')
    for (const agent of ctx.agents.list()) participate(agent)
    await synchronizePermissions(current().revision)
    ready = true
    if (current().state !== 'running') cancelManaged('user')
    disposers.push(registerHttp(ctx, app, mainId, {
      snapshot,
      permissions: async mode => {
        const value = owner!.select({ mode }, mode === 'full' ? '本人选择完全访问' : '本人选择敏感操作询问')
        permission = { status: 'pending', detail: '本人权限选择已保存，正在应用到托管会话。' }
        cancelManaged('user')
        activation?.cancelPending('本人更新了权限选择；激活需要在新选择下重新判断')
        permissionChain = permissionChain.catch(() => {}).then(() => synchronizePermissions(value.revision, true))
        await permissionChain
        syncAutonomy(); app!.refresh(); autonomy!.tick(); return snapshot()
      },
      control: async action => {
        if (action === 'recover') {
          if (current().state !== 'running') throw new Error('先恢复活动，再明确重试尚未获判断的思考机会')
          assertActive()
          for (const opportunity of autonomy!.snapshot().opportunities) if (opportunity.state === 'awaiting_decision' || opportunity.state === 'retry') {
            try { autonomy!.retry(opportunity.id, '本人在面板明确重试尚未获得判断的思考机会') } catch { /* expired records remain visible */ }
          }
          autonomy!.tick(); return snapshot()
        }
        const state = action === 'resume' ? 'running' : action === 'pause' ? 'paused' : 'stopped'
        const value = owner!.select({ state }, `本人在面板${action === 'resume' ? '恢复' : action === 'pause' ? '暂停' : '停止'}活动`)
        syncAutonomy()
        if (action !== 'resume') {
          cancelManaged('user')
          activation?.cancelPending(`本人已${state === 'paused' ? '暂停' : '停止'}活动`)
          if (action === 'stop') for (const ticket of app!.store.tickets.open()) app!.engine.stopTicket(ticket.id, '本人在面板停止精神的活动')
        } else delegation?.revoke()
        // A state revision can supersede an in-flight permission application. Always
        // reconcile the latest durable owner choice before declaring it applied.
        permission = { status: 'pending', detail: '正在核对最新的本人控制与宿主权限。' }
        permissionChain = permissionChain.catch(() => {}).then(() => synchronizePermissions(value.revision, action !== 'resume'))
        await permissionChain
        if (action === 'resume') { app!.refresh(); autonomy!.tick() }
        return snapshot()
      },
    }))
    const pulse = setInterval(() => { if (!closed && ready) autonomy!.tick() }, 1000)
    pulse.unref(); disposers.push(() => clearInterval(pulse))
    ctx.effect(() => shutdown)
    app.refresh()
    const boot = activation.ackBoot(runtimeMetadata)
    if (boot?.requestId) {
      autonomy.observe({ id: `activation-loaded:${boot.requestId}`, sessionId: mainId, kind: 'activation-loaded',
        summary: `激活请求 ${boot.requestId} 的新进程已完成插件、主会话、权限和面板初始化，并写入启动回执。可检查当前实际行为和激活记录；启动本身不证明改动改善了行为。`,
        source: { kind: 'system', reference: boot.requestId } })
    }
    initialized.resolve()
    autonomy.tick()
    ctx.logger.info('精神已就绪：打开「精神」面板进入主会话。')
  } catch (error) { await shutdown(); throw error }
}
