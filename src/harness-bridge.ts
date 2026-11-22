/** Native, session-local operations for DeepSeek Harness 0.2.2-rc.5. */
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection as AgentModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelCatalog, ModelSelection, SessionEventsPage, SessionSummary } from '@deepseek-ai/dsh-api-session-controller'
import { boundContextSummary, freezeMessage, MessageId, ReasoningEffortId, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentCancelCause, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-agent-preset'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

export type SpiritDeliveryMode = 'queue' | 'steer' | 'context'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Spirit supplies this message; the user-role envelope does not imply human authorship. */
    spirit: {
      kind: 'spirit'
      requestId: string
      targetSessionId: string
      fromSessionId?: string
      delivery: SpiritDeliveryMode
    } & ContextFormed
  }
}

/** A narrow view of the actual native services, also usable by focused fakes. */
export interface HarnessBridgeContext {
  agents: Pick<Context['agents'], 'get'>
  sessionController: Pick<Context['sessionController'], 'resolveAgent' | 'list' | 'page' | 'search' | 'create' | 'rename' | 'modelCatalog'>
  sessionPersistence: Pick<Context['sessionPersistence'], 'flush' | 'open'>
  workspaceRegistry: Pick<Context['workspaceRegistry'], 'resolveByPath' | 'create'>
  permissionPresets: Pick<Context['permissionPresets'], 'catalog' | 'resolve' | 'current' | 'set'>
  llm: Pick<Context['llm'], 'resolveCallConfig'>
}

export type BridgeOperation = 'session.create' | 'session.workspace' | 'session.post' | 'session.model' | 'session.permission' | 'session.stop'
export interface BridgeOperationDetails {
  sessionId?: string
  fromSessionId?: string
  requestId?: string
  text?: string
  cwd?: string
  workspaceId?: string
  title?: string
  agentPreset?: string
  mode?: SpiritDeliveryMode
  selection?: ModelSelection
  permissionPreset?: string
  keepInbox?: boolean
}
export interface HarnessBridgeOptions {
  signal?: AbortSignal
  /** Rechecked after asynchronous preparation, immediately before each mutation. Throw to deny. */
  authorize?: (operation: BridgeOperation, details: Readonly<BridgeOperationDetails>) => void | Promise<void>
}
export interface CreateSpiritSession {
  /** Native create can replace a nonblank requested ID. Always use the returned sessionId. */
  sessionId?: string
  cwd?: string
  workspaceId?: string
  title?: string
  agentPreset?: string
  model?: ModelSelection
  permissionPreset?: string
  /** The dedicated main conversation has a native cwd but its own UI. */
  privateMain?: true
  signal?: AbortSignal
}
export interface SpiritPost {
  sessionId: string
  requestId: string
  text: string
  mode?: SpiritDeliveryMode
  fromSessionId?: string
  /** A short presentation label for non-waking context. */
  summary?: string
  signal?: AbortSignal
  /** Synchronous eligibility check immediately before the first native admission. */
  beforeEnqueue?: (agent: Agent) => void
}
export interface SpiritPostReceipt {
  accepted: true
  sessionId: string
  messageId: string
  mode: SpiritDeliveryMode
  duplicate: boolean
}
export interface SpiritSessionList {
  items: readonly SessionSummary[]
  total: number
  offset: number
  hasMore: boolean
  nextOffset: number | null
}
export interface SpiritSessionPage extends SessionEventsPage {
  sessionId: string
  /** Feed this into beforeSeq for older history; null when no older page exists. */
  nextBeforeSeq: number | null
}
export interface SpiritOwnerRequest {
  sessionId: string
  id: string
  text: string
}

/** Stable across retries, including session restore; separate sessions never share delivery identities. */
export function spiritMessageId(sessionId: string, requestId: string): MessageId {
  return MessageId(`spirit:${createHash('sha256').update(JSON.stringify([sessionId, requestId])).digest('hex')}`)
}

