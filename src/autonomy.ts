/** Durable opportunities for model deliberation. A clock can offer a turn; it cannot decide what to do. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store } from '../upstream/src/app/store.ts'
import { TurnReferenceInput, type TurnReference } from './continuity.ts'

const id = z.string().trim().min(1).max(300)
const text = z.string().trim().min(1).max(8000)
const date = z.iso.datetime({ offset: true })
const revision = z.number().int().nonnegative()
export const ProvenanceInput = z.object({ kind: z.enum(['user', 'system', 'self']), reference: id, turn: TurnReferenceInput.optional() }).strict()
export const RevisitInput = z.object({
  at: date.optional().describe('一次性再考虑时点；同时指定事件条件时，任一先发生都会提供机会'),
  condition: z.object({ description: text, eventKind: id.optional(), affairId: id.optional(),
    sourceKind: ProvenanceInput.shape.kind.optional() }).strict().optional().describe('匹配的事件只是候选条件；是否真正成立仍须模型判断'),
  expiresAt: date.optional(),
}).strict().refine(value => value.at || value.condition, '再考虑需要一个具体时点或可观察的事件条件')
export const ObservationInput = z.object({
  id, sessionId: id, kind: id, summary: text, source: ProvenanceInput,
  affairId: id.optional(), revision: revision.optional(), causedBy: id.optional(), expiresAt: date.optional(),
}).strict().refine(value => value.revision === undefined || value.affairId, '事情版本需要 affairId')
export const IntentInput = z.object({
  id: id.optional(), expectedRevision: revision.optional(), sessionId: id,
  statement: text, reason: text, source: ProvenanceInput,
  state: z.enum(['open', 'waiting', 'done', 'cancelled']).default('open'),
  affairId: id.optional(), affairRevision: revision.optional(),
  eventIds: z.array(id).max(64).default([]), revisit: RevisitInput.optional(),
}).strict().refine(value => value.affairRevision === undefined || value.affairId, '事情版本需要 affairId')
export const DecisionInput = z.object({
  opportunityId: id, dispatchId: id,
  decision: z.enum(['act', 'defer', 'inquire', 'learn', 'refrain']), reason: text,
  intentId: id.optional(), intentRevision: revision.optional(),
  intentState: z.enum(['open', 'waiting', 'done', 'cancelled']).optional(), revisit: RevisitInput.optional(),
}).strict().refine(value => value.intentId || value.intentRevision === undefined && value.intentState === undefined && !value.revisit,
  '改变意向或安排再考虑时必须指定 intentId')

export type Provenance = z.infer<typeof ProvenanceInput>
export type RevisitPlan = z.infer<typeof RevisitInput>
export interface Observation extends z.infer<typeof ObservationInput> {
  at: string; disposition: 'queued' | 'echo' | 'stopped' | 'expired' | 'stale'; reason: string; opportunityId?: string
}
export interface Intent {
  id: string; revision: number; sessionId: string; statement: string; reason: string;
  /** Who initiated it remains distinct from who most recently changed it. */
  source: Provenance; updatedBy: Provenance; state: 'open' | 'waiting' | 'done' | 'cancelled';
  affairId?: string; affairRevision?: number; eventIds: string[]; createdAt: string; updatedAt: string
}
export interface Revisit extends RevisitPlan {
  id: string; intentId: string; intentRevision: number; sessionId: string; reason: string; source: Provenance;
  state: 'waiting' | 'fired' | 'stale' | 'expired' | 'cancelled'; createdAt: string;
  opportunityId?: string; matchedEventId?: string; settledAt?: string; resolution?: string
}
export type OpportunityState = 'pending' | 'retry' | 'dispatching' | 'awaiting_decision' | 'settled' | 'stale' | 'expired' | 'cancelled'
export interface Opportunity {
  id: string; sessionId: string; state: OpportunityState; reason: string;
  eventIds: string[]; eventCount: number; revisitIds: string[]; revisitCount: number;
  createdAt: string; updatedAt: string; availableAt: string; expiresAt: string;
  openGrant?: number; attempts: number; dispatchId?: string; dispatchedAt?: string; receiptAt?: string; settledAt?: string;
  endedWithoutDecision?: { turn: number; endSeq: number };
  lastError?: string; lastFailureAt?: string; resolution?: string; claimId?: string; leaseUntil?: string
}
export interface Decision extends z.infer<typeof DecisionInput> { id: string; at: string; turn?: TurnReference }
interface AutonomyRecords { opportunities: Opportunity; revisits: Revisit; decisions: Decision }
export interface AutonomyControl { mode: 'active' | 'paused' | 'stopped'; reason: string; revision: number; updatedAt: string }
export interface DeliberationPacket {
  opportunity: Opportunity; dispatchId: string; events: Observation[]; revisits: Revisit[]; intents: Intent[];
  eventCount: number; revisitCount: number; intentCount: number; instruction: string
}
export interface AutonomyTransport {
  /** Resolve when the message is accepted, not when thinking is done. Honor signal and deduplicate dispatchId. */
  deliberate(packet: DeliberationPacket, signal: AbortSignal): Promise<void>
}
export interface AutonomyOptions {
  now?: () => number; concurrency?: number; contextLimit?: number;
  openActivity?: { sessionId: string; intervalMs: number; grant: () => number | undefined; willing: () => boolean; idle: () => boolean }
  opportunityLifetimeMs?: number; dispatchLeaseMs?: number; retryMs?: readonly [number, number]; minimumRevisitDelayMs?: number
}
const terminalIntent = (value: Intent) => value.state === 'done' || value.state === 'cancelled'
const activeOpportunity = (value: Opportunity) => value.state === 'dispatching' || value.state === 'awaiting_decision'
const openOpportunity = (value: Opportunity) => value.openGrant !== undefined && !value.eventCount && !value.revisitCount
const stamp = (value: number) => new Date(value).toISOString()
const parse = <T>(row: Record<string, unknown> | undefined): T | undefined => row && JSON.parse(String(row.value)) as T
const excerpt = (value: string, limit: number) => value.length <= limit ? value : `${value.slice(0, limit)}…［截短，可读取原记录］`
const recordTables = { opportunities: 'spirit_autonomy_opportunity', revisits: 'spirit_autonomy_revisit', decisions: 'spirit_autonomy_decision' } as const
const currentIntentFilter = `i.state IN ('open','waiting') AND NOT EXISTS (
  SELECT 1 FROM spirit_autonomy_affair AS a WHERE a.session_id=i.session_id AND a.id=json_extract(i.value,'$.affairId')
  AND a.revision>json_extract(i.value,'$.affairRevision'))`