function nonempty(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty`)
  return value
}
function integer(value: number, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}`)
  return value
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
function fingerprint(message: UserMessage): string {
  return createHash('sha256').update(canonical({ content: message.content, source: message.source })).digest('hex')
}
function postedMessages(event: SessionEvent): readonly UserMessage[] {
  if (event.type === 'user/message') return [event.data]
  // An accepted input may be claimed and rejected, or canceled, without becoming user/message.
  if (event.type === 'agent/inbox/spliced') return event.data.inserted
  return []
}
type DeliveryHistory = { offset: number; fingerprints: Map<string, string> }

export interface PresetContinuityContext {
  sessionController: Pick<Context['sessionController'], 'create' | 'resolveAgent'>
  agents: Pick<Context['agents'], 'turnBoundaryOf'>
  agentPresets: Pick<Context['agentPresets'], 'presetForSession'>
}

/**
 * rc.5 Workspace navigation reuses blank Sessions through create(). Omission
 * reapplies the deployment default. Preserve an eligible blank's recorded
 * preset (including a user's explicit Standard selection) during navigation.
 * Explicit selections and new Sessions go directly to the native controller.
 */
export function preserveManagedBlankPreset(ctx: PresetContinuityContext, eligible: (id: string) => boolean, privateMainId?: string): () => void {
  const controller = ctx.sessionController, descriptor = Object.getOwnPropertyDescriptor(controller, 'create')
  const original = controller.create
  let active = true
  const create = async function(this: PresetContinuityContext['sessionController'], request: Parameters<typeof original>[0]) {
    if (active && privateMainId !== undefined && request.sessionId === privateMainId && request.workspaceId !== undefined) {
      // A client restored from an older profile can still name the former main blank.
      const { sessionId: _private, ...workspaceRequest } = request
      return original.call(this, workspaceRequest)
    }
    if (!active || request.sessionId === undefined || request.agentPreset !== undefined || !eligible(request.sessionId)) {
      return original.call(this, request)
    }
    const result = await this.resolveAgent(request.sessionId)
    if (active && !('error' in result) && eligible(request.sessionId)) {
      const boundary = ctx.agents.turnBoundaryOf(result.agent.session)
      const recorded = ctx.agentPresets.presetForSession(result.agent.session)
      if (boundary.openTurnStartSeq === null && boundary.lastTurn === 0 && recorded != null) {
        return original.call(this, { ...request, agentPreset: recorded })
      }
    }
    return original.call(this, request)
  }
  // Cordis returns a fresh traced function on property access. Inspect/restore
  // the own descriptor, preserving both the native receiver and its prototype.
  Object.defineProperty(controller, 'create', { configurable: true, writable: true, value: create })
  return () => {
    active = false
    if (Object.getOwnPropertyDescriptor(controller, 'create')?.value !== create) return
    if (descriptor) Object.defineProperty(controller, 'create', descriptor)
    else Reflect.deleteProperty(controller, 'create')
  }
}

/**
 * Owns no agents and changes no deployment defaults. The caller owns authorization,
 * preset composition and lifecycle. A post receipt acknowledges durable admission,
 * not model execution or completion. Context delivery does not wake an idle model.
 */
export class HarnessBridge {
  private readonly fallbackSignal = new AbortController().signal
  private readonly chains = new Map<string, Promise<void>>()
  private readonly histories = new WeakMap<Agent, DeliveryHistory>()

  constructor(private readonly ctx: HarnessBridgeContext, private readonly options: HarnessBridgeOptions = {}) {}

  private signal(caller?: AbortSignal): AbortSignal {
    const lifetime = this.options.signal
    return lifetime && caller ? AbortSignal.any([lifetime, caller]) : lifetime ?? caller ?? this.fallbackSignal
  }
  private async authorize(operation: BridgeOperation, details: BridgeOperationDetails, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.options.authorize?.(operation, Object.freeze({ ...details }))
    signal.throwIfAborted()
  }
  private async resolve(id: string, signal: AbortSignal): Promise<Agent> {
    nonempty(id, 'sessionId')
    signal.throwIfAborted()
    const result = await this.ctx.sessionController.resolveAgent(id as SessionId)
    signal.throwIfAborted()
    if ('error' in result) throw new Error(`Cannot open session ${id}: ${result.error.code}`)
    this.assertLive(result.agent)
    return result.agent
  }
  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) throw new Error(`Session ${agent.id} was disposed or replaced`)
  }
  private serial<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.chains.get(sessionId) ?? Promise.resolve()).then(operation)
    const settled = result.then(() => {}, () => {})
    this.chains.set(sessionId, settled)
    void settled.then(() => { if (this.chains.get(sessionId) === settled) this.chains.delete(sessionId) })
    return result
  }

  /** Reads the native list without activating any agent. Pagination is over this list snapshot. */
  async list(options: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<SpiritSessionList> {
    const signal = this.signal(options.signal)
    const limit = integer(options.limit ?? 50, 'limit', 1, 200)
    const offset = integer(options.offset ?? 0, 'offset', 0)
    signal.throwIfAborted()
    const { items } = await this.ctx.sessionController.list({}, signal)
    signal.throwIfAborted()
    const page = items.slice(offset, offset + limit)
    const hasMore = offset + page.length < items.length
    return { items: page, total: items.length, offset, hasMore, nextOffset: hasMore ? offset + page.length : null }
  }

  /** Native bounded content search. Its hasMore flag is retained; it is not an exhaustive transcript search. */
  async search(query: string, callerSignal?: AbortSignal) {
    const signal = this.signal(callerSignal)
    signal.throwIfAborted()
    return this.ctx.sessionController.search({ query: nonempty(query, 'query') }, signal)
  }

  /** Raw native events preserve message sources and exact content; no assistant/user text is synthesized. */
  async read(sessionId: string, options: { beforeSeq?: number; throughSeq?: number; maxMessages?: number; signal?: AbortSignal } = {}): Promise<SpiritSessionPage> {
    const signal = this.signal(options.signal)
    nonempty(sessionId, 'sessionId')
    const maxMessages = integer(options.maxMessages ?? 50, 'maxMessages', 1, 500)
    if (options.beforeSeq !== undefined) integer(options.beforeSeq, 'beforeSeq', 0)
    if (options.throughSeq !== undefined) integer(options.throughSeq, 'throughSeq', -1)
    signal.throwIfAborted()
    const page = await this.ctx.sessionController.page({
      address: { kind: 'session', sessionId: sessionId as SessionId }, maxMessages,
      ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
      ...(options.throughSeq === undefined ? {} : { throughSeq: options.throughSeq }),
    }, signal)
    signal.throwIfAborted()
    return { ...page, sessionId, nextBeforeSeq: page.hasMore ? page.records[0]?.event.seq ?? null : null }
  }

  /**
   * The last substantive input in the current open turn, only when authored by
   * the owner. Runtime snapshots, the skill catalog and model-switch notices are bookkeeping;
   * every other producer blocks borrowing an earlier human request. Closed
   * turns and restored historical requests supply no new owner authorization.
   * Reads native history without resuming the Session or using snapshotEvents.
   */
  async latestOwnerRequest(sessionId: string, callerSignal?: AbortSignal): Promise<SpiritOwnerRequest | undefined> {
    const signal = this.signal(callerSignal)
    nonempty(sessionId, 'sessionId')
    let beforeSeq: number | undefined, throughSeq: number | undefined
    let candidate: SpiritOwnerRequest | undefined
    for (;;) {
      signal.throwIfAborted()
      const page = await this.ctx.sessionController.page({
        address: { kind: 'session', sessionId: sessionId as SessionId }, maxMessages: 50,
        turnWindow: { minMessages: 1, minTurns: 1 },
        ...(beforeSeq === undefined ? {} : { beforeSeq }), ...(throughSeq === undefined ? {} : { throughSeq }),
      }, signal)
      signal.throwIfAborted()
      throughSeq ??= page.cursor
      for (let index = page.records.length - 1; index >= 0; index--) {
        const event = page.records[index]!.event
        if (event.type === 'turn/end') return undefined
        if (event.type === 'turn/start') return candidate
        if (event.type !== 'user/message' || candidate) continue
        const message = event.data
        if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined
        const source = message.source
        if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined
        if (source.kind === 'runtime-context' || source.kind === 'model-selection'
          || source.kind === 'time-context' && source.form === 'snapshot'
          || source.kind === 'skill-catalog' && source.form === 'catalog') continue
        if (source.kind !== 'user' || Object.prototype.hasOwnProperty.call(source, 'principal')) return undefined
        if (typeof message.id !== 'string' || !message.id || !Array.isArray(message.content)) return undefined
        const text = message.content.flatMap(part => part && typeof part === 'object' && !Array.isArray(part)
          && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n')
        if (!text.trim()) return undefined
        candidate = { sessionId, id: message.id, text }
      }
      if (!page.hasMore || !page.records.length) return undefined
      const next = page.records[0]!.event.seq
      if (beforeSeq !== undefined && next >= beforeSeq) throw new Error('Native session history did not advance')
      beforeSeq = next
    }
  }

  /** Includes exact adapter-owned reasoning efforts and per-provider catalog failures. */
  async models(): Promise<ModelCatalog> {
    this.signal().throwIfAborted()
    return this.ctx.sessionController.modelCatalog()
  }

  permissions() { return this.ctx.permissionPresets.catalog() }

  private async validatedSelection(selection: ModelSelection, signal: AbortSignal): Promise<AgentModelSelection> {
    const selected: AgentModelSelection = {
      provider: nonempty(selection.provider, 'provider'), model: nonempty(selection.model, 'model'),
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(nonempty(selection.reasoningEffort, 'reasoningEffort')) }),
    }
    await this.ctx.llm.resolveCallConfig(selected, signal)
    signal.throwIfAborted()
    // resolveCallConfig materializes defaults. Omission must remain omission in the durable choice.
    return selected
  }

  async create(input: CreateSpiritSession = {}) {
    input = { ...input, ...(input.model ? { model: { ...input.model } } : {}) }
    const signal = this.signal(input.signal)
    if (input.sessionId !== undefined) nonempty(input.sessionId, 'sessionId')
    if (input.cwd !== undefined && !isAbsolute(input.cwd)) throw new Error('cwd must be absolute')
    if (input.cwd !== undefined && input.workspaceId !== undefined) throw new Error('cwd and workspaceId are mutually exclusive')
    if (input.workspaceId !== undefined) nonempty(input.workspaceId, 'workspaceId')
    if (input.agentPreset !== undefined) nonempty(input.agentPreset, 'agentPreset')
    if (input.title !== undefined) nonempty(input.title, 'title')
    const details: BridgeOperationDetails = { sessionId: input.sessionId, cwd: input.cwd, workspaceId: input.workspaceId,
      title: input.title, agentPreset: input.agentPreset, permissionPreset: input.permissionPreset, selection: input.model }
    await this.authorize('session.create', details, signal)
    // Preflight invalid choices before creating a visible, empty session.
    const selected = input.model ? await this.validatedSelection(input.model, signal) : undefined
    if (input.permissionPreset !== undefined) this.ctx.permissionPresets.resolve(input.permissionPreset)
    await this.authorize('session.create', details, signal)
    const created = await this.ctx.sessionController.create({
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId as SessionId }),
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId as WorkspaceId }),
      ...(input.agentPreset === undefined ? {} : { agentPreset: input.agentPreset }),
    })
    const agent = await this.resolve(created.sessionId, signal)
    const committedDetails = { ...details, sessionId: created.sessionId }
    if (input.permissionPreset !== undefined) {
      await this.authorize('session.permission', committedDetails, signal)
      this.assertLive(agent)
      this.ctx.permissionPresets.set(agent.session, input.permissionPreset)
    }
    if (selected) {
      await this.authorize('session.model', { ...committedDetails, selection: selected }, signal)
      this.assertLive(agent)
      agent.model.select(selected)
    }
    if (input.title !== undefined) {
      await this.authorize('session.create', committedDetails, signal)
      this.assertLive(agent)
      await this.ctx.sessionController.rename({ sessionId: created.sessionId, title: input.title })
    }
    const workspace = input.privateMain ? undefined : await this.ensureWorkspace(created.sessionId, { title: input.title, signal })
    await this.ctx.sessionPersistence.flush()
    return { ...created, ...(workspace ? { workspaceId: workspace.workspaceId } : {}), ...(selected ? { model: selected } : {}), permissionPreset: this.ctx.permissionPresets.current(agent.session) }
  }

  /**
   * A native cwd alone does not make an ordinary blank Session usable in the
   * rc.5 web composer. Register its actual directory and durable membership;
   * preserve existing Workspace identity and title rather than inventing a
   * parallel directory or rewriting the Session header.
   */
  async ensureWorkspace(sessionId: string, options: { title?: string; signal?: AbortSignal } = {}) {
    const signal = this.signal(options.signal)
    nonempty(sessionId, 'sessionId')
    await this.authorize('session.workspace', { sessionId, title: options.title }, signal)
    const agent = await this.resolve(sessionId, signal), cwd = agent.session.header.cwd
    if (!cwd || !isAbsolute(cwd)) throw new Error('Session has no absolute workspace directory')
    const details = { sessionId, cwd, title: options.title }
    let workspace = await this.ctx.workspaceRegistry.resolveByPath(cwd)
    await this.authorize('session.workspace', details, signal)
    this.assertLive(agent)
    if (!workspace) workspace = await this.ctx.workspaceRegistry.create(cwd, options.title)
    await this.authorize('session.workspace', { ...details, workspaceId: workspace.id }, signal)
    this.assertLive(agent)
    await workspace.attachSession(agent.id)
    return { sessionId, workspaceId: workspace.id, path: workspace.path, title: workspace.title }
  }

  async selectModel(sessionId: string, selection: ModelSelection, callerSignal?: AbortSignal): Promise<ModelSelection> {
    selection = { ...selection }
    const signal = this.signal(callerSignal)
    nonempty(sessionId, 'sessionId')
    const details = { sessionId, selection: { ...selection } }
    await this.authorize('session.model', details, signal)
    return this.serial(sessionId, async () => {
      const selected = await this.validatedSelection(selection, signal)
      const agent = await this.resolve(sessionId, signal)
      await this.authorize('session.model', { sessionId, selection: selected }, signal)
      this.assertLive(agent)
      agent.model.select(selected)
      await this.ctx.sessionPersistence.flush()
      return { ...selected }
    })
  }

  /** Intended for owner controls; availability and approval semantics remain owned by Harness. */
  async setPermission(sessionId: string, preset: string, callerSignal?: AbortSignal): Promise<{ current: string }> {
    const signal = this.signal(callerSignal)
    nonempty(sessionId, 'sessionId'); nonempty(preset, 'permissionPreset')
    const details = { sessionId, permissionPreset: preset }
    await this.authorize('session.permission', details, signal)
    this.ctx.permissionPresets.resolve(preset)
    return this.serial(sessionId, async () => {
      const agent = await this.resolve(sessionId, signal)
      await this.authorize('session.permission', details, signal)
      this.assertLive(agent)
      this.ctx.permissionPresets.set(agent.session, preset)
      await this.ctx.sessionPersistence.flush()
      return { current: this.ctx.permissionPresets.current(agent.session) }
    })
  }

  private async history(agent: Agent, signal: AbortSignal): Promise<DeliveryHistory> {
    let history = this.histories.get(agent)
    if (!history) { history = { offset: 0, fingerprints: new Map() }; this.histories.set(agent, history) }
    await this.ctx.sessionPersistence.flush()
    signal.throwIfAborted()
    await using handle = await this.ctx.sessionPersistence.open(agent.id, 'read', { signal })
    for (;;) {
      signal.throwIfAborted()
      const { events } = await handle.read(history.offset, 512, { signal })
      if (!events.length) break
      for (const event of events) for (const message of postedMessages(event)) {
        if (message.source.kind === 'spirit' && message.source.targetSessionId === agent.id) {
          // The original admission remains authoritative if another component later edits the queue.
          if (!history.fingerprints.has(message.id)) history.fingerprints.set(message.id, fingerprint(message))
        }
      }
      history.offset += events.length
    }
    return history
  }

  async post(input: SpiritPost): Promise<SpiritPostReceipt> {
    input = { ...input }
    const signal = this.signal(input.signal)
    nonempty(input.sessionId, 'sessionId'); nonempty(input.requestId, 'requestId'); nonempty(input.text, 'text')
    if (input.fromSessionId !== undefined) nonempty(input.fromSessionId, 'fromSessionId')
    const mode = input.mode ?? 'queue'
    if (!['queue', 'steer', 'context'].includes(mode)) throw new Error('Unknown Spirit delivery mode')
    const details = { sessionId: input.sessionId, requestId: input.requestId, text: input.text, fromSessionId: input.fromSessionId, mode }
    await this.authorize('session.post', details, signal)
    return this.serial(input.sessionId, async () => {
      const agent = await this.resolve(input.sessionId, signal)
      const history = await this.history(agent, signal)
      const id = spiritMessageId(input.sessionId, input.requestId)
      const message: UserMessage = freezeMessage({ id, role: 'user', content: [{ type: 'text',
        text: `【精神（Spirit）发送；来源：${input.fromSessionId === undefined ? '精神后台' : `会话 ${JSON.stringify(input.fromSessionId)}`}】\n\n${input.text}`,
      }], source: {
        kind: 'spirit', requestId: input.requestId, targetSessionId: input.sessionId,
        ...(input.fromSessionId === undefined ? {} : { fromSessionId: input.fromSessionId }), delivery: mode,
        ...(mode === 'context' ? { form: 'notice', summary: boundContextSummary(input.summary ?? '精神提供的上下文') } : { form: 'relay' }),
      } })
      const expected = fingerprint(message)
      const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].find(item => item.id === id)
      const previous = history.fingerprints.get(id) ?? (pending ? fingerprint(pending) : undefined)
      if (previous !== undefined && previous !== expected) throw new Error(`Spirit requestId ${input.requestId} was already admitted with different content or delivery options`)
      await this.authorize('session.post', details, signal)
      signal.throwIfAborted()
      this.assertLive(agent)
      const duplicate = previous !== undefined
      if (!duplicate) {
        input.beforeEnqueue?.(agent)
        if (mode === 'context') agent.inject(message)
        else if (mode === 'steer') agent.steer(message)
        else agent.followup(message)
        history.fingerprints.set(id, expected)
      }
      await this.ctx.sessionPersistence.flush()
      return { accepted: true, sessionId: input.sessionId, messageId: id, mode, duplicate }
    })
  }

  /** Does not activate a cold session. keepInbox defaults false so canceled input cannot wake it later. */
  async stop(sessionId: string, options: { keepInbox?: boolean; wait?: boolean; cause?: AgentCancelCause; signal?: AbortSignal } = {}) {
    options = { ...options, ...(options.cause ? { cause: { ...options.cause } } : {}) }
    const signal = this.signal(options.signal)
    nonempty(sessionId, 'sessionId')
    const keepInbox = options.keepInbox ?? false
    await this.authorize('session.stop', { sessionId, keepInbox }, signal)
    const agent = this.ctx.agents.get(sessionId as SessionId)
    if (!agent) return { accepted: true as const, active: false, clearedInbox: false }
    agent.cancel(options.cause ?? { kind: 'hook', reason: 'Spirit stop request' }, { keepInbox })
    // A self-stop tool must use wait:false; awaiting its own driver would deadlock.
    if (options.wait !== false) await agent.whenIdle()
    await this.ctx.sessionPersistence.flush()
    return { accepted: true as const, active: true, clearedInbox: !keepInbox }
  }
}