/**
 * Own tables share Store's transaction boundary. There is no reflection interval and no automatic learning.
 * The host calls tick after setup and on its ordinary scheduler. All deadlines merely create opportunities.
 */
export class Autonomy {
  private readonly now: () => number
  private readonly concurrency: number
  private readonly contextLimit: number
  private readonly lifetime: number
  private readonly lease: number
  private readonly retryMs: readonly [number, number]
  private readonly minimumRevisitDelay: number
  private readonly running = new Map<string, { controller: AbortController; done: Promise<void> }>()
  private closed = false
  private runtimeError?: string

  constructor(readonly store: Store, private readonly transport: AutonomyTransport, private readonly options: AutonomyOptions = {}) {
    this.now = options.now ?? Date.now
    this.concurrency = options.concurrency ?? 1
    this.contextLimit = options.contextLimit ?? 16
    this.lifetime = options.opportunityLifetimeMs ?? 86_400_000
    this.lease = options.dispatchLeaseMs ?? 60_000
    this.retryMs = options.retryMs ?? [2000, 60_000]
    this.minimumRevisitDelay = options.minimumRevisitDelayMs ?? 1000
    for (const [name, value] of Object.entries({ concurrency: this.concurrency, contextLimit: this.contextLimit,
      opportunityLifetimeMs: this.lifetime, dispatchLeaseMs: this.lease, retryInitial: this.retryMs[0],
      retryMaximum: this.retryMs[1], minimumRevisitDelayMs: this.minimumRevisitDelay })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid autonomy option: ${name}`)
    }
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS spirit_autonomy_control (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_autonomy_event (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, opportunity_id TEXT, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS spirit_autonomy_event_opportunity ON spirit_autonomy_event(opportunity_id);
      CREATE INDEX IF NOT EXISTS spirit_autonomy_event_session ON spirit_autonomy_event(session_id);
      CREATE TABLE IF NOT EXISTS spirit_autonomy_affair (session_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(session_id,id));
      CREATE TABLE IF NOT EXISTS spirit_autonomy_intent (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, state TEXT NOT NULL, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS spirit_autonomy_intent_session ON spirit_autonomy_intent(session_id,state);
      CREATE TABLE IF NOT EXISTS spirit_autonomy_intent_history (id TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS spirit_autonomy_revisit (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_id TEXT NOT NULL,
        state TEXT NOT NULL, due INTEGER, opportunity_id TEXT, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS spirit_autonomy_revisit_due ON spirit_autonomy_revisit(state,due);
      CREATE INDEX IF NOT EXISTS spirit_autonomy_revisit_intent ON spirit_autonomy_revisit(intent_id,state);
      CREATE TABLE IF NOT EXISTS spirit_autonomy_opportunity (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, state TEXT NOT NULL,
        due INTEGER NOT NULL, dispatch_id TEXT, value TEXT NOT NULL, request TEXT);
      CREATE INDEX IF NOT EXISTS spirit_autonomy_opportunity_due ON spirit_autonomy_opportunity(state,due);
      CREATE UNIQUE INDEX IF NOT EXISTS spirit_autonomy_pending_session ON spirit_autonomy_opportunity(session_id) WHERE state='pending';
      CREATE UNIQUE INDEX IF NOT EXISTS spirit_autonomy_active_session ON spirit_autonomy_opportunity(session_id) WHERE state IN ('dispatching','awaiting_decision');
      CREATE UNIQUE INDEX IF NOT EXISTS spirit_autonomy_dispatch_id ON spirit_autonomy_opportunity(dispatch_id) WHERE dispatch_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS spirit_open_clock (session_id TEXT PRIMARY KEY, grant INTEGER NOT NULL, due INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_autonomy_dispatch (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_autonomy_decision (opportunity_id TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    const initial: AutonomyControl = { mode: 'active', reason: '可以提出思考机会；具体行动由模型依据实际事情判断', revision: 0, updatedAt: stamp(this.now()) }
    store.db.prepare('INSERT OR IGNORE INTO spirit_autonomy_control VALUES (1,?)').run(JSON.stringify(initial))
  }

  getControl(): AutonomyControl {
    return parse<AutonomyControl>(this.store.db.prepare('SELECT value FROM spirit_autonomy_control WHERE id=1').get())!
  }
  get error(): string | undefined { return this.runtimeError }
  getOpportunity(opportunityId: string): Opportunity {
    const value = parse<Opportunity>(this.store.db.prepare('SELECT value FROM spirit_autonomy_opportunity WHERE id=?').get(opportunityId))
    if (!value) throw new Error('思考机会不存在')
    return value
  }
  getIntent(intentId: string): Intent {
    const value = parse<Intent>(this.store.db.prepare('SELECT value FROM spirit_autonomy_intent WHERE id=?').get(intentId))
    if (!value) throw new Error('意向不存在')
    return value
  }
  intents(sessionId?: string): Intent[] {
    const rows = sessionId === undefined ? this.store.db.prepare('SELECT value FROM spirit_autonomy_intent ORDER BY rowid DESC').all()
      : this.store.db.prepare('SELECT value FROM spirit_autonomy_intent WHERE session_id=? ORDER BY rowid DESC').all(sessionId)
    return rows.map(row => parse<Intent>(row)!)
  }
  intentPage({ sessionId, affairId, activeOnly = false, limit = 32, offset = 0 }: {
    sessionId?: string; affairId?: string; activeOnly?: boolean; limit?: number; offset?: number
  } = {}) {
    const selection = `FROM spirit_autonomy_intent AS i WHERE (? IS NULL OR i.session_id=?) AND (? IS NULL OR json_extract(i.value,'$.affairId')=?)
      ${activeOnly ? `AND ${currentIntentFilter}` : ''}`
    const args = [sessionId ?? null, sessionId ?? null, affairId ?? null, affairId ?? null]
    const total = Number(this.store.db.prepare(`SELECT COUNT(*) AS count ${selection}`).get(...args)?.count)
    const items = this.store.db.prepare(`SELECT i.value ${selection} ORDER BY i.rowid DESC LIMIT ? OFFSET ?`)
      .all(...args, Math.min(100, Math.max(1, Math.trunc(limit))), Math.max(0, Math.trunc(offset))).map(row => parse<Intent>(row)!)
    return { items, total }
  }
  /** A bounded view of current work across sessions, including legacy intents. */
  workingIntents(limit: number, { sessionId, affairId }: { sessionId?: string; affairId?: string } = {}) {
    const current = `FROM spirit_autonomy_intent AS i WHERE ${currentIntentFilter}`
    const total = Number(this.store.db.prepare(`SELECT COUNT(*) AS count ${current}`).get()?.count)
    const rows = this.store.db.prepare(`SELECT i.value ${current} ORDER BY CASE
      WHEN EXISTS (SELECT 1 FROM spirit_autonomy_revisit AS r JOIN spirit_autonomy_opportunity AS o ON o.id=r.opportunity_id
        WHERE r.intent_id=i.id AND r.state='fired' AND o.session_id=? AND o.state IN ('dispatching','awaiting_decision')) THEN 0
      WHEN json_extract(i.value,'$.affairId')=? THEN 1 WHEN i.session_id=? THEN 2 ELSE 3 END,
      json_extract(i.value,'$.updatedAt') DESC, i.rowid DESC LIMIT ?`)
      .all(sessionId ?? null, affairId ?? null, sessionId ?? null, Math.min(100, Math.max(1, Math.trunc(limit))))
    const items = rows.map(row => {
      const { id, revision, state, statement, source, updatedBy, sessionId, affairId } = parse<Intent>(row)!
      return { id, revision, state, statement: excerpt(statement, 220), source, updatedBy, sessionId, affairId }
    })
    return { items, total }
  }
  isCurrentIntent(id: string, revision: number): boolean {
    const value = parse<Intent>(this.store.db.prepare('SELECT value FROM spirit_autonomy_intent WHERE id=?').get(id))
    return !!value && value.revision === revision && this.validIntent(value)
  }
  /** Verify the native source's exact dispatch version before using its opportunity. */
  assertDispatchCurrent(sessionId: string, dispatchId: string, nativeAdmission = false): void {
    const value = this.currentDispatch(sessionId, dispatchId)
    if (nativeAdmission && value.state === 'settled') throw new Error('这个思考机会已经处理')
    if (nativeAdmission && openOpportunity(value) && !this.currentOpenActivity(value)?.willing()) {
      const reason = '当前活动选择已安静；不再开始开放机会'
      this.store.atomic(() => {
        const current = this.getOpportunity(value.id)
        if (activeOpportunity(current) && current.dispatchId === dispatchId) {
          current.state = 'cancelled'; current.resolution = reason; current.settledAt = stamp(this.now())
          this.releaseDispatch(current)
        }
      })
      throw new Error(reason)
    }
  }
  /** Recheck transient eligibility immediately before admitting a new native message. */
  assertReadyToDeliver(sessionId: string, dispatchId: string, signal: AbortSignal): void {
    signal.throwIfAborted()
    const value = this.currentDispatch(sessionId, dispatchId)
    if (value.state !== 'dispatching' || this.running.get(value.claimId!)?.controller.signal !== signal || Date.parse(value.leaseUntil!) <= this.now()) {
      throw new Error('这个发送已经处理、超时或由另一请求领取')
    }
    if (openOpportunity(value)) {
      const open = this.currentOpenActivity(value)
      if (!open?.willing() || !open.idle() || this.hasConcreteOpportunity(value)) throw new Error('现在不适合空闲开放机会')
    }
  }
  private currentDispatch(sessionId: string, dispatchId: string): Opportunity {
    this.assertActive()
    const value = this.findDispatch(sessionId, dispatchId)
    if (!value || (!activeOpportunity(value) && value.state !== 'settled') || value.endedWithoutDecision || Date.parse(value.expiresAt) <= this.now()) {
      throw new Error('这个机会或发送版本已失效；先读取当前状态')
    }
    if (!this.hasCurrentContext(value)) throw new Error('这个机会的授权或所依据的观察、意向版本已过时')
    return value
  }
  private findDispatch(sessionId: string, dispatchId: string): Opportunity | undefined {
    return parse<Opportunity>(this.store.db.prepare('SELECT value FROM spirit_autonomy_opportunity WHERE session_id=? AND dispatch_id=?').get(sessionId, dispatchId))
  }
  /** Called only for a normally completed native turn that actually received this open dispatch. */
  recordOpenTurnEnd(sessionId: string, dispatchId: string, turn: number, endSeq: number): void {
    if (this.closed || this.getControl().mode !== 'active') return
    this.store.atomic(() => {
      const value = this.findDispatch(sessionId, dispatchId)
      if (!value || (!activeOpportunity(value) && value.state !== 'retry') || !this.currentOpenActivity(value) || Date.parse(value.expiresAt) <= this.now()) return
      const at = stamp(this.now())
      value.state = 'settled'; value.updatedAt = at; value.settledAt = at; value.receiptAt ??= at
      value.endedWithoutDecision = { turn, endSeq }
      value.resolution = '这次开放回合正常结束，未登记判断。'
      // An actual completed native turn proves receipt even while the post is flushing.
      delete value.claimId; delete value.leaseUntil
      this.saveOpportunity(value)
      this.deferNextOpen(value)
    })
  }
  awaiting(sessionId: string) {
    const x = parse<Opportunity>(this.store.db.prepare("SELECT value FROM spirit_autonomy_opportunity WHERE session_id=? AND state IN ('dispatching','awaiting_decision')").get(sessionId))
    return x && { opportunityId: x.id, dispatchId: x.dispatchId, reason: excerpt(x.reason, 320) }
  }
  intentHistory(intentId: string): Intent[] {
    return this.store.db.prepare('SELECT value FROM spirit_autonomy_intent_history WHERE id=? ORDER BY revision').all(intentId).map(row => parse<Intent>(row)!)
  }
  intentHistoryPage(intentId: string, offset = 0, limit = 32) {
    const total = Number(this.store.db.prepare('SELECT COUNT(*) AS count FROM spirit_autonomy_intent_history WHERE id=?').get(intentId)?.count)
    const items = this.store.db.prepare('SELECT value FROM spirit_autonomy_intent_history WHERE id=? ORDER BY revision LIMIT ? OFFSET ?')
      .all(intentId, Math.min(100, Math.max(1, Math.trunc(limit))), Math.max(0, Math.trunc(offset))).map(row => parse<Intent>(row)!)
    return { items, total }
  }
  recordsPage<K extends keyof AutonomyRecords>(kind: K, offset = 0, limit = 32) {
    const table = recordTables[kind]
    const total = Number(this.store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count)
    const items = this.store.db.prepare(`SELECT value FROM ${table} ORDER BY rowid DESC LIMIT ? OFFSET ?`)
      .all(Math.min(100, Math.max(1, Math.trunc(limit))), Math.max(0, Math.trunc(offset))).map(row => parse<AutonomyRecords[K]>(row)!)
    return { items, total }
  }
  revisits(sessionId?: string): Revisit[] {
    const rows = sessionId === undefined ? this.store.db.prepare('SELECT value FROM spirit_autonomy_revisit ORDER BY rowid DESC').all()
      : this.store.db.prepare('SELECT value FROM spirit_autonomy_revisit WHERE session_id=? ORDER BY rowid DESC').all(sessionId)
    return rows.map(row => parse<Revisit>(row)!)
  }
  /** Pagination keeps a large coalesced observation burst addressable without putting it all in a model turn. */
  events(input: { opportunityId?: string; sessionId?: string; offset?: number; limit?: number } = {}): Observation[] {
    const offset = Math.max(0, Math.trunc(input.offset ?? 0)), limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 32)))
    const rows = this.store.db.prepare(`SELECT value FROM spirit_autonomy_event
      WHERE (? IS NULL OR opportunity_id=?) AND (? IS NULL OR session_id=?) ORDER BY rowid DESC LIMIT ? OFFSET ?`)
      .all(input.opportunityId ?? null, input.opportunityId ?? null, input.sessionId ?? null, input.sessionId ?? null, limit, offset)
    return rows.map(row => parse<Observation>(row)!)
  }
  snapshot() {
    return { control: this.getControl(), intents: this.intents(), revisits: this.revisits(),
      opportunities: this.store.db.prepare('SELECT value FROM spirit_autonomy_opportunity ORDER BY rowid DESC').all().map(row => parse<Opportunity>(row)!),
      decisions: this.store.db.prepare('SELECT value FROM spirit_autonomy_decision ORDER BY rowid DESC').all().map(row => parse<Decision>(row)!),
      ...(this.runtimeError ? { error: this.runtimeError } : {}) }
  }

  observe(input: unknown): Observation {
    this.assertOpen()
    const value = ObservationInput.parse(input)
    return this.store.atomic(() => {
      const prior = parse<Observation>(this.store.db.prepare('SELECT value FROM spirit_autonomy_event WHERE id=?').get(value.id))
      if (prior) {
        for (const field of Object.keys(value) as (keyof typeof value)[]) {
          if (JSON.stringify(prior[field]) !== JSON.stringify(value[field])) throw new Error('同一事件 id 不能代表不同的观察')
        }
        return prior
      }
      const at = stamp(this.now())
      const ownDispatch = this.store.db.prepare('SELECT 1 FROM spirit_autonomy_dispatch WHERE id IN (?,?,?) LIMIT 1')
        .get(value.id, value.causedBy ?? '', value.source.reference)
      const stale = value.revision !== undefined && this.affairRevision(value.sessionId, value.affairId!) > value.revision
      const disposition: Observation['disposition'] = value.source.kind === 'self' || ownDispatch ? 'echo'
        : this.getControl().mode === 'stopped' ? 'stopped'
        : value.expiresAt && Date.parse(value.expiresAt) <= this.now() ? 'expired' : stale ? 'stale' : 'queued'
      const reasons = { echo: '自身消息留作记录；回声不再次唤醒模型', stopped: '本人已停止自主活动，事件不会在恢复时自动重放',
        expired: '事件已经过期', stale: '已有更新的事情版本', queued: '发生了值得模型判断的实际变化；这并不规定采取行动' }
      const event: Observation = { ...value, expiresAt: value.expiresAt ?? stamp(this.now() + this.lifetime), at,
        disposition, reason: reasons[disposition] }
      if (disposition === 'queued') {
        if (value.revision !== undefined) this.store.db.prepare(`INSERT INTO spirit_autonomy_affair VALUES (?,?,?)
          ON CONFLICT(session_id,id) DO UPDATE SET revision=MAX(revision,excluded.revision)`).run(value.sessionId, value.affairId!, value.revision)
        const opportunity = this.offer(value.sessionId, { eventId: value.id, reason: `观察：${value.kind}；${value.summary}`, expiresAt: event.expiresAt! })
        event.opportunityId = opportunity.id
      }
      this.store.db.prepare('INSERT INTO spirit_autonomy_event VALUES (?,?,?,?)')
        .run(event.id, event.sessionId, event.opportunityId ?? null, JSON.stringify(event))
      if (disposition === 'queued') {
        for (const revisit of this.waitingRevisits(value.sessionId)) {
          const condition = revisit.condition
          if (!condition || condition.eventKind && condition.eventKind !== value.kind || condition.affairId && condition.affairId !== value.affairId
            || condition.sourceKind && condition.sourceKind !== value.source.kind) continue
          if (this.validRevisit(revisit)) this.fire(revisit, event.id)
        }
      }
      return event
    })
  }

  recordIntent(input: unknown): Intent {
    this.assertActive()
    const value = IntentInput.parse(input)
    return this.store.atomic(() => {
      const existing = value.id ? parse<Intent>(this.store.db.prepare('SELECT value FROM spirit_autonomy_intent WHERE id=?').get(value.id)) : undefined
      if (existing && (existing.sessionId !== value.sessionId || existing.revision !== value.expectedRevision)) throw new Error('意向已改变；先读取当前版本')
      if (!existing && value.expectedRevision !== undefined) throw new Error('没有可修订的意向')
      if (existing?.state === 'cancelled') throw new Error('已经取消的意向不会复活；需要明确的新意向')
      if (value.affairRevision !== undefined && this.affairRevision(value.sessionId, value.affairId!) > value.affairRevision) throw new Error('事情版本已过时')
      for (const eventId of value.eventIds) {
        const event = parse<Observation>(this.store.db.prepare('SELECT value FROM spirit_autonomy_event WHERE id=?').get(eventId))
        if (!event || event.sessionId !== value.sessionId) throw new Error('意向只能引用本会话中已有的观察')
      }
      const at = stamp(this.now()), intent: Intent = { id: existing?.id ?? value.id ?? randomUUID(), revision: (existing?.revision ?? 0) + 1,
        sessionId: value.sessionId, statement: value.statement, reason: value.reason, source: existing ? existing.source : value.source,
        updatedBy: value.source, state: value.state, affairId: value.affairId, affairRevision: value.affairRevision,
        eventIds: [...new Set(value.eventIds)], createdAt: existing ? existing.createdAt : at, updatedAt: at }
      this.saveIntent(intent)
      this.invalidateRevisits(intent, '意向已有新的版本')
      if (value.revisit) this.schedule(intent, value.revisit, value.source)
      return intent
    })
  }

  /** Only this explicit model acknowledgement settles a delivered opportunity. It does not imply an affair is done. */
  decide(input: unknown, turn?: TurnReference): Decision {
    this.assertActive()
    const value = DecisionInput.parse(input)
    const source = turn && TurnReferenceInput.parse(turn)
    return this.store.atomic(() => {
      const opportunity = this.getOpportunity(value.opportunityId)
      if (source && source.sessionId !== opportunity.sessionId) throw new Error('判断来源必须来自这个机会所交付的会话')
      const prior = parse<Decision>(this.store.db.prepare('SELECT value FROM spirit_autonomy_decision WHERE opportunity_id=?').get(value.opportunityId))
      if (prior) {
        const { id: _id, at: _at, turn: _turn, ...previous } = prior
        if (JSON.stringify(previous) !== JSON.stringify(value)) throw new Error('这个思考机会已经由另一项判断处理')
        return prior
      }
      if (!activeOpportunity(opportunity) || opportunity.dispatchId !== value.dispatchId || Date.parse(opportunity.expiresAt) <= this.now()) {
        throw new Error('这个机会或发送版本已失效；先读取当前状态')
      }
      if (!this.hasCurrentContext(opportunity)) throw new Error('这个机会的授权或所依据的观察、意向版本已过时')
      if (value.intentId) {
        const intent = this.getIntent(value.intentId)
        if (intent.sessionId !== opportunity.sessionId || intent.revision !== value.intentRevision || terminalIntent(intent)) throw new Error('意向已改变或结束；先读取当前版本')
        if (intent.affairRevision !== undefined && this.affairRevision(intent.sessionId, intent.affairId!) > intent.affairRevision) throw new Error('意向所依据的事情版本已过时')
        if (value.intentState || value.revisit) {
          intent.revision++; intent.state = value.intentState ?? (value.decision === 'defer' ? 'waiting' : intent.state)
          intent.reason = value.reason; intent.updatedAt = stamp(this.now()); intent.updatedBy = { kind: 'self', reference: value.dispatchId, ...(source ? { turn: source } : {}) }
          this.saveIntent(intent); this.invalidateRevisits(intent, '模型改变了意向')
          if (value.revisit) this.schedule(intent, value.revisit, intent.updatedBy)
        }
      }
      const decision: Decision = { ...value, id: randomUUID(), at: stamp(this.now()), ...(source ? { turn: source } : {}) }
      opportunity.state = 'settled'; opportunity.settledAt = decision.at; opportunity.updatedAt = decision.at
      opportunity.resolution = `${value.decision}：${value.reason}`
      delete opportunity.claimId; delete opportunity.leaseUntil
      this.saveOpportunity(opportunity)
      if (openOpportunity(opportunity)) this.deferNextOpen(opportunity)
      this.store.db.prepare('INSERT INTO spirit_autonomy_decision VALUES (?,?)').run(opportunity.id, JSON.stringify(decision))
      return decision
    })
  }

  control(mode: AutonomyControl['mode'], reason: string): AutonomyControl {
    this.assertOpen()
    const nextMode = z.enum(['active', 'paused', 'stopped']).parse(mode), explanation = text.parse(reason)
    return this.store.atomic(() => {
      const control: AutonomyControl = { mode: nextMode, reason: explanation, revision: this.getControl().revision + 1, updatedAt: stamp(this.now()) }
      this.store.db.prepare('UPDATE spirit_autonomy_control SET value=? WHERE id=1').run(JSON.stringify(control))
      if (mode !== 'active') this.store.db.prepare('DELETE FROM spirit_open_clock').run()
      if (mode === 'stopped') {
        for (const intent of this.intents()) if (!terminalIntent(intent)) {
          intent.state = 'cancelled'; intent.revision++; intent.reason = explanation; intent.updatedAt = control.updatedAt
          intent.updatedBy = { kind: 'user', reference: `autonomy-control:${control.revision}` }
          this.saveIntent(intent); this.invalidateRevisits(intent, explanation, 'cancelled')
        }
      }
      for (const opportunity of this.unfinishedOpportunities()) {
        if (mode === 'stopped' || mode === 'paused' && openOpportunity(opportunity)) {
          opportunity.state = 'cancelled'; opportunity.resolution = explanation; opportunity.settledAt = control.updatedAt
        }
        else if (mode === 'paused' && opportunity.state === 'dispatching') { opportunity.state = 'retry'; opportunity.availableAt = control.updatedAt; opportunity.lastError = `已暂停：${explanation}` }
        else continue
        opportunity.updatedAt = control.updatedAt; delete opportunity.claimId; delete opportunity.leaseUntil
        this.saveOpportunity(opportunity)
      }
      if (mode !== 'active') this.store.afterCommit(() => { for (const task of this.running.values()) task.controller.abort(new Error(`自主活动已${mode}`)) })
      return control
    })
  }

  /** Explicit retry of a delivered but unacknowledged turn creates a new dispatch identity; late decisions are rejected. */
  retry(opportunityId: string, reason: string): Opportunity {
    this.assertActive()
    const explanation = text.parse(reason)
    return this.store.atomic(() => {
      const value = this.getOpportunity(opportunityId)
      if (value.state !== 'awaiting_decision' && value.state !== 'retry') throw new Error('只能重试未获模型判断的发送')
      if (Date.parse(value.expiresAt) <= this.now()) throw new Error('机会已过期，需要新的实际观察或意向')
      if (openOpportunity(value) && !this.currentOpenActivity(value)?.willing()) throw new Error('开放机会的授权或活动选择已经改变')
      if (value.state === 'awaiting_decision') {
        delete value.dispatchId; delete value.receiptAt; delete value.dispatchedAt
        this.store.db.prepare('UPDATE spirit_autonomy_opportunity SET request=NULL WHERE id=?').run(value.id)
      }
      value.state = 'retry'; value.availableAt = stamp(this.now()); value.updatedAt = value.availableAt; value.lastError = `明确重试：${explanation}`
      this.saveOpportunity(value); return value
    })
  }

  /** Called after host setup. Timer and event processing only offer context, never execute a predetermined self-improvement step. */
  tick(): void {
    if (this.closed) return
    try {
      this.store.atomic(() => {
        for (const opportunity of this.unfinishedOpportunities()) {
          const open = this.currentOpenActivity(opportunity)
          if (Date.parse(opportunity.expiresAt) <= this.now()) {
            opportunity.state = 'expired'; opportunity.resolution = '机会过期不等于事情完成；等待新的事实或明确的再考虑'; opportunity.settledAt = stamp(this.now())
          } else if (openOpportunity(opportunity) && (!open || !activeOpportunity(opportunity) && !open.willing())) {
            opportunity.state = 'cancelled'; opportunity.resolution = '开放机会的授权或活动选择已经改变'; opportunity.settledAt = stamp(this.now())
          } else if (opportunity.state === 'dispatching' && Date.parse(opportunity.leaseUntil!) <= this.now()) {
            opportunity.state = 'retry'; opportunity.lastError = '发送租约中断或超时；以相同 dispatchId 重试，避免重复消息'
            opportunity.lastFailureAt = stamp(this.now()); opportunity.availableAt = stamp(this.now() + this.backoff(opportunity.attempts))
          } else if (activeOpportunity(opportunity)) {
            if (this.hasCurrentContext(opportunity)) continue
            opportunity.state = 'stale'; opportunity.resolution = '等待期间，原观察或意向版本已经改变'; opportunity.settledAt = stamp(this.now())
          } else continue
          this.releaseDispatch(opportunity)
        }
        for (const revisit of this.waitingRevisits()) {
          if (!this.validRevisit(revisit)) continue
          if (this.getControl().mode !== 'stopped' && revisit.at && Date.parse(revisit.at) <= this.now()) this.fire(revisit)
        }
      })
      if (this.getControl().mode !== 'active') return
      this.considerOpenTurn()
      for (let count = 0; count < this.concurrency; count++) {
        const claimed = this.claim()
        if (!claimed) break
        // A host may tick inside an existing transaction; an uncommitted opportunity must never escape to a session.
        this.store.afterCommit(() => {
          if (this.closed || this.getControl().mode !== 'active') {
            this.finishDispatch(claimed.opportunity.id, claimed.opportunity.claimId!, { error: new Error('发送前自主活动已关闭或暂停') })
          } else this.dispatch(claimed.opportunity, claimed.packet)
        })
      }
      this.runtimeError = undefined
    } catch (error) { this.runtimeError = String(error) }
  }
  async idle(): Promise<void> {
    for (;;) {
      this.tick()
      const running = [...this.running.values()].map(task => task.done)
      if (!running.length) return
      await Promise.allSettled(running)
    }
  }
  /** Close does not alter the owner's persisted control mode, and never closes the host's Store. */
  async close(): Promise<void> {
    this.closed = true
    for (const task of this.running.values()) task.controller.abort(new Error('进程关闭；尚未完成的机会保留供恢复'))
    await Promise.allSettled([...this.running.values()].map(task => task.done))
  }

  private assertOpen(): void { if (this.closed) throw new Error('自主活动组件已经关闭') }
  private assertActive(): void { this.assertOpen(); if (this.getControl().mode !== 'active') throw new Error('自主活动已暂停或停止') }
  private affairRevision(sessionId: string, affairId: string): number {
    return Number(this.store.db.prepare('SELECT revision FROM spirit_autonomy_affair WHERE session_id=? AND id=?').get(sessionId, affairId)?.revision ?? -1)
  }
  private validIntent(value: Intent): boolean {
    return !terminalIntent(value) && (value.affairRevision === undefined || this.affairRevision(value.sessionId, value.affairId!) <= value.affairRevision)
  }
  private saveIntent(value: Intent): void {
    this.store.db.prepare('INSERT INTO spirit_autonomy_intent VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,value=excluded.value')
      .run(value.id, value.sessionId, value.state, JSON.stringify(value))
    this.store.db.prepare('INSERT INTO spirit_autonomy_intent_history VALUES (?,?,?)').run(value.id, value.revision, JSON.stringify(value))
  }
  private saveOpportunity(value: Opportunity): void {
    this.store.db.prepare(`INSERT INTO spirit_autonomy_opportunity (id,session_id,state,due,dispatch_id,value) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,due=excluded.due,dispatch_id=excluded.dispatch_id,value=excluded.value`)
      .run(value.id, value.sessionId, value.state, Date.parse(value.availableAt), value.dispatchId ?? null, JSON.stringify(value))
  }
  private releaseDispatch(value: Opportunity): void {
    const claimId = value.claimId
    value.updatedAt = stamp(this.now()); delete value.claimId; delete value.leaseUntil
    this.saveOpportunity(value)
    if (claimId) this.store.afterCommit(() => this.running.get(claimId)?.controller.abort(new Error(value.resolution ?? value.lastError)))
  }
  private saveRevisit(value: Revisit): void {
    this.store.db.prepare(`INSERT INTO spirit_autonomy_revisit VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,opportunity_id=excluded.opportunity_id,value=excluded.value`)
      .run(value.id, value.sessionId, value.intentId, value.state, value.at ? Date.parse(value.at) : null, value.opportunityId ?? null, JSON.stringify(value))
  }
  private waitingRevisits(sessionId?: string): Revisit[] {
    return this.store.db.prepare("SELECT value FROM spirit_autonomy_revisit WHERE state='waiting' AND (? IS NULL OR session_id=?) ORDER BY rowid")
      .all(sessionId ?? null, sessionId ?? null).map(row => parse<Revisit>(row)!)
  }
  private unfinishedOpportunities(): Opportunity[] {
    return this.store.db.prepare("SELECT value FROM spirit_autonomy_opportunity WHERE state IN ('pending','retry','dispatching','awaiting_decision') ORDER BY rowid")
      .all().map(row => parse<Opportunity>(row)!)
  }
  private invalidateRevisits(intent: Intent, reason: string, state: 'stale' | 'cancelled' = 'stale'): void {
    const values = this.store.db.prepare("SELECT value FROM spirit_autonomy_revisit WHERE intent_id=? AND state IN ('waiting','fired')").all(intent.id)
    for (const row of values) {
      const revisit = parse<Revisit>(row)!
      if (revisit.intentRevision === intent.revision) continue
      revisit.state = state; revisit.settledAt = stamp(this.now()); revisit.resolution = reason; this.saveRevisit(revisit)
    }
  }
  private schedule(intent: Intent, plan: RevisitPlan, source: Provenance): void {
    if (terminalIntent(intent)) throw new Error('已结束的意向不能安排再考虑')
    if (plan.at && Date.parse(plan.at) < this.now() + this.minimumRevisitDelay) throw new Error('再考虑时点必须在未来；不要通过立即唤醒形成回声循环')
    if (plan.expiresAt && (Date.parse(plan.expiresAt) <= this.now() || plan.at && Date.parse(plan.expiresAt) <= Date.parse(plan.at))) throw new Error('再考虑的有效期限必须晚于触发时间')
    this.saveRevisit({ ...plan, id: randomUUID(), sessionId: intent.sessionId, intentId: intent.id, intentRevision: intent.revision,
      state: 'waiting', reason: intent.reason, source, createdAt: stamp(this.now()) })
  }
  private validRevisit(revisit: Revisit): boolean {
    const intent = this.getIntent(revisit.intentId)
    const expired = !!revisit.expiresAt && Date.parse(revisit.expiresAt) <= this.now()
    if (!expired && intent.revision === revisit.intentRevision && this.validIntent(intent)) return true
    revisit.state = expired ? 'expired' : 'stale'; revisit.settledAt = stamp(this.now())
    revisit.resolution = expired ? '再考虑的有效期已过' : '原意向或事情版本已经改变'
    this.saveRevisit(revisit); return false
  }
  private fire(revisit: Revisit, matchedEventId?: string): void {
    const opportunity = this.offer(revisit.sessionId, { revisitId: revisit.id,
      reason: `模型选择再考虑：${revisit.reason}${revisit.condition ? `；待判断条件：${revisit.condition.description}` : ''}`,
      expiresAt: revisit.expiresAt ?? stamp(this.now() + this.lifetime) })
    revisit.state = 'fired'; revisit.opportunityId = opportunity.id; revisit.matchedEventId = matchedEventId; revisit.settledAt = stamp(this.now())
    revisit.resolution = matchedEventId ? '观察到了候选事件；条件是否实际成立仍由模型判断' : '到达模型选择的时点；这只提供思考机会'
    this.saveRevisit(revisit)
  }
  private offer(sessionId: string, input: { eventId?: string; revisitId?: string; openGrant?: number; reason: string; expiresAt: string }): Opportunity {
    const at = stamp(this.now())
    const value = parse<Opportunity>(this.store.db.prepare("SELECT value FROM spirit_autonomy_opportunity WHERE session_id=? AND state='pending'").get(sessionId))
      ?? { id: randomUUID(), sessionId, state: 'pending', reason: input.reason, eventIds: [], eventCount: 0, revisitIds: [], revisitCount: 0,
        createdAt: at, updatedAt: at, availableAt: at, expiresAt: input.expiresAt, attempts: 0, openGrant: input.openGrant } satisfies Opportunity
    if (openOpportunity(value) && (input.eventId || input.revisitId)) {
      delete value.openGrant
      value.reason = input.reason; value.expiresAt = input.expiresAt
    }
    if (input.eventId) { value.eventCount++; value.eventIds = [...value.eventIds, input.eventId].slice(-this.contextLimit) }
    if (input.revisitId) { value.revisitCount++; value.revisitIds = [...value.revisitIds, input.revisitId].slice(-this.contextLimit) }
    value.updatedAt = at; value.expiresAt = stamp(Math.max(Date.parse(value.expiresAt), Date.parse(input.expiresAt)))
    this.saveOpportunity(value); return value
  }
  /** No invented observation or intention. A grant gives computation time, never specifies its purpose.
   * One durable deadline per main session, no backlog after an outage, no second unacknowledged turn. */
  private considerOpenTurn(): void {
    const open = this.options.openActivity
    if (!open) return
    const grant = open.grant()
    this.store.atomic(() => {
      if (open.intervalMs <= 0 || grant === undefined || !open.willing()) {
        this.store.db.prepare('DELETE FROM spirit_open_clock WHERE session_id=?').run(open.sessionId)
        return
      }
      const now = this.now()
      const clock = this.store.db.prepare('SELECT grant,due FROM spirit_open_clock WHERE session_id=?').get(open.sessionId)
      if (clock?.grant !== grant) {
        this.store.db.prepare('INSERT OR REPLACE INTO spirit_open_clock VALUES(?,?,?)').run(open.sessionId, grant, now + open.intervalMs)
        return
      }
      if (Number(clock.due) > now || !open.idle() || this.activeCount() >= this.concurrency) return
      if (this.store.db.prepare("SELECT 1 FROM spirit_autonomy_opportunity WHERE session_id=? AND state IN ('pending','retry','dispatching','awaiting_decision') LIMIT 1").get(open.sessionId)) return
      const value = this.offer(open.sessionId, { openGrant: grant, reason: '空闲时的一次开放机会，可以直接不行动，也可以自行发起尚无题目的活动。', expiresAt: stamp(now + this.lifetime) })
      this.deferNextOpen(value)
    })
  }
  private currentOpenActivity(opportunity: Opportunity) {
    const open = this.options.openActivity
    if (openOpportunity(opportunity) && open?.sessionId === opportunity.sessionId && open.intervalMs > 0 && open.grant() === opportunity.openGrant) return open
  }
  private deferNextOpen(opportunity: Opportunity): void {
    const open = this.currentOpenActivity(opportunity)
    if (open) this.store.db.prepare('UPDATE spirit_open_clock SET due=MAX(due,?) WHERE session_id=? AND grant=?')
      .run(this.now() + open.intervalMs, opportunity.sessionId, opportunity.openGrant!)
  }
  private hasConcreteOpportunity(opportunity: Opportunity): boolean {
    return !!this.store.db.prepare(`SELECT 1 FROM spirit_autonomy_opportunity WHERE session_id=? AND id<>?
      AND state IN ('pending','retry','dispatching','awaiting_decision') AND (json_extract(value,'$.openGrant') IS NULL
      OR json_extract(value,'$.eventCount')>0 OR json_extract(value,'$.revisitCount')>0) LIMIT 1`).get(opportunity.sessionId, opportunity.id)
  }
  private hasCurrentContext(opportunity: Opportunity): boolean {
    if (openOpportunity(opportunity)) return !!this.currentOpenActivity(opportunity)
    const { events, revisits } = this.eligibleContext(opportunity)
    return !!(events.length || revisits.length)
  }
  private activeCount(): number {
    return Number(this.store.db.prepare("SELECT COUNT(*) AS count FROM spirit_autonomy_opportunity WHERE state IN ('dispatching','awaiting_decision')").get()?.count)
  }
  private eligibleContext(opportunity: Opportunity) {
    const events = this.store.db.prepare('SELECT value FROM spirit_autonomy_event WHERE opportunity_id=? ORDER BY rowid DESC').all(opportunity.id)
      .map(row => parse<Observation>(row)!).filter(event => (!event.expiresAt || Date.parse(event.expiresAt) > this.now())
        && (event.revision === undefined || this.affairRevision(event.sessionId, event.affairId!) <= event.revision))
    const revisits = this.store.db.prepare("SELECT value FROM spirit_autonomy_revisit WHERE opportunity_id=? AND state='fired' ORDER BY rowid DESC").all(opportunity.id)
      .map(row => parse<Revisit>(row)!).filter(revisit => this.validRevisit(revisit))
    return { events, revisits }
  }
  private claim(): { opportunity: Opportunity; packet: DeliberationPacket } | undefined {
    return this.store.atomic(() => {
      if (this.getControl().mode !== 'active') return
      if (this.activeCount() >= this.concurrency) return
      const candidates = this.store.db.prepare(`SELECT value,request FROM spirit_autonomy_opportunity AS candidate
        WHERE state IN ('pending','retry') AND due<=? AND NOT EXISTS (SELECT 1 FROM spirit_autonomy_opportunity AS active
          WHERE active.session_id=candidate.session_id AND active.state IN ('dispatching','awaiting_decision'))
        ORDER BY (json_extract(value,'$.openGrant') IS NOT NULL AND json_extract(value,'$.eventCount')=0 AND json_extract(value,'$.revisitCount')=0), rowid LIMIT 32`).all(this.now())
      for (const row of candidates) {
        const opportunity = parse<Opportunity>(row)!, context = this.eligibleContext(opportunity)
        if (openOpportunity(opportunity)) {
          const open = this.currentOpenActivity(opportunity)
          if (!open?.willing() || !open.idle() || this.hasConcreteOpportunity(opportunity)) continue
        } else if (!context.events.length && !context.revisits.length) {
          opportunity.state = 'stale'; opportunity.resolution = '原观察或意向已过时；没有据此再次唤醒的理由'
          opportunity.settledAt = stamp(this.now()); opportunity.updatedAt = opportunity.settledAt; this.saveOpportunity(opportunity); continue
        }
        opportunity.state = 'dispatching'; opportunity.dispatchId ??= `spirit-opportunity-${randomUUID()}`
        opportunity.claimId = randomUUID(); opportunity.leaseUntil = stamp(this.now() + this.lease)
        opportunity.attempts++; opportunity.dispatchedAt = stamp(this.now()); opportunity.updatedAt = opportunity.dispatchedAt
        this.saveOpportunity(opportunity)
        this.store.db.prepare('INSERT OR IGNORE INTO spirit_autonomy_dispatch VALUES (?,?,?)')
          .run(opportunity.dispatchId, opportunity.id, opportunity.dispatchedAt)
        const intents = this.intents(opportunity.sessionId).filter(value => this.validIntent(value))
        const related = new Set(context.revisits.map(value => value.intentId))
        intents.sort((a, b) => Number(related.has(b.id)) - Number(related.has(a.id)))
        const packet: DeliberationPacket = row.request ? JSON.parse(String(row.request)) as DeliberationPacket : {
          opportunity: { ...opportunity, reason: excerpt(opportunity.reason, 1600) }, dispatchId: opportunity.dispatchId,
          events: context.events.slice(0, this.contextLimit).map(value => ({ ...value, summary: excerpt(value.summary, 1000) })),
          revisits: context.revisits.slice(0, this.contextLimit).map(value => ({ ...value, reason: excerpt(value.reason, 600),
            ...(value.condition ? { condition: { ...value.condition, description: excerpt(value.condition.description, 600) } } : {}) })),
          intents: intents.slice(0, this.contextLimit).map(value => ({ ...value, statement: excerpt(value.statement, 1000), reason: excerpt(value.reason, 600) })),
          eventCount: context.events.length, revisitCount: context.revisits.length, intentCount: intents.length,
          instruction: openOpportunity(opportunity)
            ? '这是一次没有指定事项的开放机会，可以自行选择活动，也可以直接结束这一轮。不必发消息或给出理由；有需要时可以用 jingshen_decide 记录判断。没有新的观察就不要虚构。来源为 self 的意向归于精神自身；要改变实际意向或安排再考虑时应明确记录。上下文可能截短，可读取其余记录。'
            : '这是一次思考机会，不是新的用户命令，也不规定反思或自我更新。依据当前会话、实际未决事情和经验判断：行动、暂缓、询问、学习或不做。来源为 self 的意向应明确归于精神自身。若条件只是候选事件，请实际判断条件；先检查已有结果，避免重复行动。发送回执不代表思考完成；请用 jingshen_decide 以 opportunityId 和 dispatchId 记录判断与理由。机会已处理与事情已完成不同：意向继续开放、等待或完成需明确记录；只有确有理由时选择一次性的 revisit。上下文可能截短，可读取其余记录。',
        }
        if (!row.request) this.store.db.prepare('UPDATE spirit_autonomy_opportunity SET request=? WHERE id=?').run(JSON.stringify(packet), opportunity.id)
        return { opportunity, packet }
      }
    })
  }
  private backoff(attempts: number): number { return Math.min(this.retryMs[1], this.retryMs[0] * 2 ** Math.min(Math.max(0, attempts - 1), 16)) }
  private dispatch(opportunity: Opportunity, packet: DeliberationPacket): void {
    const claimId = opportunity.claimId!, controller = new AbortController()
    // The callback can reject synchronously, ignore cancellation, or resolve after a newer attempt. Only this claim may change state.
    const task = { controller, done: Promise.resolve() }
    this.running.set(claimId, task)
    task.done = this.deliver(packet, controller.signal).then(() => {
      this.finishDispatch(opportunity.id, claimId)
    }, error => { this.finishDispatch(opportunity.id, claimId, { error }) }).catch(error => {
      this.runtimeError = String(error)
    }).finally(() => { this.running.delete(claimId) })
  }
  private async deliver(packet: DeliberationPacket, signal: AbortSignal): Promise<void> {
    let abort: (() => void) | undefined
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    try {
      await Promise.race([Promise.resolve().then(() => {
        signal.throwIfAborted()
        this.assertReadyToDeliver(packet.opportunity.sessionId, packet.dispatchId, signal)
        return this.transport.deliberate(packet, signal)
      }), cancelled])
    }
    finally { signal.removeEventListener('abort', abort!) }
  }
  private finishDispatch(opportunityId: string, claimId: string, failure?: { error: unknown }): void {
    this.store.atomic(() => {
      const value = this.getOpportunity(opportunityId)
      if (value.state !== 'dispatching' || value.claimId !== claimId) return
      delete value.claimId; delete value.leaseUntil
      value.updatedAt = stamp(this.now())
      if (failure) {
        value.state = 'retry'; value.lastError = String(failure.error).slice(0, 2000); value.lastFailureAt = value.updatedAt
        value.availableAt = stamp(this.now() + (this.closed ? 0 : this.backoff(value.attempts)))
      } else {
        value.state = 'awaiting_decision'; value.receiptAt = value.updatedAt
        if (openOpportunity(value)) this.deferNextOpen(value)
      }
      this.saveOpportunity(value)
    })
  }
}
