/** Durable experience, optional structured examinations, and revisable operational memory. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store } from '../upstream/src/app/store.ts'
import type { TurnReference } from './continuity.ts'

const text = z.string().trim().min(1).max(8000)
const note = z.string().trim().max(8000)
const ids = z.array(z.string().min(1)).max(64)
export const EvidenceInput = z.object({
  kind: z.enum(['observation', 'artifact', 'tool', 'inference']),
  reference: text, content: text,
}).strict()
export const FrameInput = z.object({
  object: text,
  claims: z.array(z.object({ statement: text, evidenceIds: ids.min(1) }).strict()).min(1).max(24),
  limits: text,
}).strict()
export const ExaminationInput = z.object({
  frame: z.number().int().positive(),
  checks: z.array(z.object({ criterionId: text, outcome: z.enum(['met', 'unmet', 'unknown']), evidenceIds: ids, reason: text }).strict()).max(24),
  contradictions: z.array(z.object({ claimId: text, evidenceIds: ids.min(1), reason: text }).strict()).max(24),
  criterionContradictions: z.array(z.object({ criterionId: text, evidenceIds: ids.min(1), reason: text }).strict()).max(24).default([]),
}).strict()
export const RevisionInput = z.object({
  frame: z.number().int().positive(), negated: ids, preserved: ids,
  object: text, replacements: z.array(z.object({ statement: text, evidenceIds: ids.min(1) }).strict()).max(24),
  reason: text, limits: text,
  criterionChanges: z.array(z.object({ criterionId: text, replacement: text, reason: text }).strict()).max(24).default([]),
}).strict()
/** A journal entry need not invent a contradiction or follow a predetermined sequence. */
export const ReflectionInput = z.object({
  source: note.optional(), previous: note.optional(), new: text, reason: note.optional(), check: note.optional(),
  limits: note.optional(), evidenceIds: ids.default([]), details: z.record(z.string(), z.unknown()).optional(),
}).strict()
export const MemoryInput = z.object({
  kind: z.enum(['preference', 'fact', 'practice']), statement: text.optional(), claimId: z.string().min(1).optional(),
  evidenceIds: ids.optional(), reason: note.optional(), limits: note.optional(), replaces: z.string().min(1).optional(),
  state: z.enum(['active', 'proposed']).default('active'),
}).strict().refine(value => !!value.statement || !!value.claimId, '需要记忆内容或已有判断的引用')

export interface IntentBasis { id: string; revision: number }
export type RequestSource = { kind: 'owner'; sessionId: string; id: string; text: string; turn?: TurnReference }
  | { kind: 'self'; sessionId: string; id: string; text: string; reason: string; grantRevision: number; intent?: IntentBasis; turn?: TurnReference }
export type ConversationSource = { sessionId: string; id: string; text: string; turn?: TurnReference }
export type Evidence = { id: string; kind: z.infer<typeof EvidenceInput>['kind'] | 'user' | 'initiative'; reference: string; content: string; at: string;
  source?: RequestSource }
export type Claim = { id: string; statement: string; evidenceIds: string[] }
export type Frame = { number: number; object: string; claims: Claim[]; criteria: { id: string; text: string }[]; limits: string; at: string;
  transition?: { negated: string[]; preserved: string[]; reason: string; examination: number;
    criterionChanges: z.infer<typeof RevisionInput>['criterionChanges'] } }
export type Examination = z.infer<typeof ExaminationInput> & { id: number; round: number; at: string }
export interface Completion { text: string; limits: string; frame?: number; evidenceIds: string[]; check: string; round: number; at: string; turn?: TurnReference }
export interface Reflection extends z.infer<typeof ReflectionInput> {
  id: string; ticketId?: string; at: string; provenance: { kind: 'model'; reference: string; sessionId?: string; turn?: TurnReference }
}
export interface Experience {
  ticketId: string; ownerSession: string; requestId: string; round: number;
  source: RequestSource; latestSource: RequestSource; requests: (RequestSource & { at: string })[]; parentTicketId?: string;
  criteria: { id: string; text: string }[]; evidence: Evidence[]; frames: Frame[]; examinations: Examination[];
  reflections: Reflection[]; results: Completion[]; result?: Completion;
  recovery?: { at: string; sessionId: string; instruction: string };
}
export interface Memory {
  id: string; kind: 'preference' | 'fact' | 'practice'; statement: string;
  ticketId: string; claimId: string; evidenceIds: string[];
  state: 'active' | 'proposed' | 'accepted' | 'rejected' | 'forgotten' | 'superseded';
  provenance: { kind: 'model' | 'owner'; reference: string; reason: string; at: string; sessionId?: string; context?: string; turn?: TurnReference };
  ownerConfirmed: boolean; limits: string;
  history: { action: 'record' | 'accept' | 'reject' | 'correct' | 'forget' | 'supersede'; at: string; reason?: string; replacementId?: string }[];
  replaces?: string; createdAt: string; updatedAt: string;
}
const stamp = () => new Date().toISOString()
const unique = (values: string[]) => new Set(values).size === values.length
const excerpt = (value: string, limit: number) => value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
const workingSource = (source: RequestSource) => ({ ...source, text: excerpt(source.text, 2000),
  ...(source.kind === 'self' ? { reason: excerpt(source.reason, 600) } : {}) })
const readMemory = (row: { value: unknown }): Memory => {
  const memory = JSON.parse(String(row.value)) as Memory
  memory.provenance ??= { kind: 'model', reference: memory.claimId, reason: '从任务判断提出的历史记录', at: memory.createdAt }
  memory.ownerConfirmed ??= memory.state === 'accepted'
  memory.limits ??= ''; memory.history ??= []
  return memory
}

/** Uses the upstream transaction boundary: a report and its experience commit or roll back together. */
export class ExperienceBook {
  constructor(readonly store: Store, readonly maxRevisions = Number.POSITIVE_INFINITY) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS spirit_experience (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_memory (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_reflection (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS spirit_reflection_ticket ON spirit_reflection(value->>'$.ticketId');
      CREATE INDEX IF NOT EXISTS spirit_memory_usable ON spirit_memory((value->>'$.state')) WHERE value->>'$.state' IN ('active','accepted');`)
  }
  private load(id: string): Experience {
    const row = this.store.db.prepare('SELECT value FROM spirit_experience WHERE id=?').get(id)
    if (!row) throw new Error('没有找到这个任务的经验记录')
    const value = JSON.parse(String(row.value)) as Experience
    // Legacy records remain readable, and no past model message becomes a user confirmation.
    value.source ??= { kind: 'owner', sessionId: value.ownerSession, id: value.requestId, text: value.evidence.find(item => item.id === 'request')?.content ?? '' }
    value.latestSource ??= value.source
    value.requests ??= [{ ...value.source, at: value.evidence[0]?.at ?? stamp() }]
    value.results ??= value.result ? [{ ...value.result, round: value.round, evidenceIds: value.result.evidenceIds ?? [], check: value.result.check ?? '' }] : []
    if (value.result) value.result = { ...value.result, round: value.result.round ?? value.round, evidenceIds: value.result.evidenceIds ?? [], check: value.result.check ?? '' }
    value.reflections = []
    return value
  }
  latestRequestSource(id: string): RequestSource {
    const row = this.store.db.prepare("SELECT value -> '$.latestSource' AS source FROM spirit_experience WHERE id=?").get(id)
    return row?.source ? JSON.parse(String(row.source)) as RequestSource : this.load(id).latestSource
  }
  get(id: string): Experience {
    const value = this.load(id)
    value.reflections = this.reflections(id)
    return value
  }
  /** Bounded working view; complete, unmodified evidence and history remain separately addressable. */
  context(id: string) {
    const value = this.load(id), current = value.frames.at(-1), examination = value.examinations.at(-1)
    const criteria = (current?.criteria ?? value.criteria).map(item => ({ ...item, text: excerpt(item.text, 240) }))
    const reflections = this.reflectionPage(0, 4, id).items.reverse().map(item => ({ id: item.id, at: item.at, new: excerpt(item.new, 400),
      reason: item.reason && excerpt(item.reason, 250), provenance: item.provenance }))
    const transition = current?.transition
    return { ticketId: id, round: value.round, source: workingSource(value.source), latestSource: workingSource(value.latestSource), parentTicketId: value.parentTicketId,
      criteria, current: current && { number: current.number, at: current.at, object: excerpt(current.object, 1100), limits: excerpt(current.limits, 600),
        transition: transition && { reason: excerpt(transition.reason, 600), examination: transition.examination }, totalClaims: current.claims.length,
        claims: current.claims.slice(-10).map(item => ({ ...item, statement: excerpt(item.statement, 400), evidenceIds: item.evidenceIds.slice(0, 8) })) },
      history: value.frames.slice(-10).map(frame => ({ number: frame.number, object: excerpt(frame.object, 180),
        transition: frame.transition && { reason: excerpt(frame.transition.reason, 180), examination: frame.transition.examination } })),
      evidence: value.evidence.slice(-12).map(item => ({ ...item, source: item.source && workingSource(item.source),
        content: excerpt(item.content, 320), reference: excerpt(item.reference, 160) })),
      examination: examination && { id: examination.id, frame: examination.frame, round: examination.round, at: examination.at,
        checks: examination.checks.map(item => ({ criterionId: item.criterionId, outcome: item.outcome })),
        contradictionCount: examination.contradictions.length + examination.criterionContradictions.length },
      result: value.result && { ...value.result, text: excerpt(value.result.text, 1600), limits: excerpt(value.result.limits, 400), check: excerpt(value.result.check, 400) },
      reflections, recovery: value.recovery && { ...value.recovery, instruction: excerpt(value.recovery.instruction, 600) },
      totalEvidence: value.evidence.length, totalFrames: value.frames.length, totalResults: value.results.length,
      readMore: '这是工作视图，部分长文本截短；可用 jingshen_read 的 evidenceId、frame、resultRound 或 action=reflections 读取原记录。' }
  }
  private save(value: Experience): void {
    const { reflections: _reflections, ...stored } = value
    this.store.db.prepare('INSERT INTO spirit_experience VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(value.ticketId, JSON.stringify(stored))
  }
  create(ticketId: string, ownerSession: string, requestId: string, request: string, criteria: string[], source?: RequestSource, parentTicketId?: string): Experience {
    const found = this.store.db.prepare('SELECT 1 FROM spirit_experience WHERE id=?').get(ticketId)
    if (found) return this.get(ticketId)
    const origin = source ?? { kind: 'owner' as const, sessionId: ownerSession, id: requestId, text: request }
    const at = stamp()
    const value: Experience = { ticketId, ownerSession, requestId, round: 1, source: origin, latestSource: origin, requests: [{ ...origin, at }],
      ...(parentTicketId ? { parentTicketId } : {}), criteria: criteria.map((text, i) => ({ id: `criterion-${i + 1}`, text })),
      evidence: [{ id: 'request', kind: origin.kind === 'owner' ? 'user' : 'initiative', reference: requestId, content: request, source: origin, at }],
      frames: [], examinations: [], reflections: [], results: [] }
    this.save(value); return value
  }
  evidence(ticketId: string, input: unknown): Evidence {
    const parsed = EvidenceInput.parse(input), value = this.get(ticketId)
    const existing = value.evidence.find(item => item.kind === parsed.kind && item.reference === parsed.reference && item.content === parsed.content)
    if (existing) return existing
    const evidence = { ...parsed, id: randomUUID(), at: stamp() }
    value.evidence.push(evidence); this.save(value); return evidence
  }
  userEvidence(ticketId: string, requestId: string, content: string, sessionId?: string): void {
    const value = this.get(ticketId)
    this.requestEvidence(ticketId, { kind: 'owner', sessionId: sessionId ?? value.ownerSession, id: requestId, text: content })
  }
  requestEvidence(ticketId: string, source: RequestSource): void {
    const value = this.get(ticketId), kind = source.kind === 'owner' ? 'user' : 'initiative'
    if (value.evidence.some(item => item.reference === source.id && item.kind === kind)) return
    const at = stamp()
    value.evidence.push({ id: randomUUID(), kind, reference: source.id, content: source.text, source, at })
    value.requests.push({ ...source, at }); value.latestSource = source
    // A past result remains in results; it does not certify the new round.
    delete value.result
    value.round++
    this.save(value)
  }
  recovery(ticketId: string, sessionId: string, instruction: string): void {
    const value = this.get(ticketId)
    value.recovery = { at: stamp(), sessionId, instruction }
    this.save(value)
  }
  private references(value: Experience, refs: string[], grounded = false): void {
    if (!unique(refs)) throw new Error('证据引用不能重复')
    for (const id of refs) if (!value.evidence.some(item => item.id === id)) throw new Error(`未知证据：${id}`)
    if (grounded && !refs.some(id => { const kind = value.evidence.find(item => item.id === id)?.kind; return kind !== 'inference' && kind !== 'initiative' })) {
      throw new Error('需要观察、用户陈述或工具/成果记录；推断不能独自证明任务完成或矛盾')
    }
  }
  frame(ticketId: string, input: unknown): Frame {
    const parsed = FrameInput.parse(input), value = this.get(ticketId)
    if (value.frames.length) throw new Error('已有理解形态；可使用修订工具或反思记录补充、限定现有理解')
    for (const claim of parsed.claims) this.references(value, claim.evidenceIds)
    const frame: Frame = { number: 1, object: parsed.object, criteria: value.criteria, limits: parsed.limits, at: stamp(),
      claims: parsed.claims.map(claim => ({ ...claim, id: randomUUID() })) }
    value.frames.push(frame); this.save(value); return frame
  }
  examine(ticketId: string, input: unknown): Examination {
    const parsed = ExaminationInput.parse(input), value = this.get(ticketId), frame = value.frames.at(-1)
    if (!frame || frame.number !== parsed.frame) throw new Error('只能检验当前的理解形态')
    const checked = parsed.checks.map(item => item.criterionId)
    if (!unique(checked) || checked.length !== frame.criteria.length || frame.criteria.some(item => !checked.includes(item.id))) {
      throw new Error('结构化检验需要逐项对应当前尺度；普通观察或局部检查也可写入反思记录')
    }
    for (const check of parsed.checks) this.references(value, check.evidenceIds, check.outcome !== 'unknown')
    if (!unique(parsed.contradictions.map(item => item.claimId))) throw new Error('同一判断的矛盾应合并记录')
    for (const contradiction of parsed.contradictions) {
      if (!frame.claims.some(item => item.id === contradiction.claimId)) throw new Error('矛盾必须指向当前的具体判断')
      this.references(value, contradiction.evidenceIds, true)
    }
    if (!unique(parsed.criterionContradictions.map(item => item.criterionId))) throw new Error('不能重复记录同一尺度的矛盾')
    for (const contradiction of parsed.criterionContradictions) {
      if (!frame.criteria.some(item => item.id === contradiction.criterionId)) throw new Error('未知检验尺度')
      this.references(value, contradiction.evidenceIds, true)
    }
    const examination = { ...parsed, id: value.examinations.length + 1, round: value.round, at: stamp() }
    value.examinations.push(examination); delete value.result
    this.save(value); return examination
  }
  revise(ticketId: string, input: unknown): Frame {
    const parsed = RevisionInput.parse(input), value = this.get(ticketId), previous = value.frames.at(-1), exam = value.examinations.at(-1)
    if (!previous || previous.number !== parsed.frame || exam?.frame !== previous.number || exam.round !== value.round) throw new Error('结构化修订需要当前形态的检验；普通细化可使用反思记录')
    if (Number.isFinite(this.maxRevisions) && value.frames.length > this.maxRevisions) throw new Error('已达到配置的结构化修订上限；可调整资源配置，历史记录不会被删除')
    const partition = [...parsed.negated, ...parsed.preserved]
    if (!unique(partition) || partition.length !== previous.claims.length || previous.claims.some(item => !partition.includes(item.id))) {
      throw new Error('必须明确每个旧判断是被否定还是被保留，不能无声丢弃')
    }
    if (parsed.negated.some(id => !exam.contradictions.some(item => item.claimId === id))) throw new Error('规定的否定须有针对该判断的具体依据')
    if (exam.contradictions.some(item => !parsed.negated.includes(item.claimId))) throw new Error('不能保留尚未处理的矛盾判断')
    const changed = parsed.criterionChanges.map(item => item.criterionId)
    if (!unique(changed) || changed.length !== exam.criterionContradictions.length || exam.criterionContradictions.some(item => !changed.includes(item.criterionId))) {
      throw new Error('尺度修订必须逐项对应已经显露的尺度矛盾')
    }
    if (!parsed.negated.length && !changed.length) throw new Error('没有规定的否定；不需要为普通细化制造矛盾，可使用反思记录')
    if (!parsed.preserved.length && !parsed.replacements.length) throw new Error('新的形态须保有具体内容；空的否定不是发展结果')
    for (const claim of parsed.replacements) this.references(value, claim.evidenceIds, true)
    const frame: Frame = { number: previous.number + 1, object: parsed.object, limits: parsed.limits, at: stamp(),
      criteria: previous.criteria.map(item => ({ ...item, text: parsed.criterionChanges.find(change => change.criterionId === item.id)?.replacement ?? item.text })),
      claims: [...previous.claims.filter(item => parsed.preserved.includes(item.id)), ...parsed.replacements.map(item => ({ ...item, id: randomUUID() }))],
      transition: { negated: parsed.negated, preserved: parsed.preserved, reason: parsed.reason, examination: exam.id, criterionChanges: parsed.criterionChanges } }
    value.frames.push(frame); delete value.result
    this.save(value); return frame
  }
  complete(ticketId: string, result: string, limits = '', evidenceIds: string[] = [], check = '', turn?: TurnReference): void {
    const value = this.get(ticketId), frame = value.frames.at(-1)
    this.references(value, evidenceIds)
    const completion: Completion = { text: z.string().trim().min(1).max(12000).parse(result), limits: note.parse(limits), evidenceIds: [...evidenceIds], check: note.parse(check),
      ...(frame ? { frame: frame.number } : {}), round: value.round, at: stamp(), ...(turn ? { turn } : {}) }
    value.result = completion; value.results.push(completion)
    this.save(value)
  }
  reflect(ticketId: string | undefined, input: unknown, source?: ConversationSource): Reflection {
    const parsed = ReflectionInput.parse(input), value = ticketId ? this.get(ticketId) : undefined
    if (value) this.references(value, parsed.evidenceIds)
    else if (parsed.evidenceIds.length) throw new Error('全局反思请使用 source 引用原材料；evidenceIds 需要任务记录')
    const reference = source?.id ?? value?.latestSource.id
    if (!reference) throw new Error('反思需要可追溯的会话或任务来源')
    const reflection: Reflection = { ...parsed, id: randomUUID(), ...(ticketId ? { ticketId } : {}), at: stamp(),
      provenance: { kind: 'model', reference, sessionId: source?.sessionId ?? value?.ownerSession, ...(source?.turn ? { turn: source.turn } : {}) } }
    this.store.db.prepare('INSERT INTO spirit_reflection VALUES (?,?)').run(reflection.id, JSON.stringify(reflection))
    return reflection
  }
  reflections(ticketId?: string): Reflection[] {
    const rows = ticketId
      ? this.store.db.prepare("SELECT value FROM spirit_reflection WHERE value ->> '$.ticketId' = ? ORDER BY rowid").all(ticketId)
      : this.store.db.prepare('SELECT value FROM spirit_reflection ORDER BY rowid').all()
    return rows.map(row => JSON.parse(String(row.value)) as Reflection)
  }
  reflectionPage(offset: number, limit: number, ticketId?: string) {
    const where = ticketId ? " WHERE value->>'$.ticketId'=?" : ''
    const parameters = ticketId ? [ticketId] : []
    const total = Number(this.store.db.prepare(`SELECT count(*) AS total FROM spirit_reflection${where}`).get(...parameters)?.total)
    const items = this.store.db.prepare(`SELECT value FROM spirit_reflection${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`)
      .all(...parameters, limit, offset).map(row => JSON.parse(String(row.value)) as Reflection)
    return { items, total }
  }
  reflection(id: string): Reflection {
    const row = this.store.db.prepare('SELECT value FROM spirit_reflection WHERE id=?').get(id)
    if (!row) throw new Error('反思记录不存在')
    return JSON.parse(String(row.value)) as Reflection
  }
  memories(state?: Memory['state']): Memory[] {
    return this.store.db.prepare("SELECT value FROM spirit_memory WHERE (? IS NULL OR value->>'$.state'=?) ORDER BY rowid DESC")
      .all(state ?? null, state ?? null).map(row => readMemory({ value: row.value }))
  }
  memory(id: string): Memory {
    const row = this.store.db.prepare('SELECT value FROM spirit_memory WHERE id=?').get(id)
    if (!row) throw new Error('记忆不存在')
    return readMemory({ value: row.value })
  }
  memoryPage(offset: number, limit: number) {
    const where = "WHERE value->>'$.state' IS NOT 'forgotten'"
    const total = Number(this.store.db.prepare(`SELECT count(*) AS total FROM spirit_memory ${where}`).get()?.total)
    const items = this.store.db.prepare(`SELECT value FROM spirit_memory ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(limit, offset)
      .map(row => readMemory({ value: row.value }))
    return { items, total }
  }
  workingMemories(limit: number) {
    return this.store.db.prepare(`SELECT id, value->>'$.kind' AS kind, substr(value->>'$.statement',1,260) AS statement,
      substr(coalesce(value->>'$.limits',''),1,240) AS limits, value->>'$.state' AS state,
      coalesce(value->>'$.provenance.kind','model') AS source, coalesce(value->>'$.ownerConfirmed',value->>'$.state'='accepted') AS ownerConfirmed
      FROM spirit_memory
      WHERE value->>'$.state' IN ('active','accepted') ORDER BY rowid DESC LIMIT ?`).all(limit)
  }
  usableMemories(): Memory[] { return this.memories().filter(item => item.state === 'active' || item.state === 'accepted') }
  private saveMemory(memory: Memory): void {
    this.store.db.prepare('INSERT INTO spirit_memory VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(memory.id, JSON.stringify(memory))
  }
  private supersede(memory: Memory, replacementId: string): void {
    memory.state = 'superseded'; memory.updatedAt = stamp()
    memory.history.push({ action: 'supersede', at: memory.updatedAt, replacementId })
    this.saveMemory(memory)
  }
  remember(ticketId: string, input: unknown, source?: ConversationSource): Memory { return this.recordMemory(ticketId, input, source) }
  rememberGlobal(input: unknown, source: ConversationSource): Memory { return this.recordMemory(undefined, input, source) }
  private recordMemory(ticketId: string | undefined, input: unknown, source?: ConversationSource): Memory {
    return this.store.atomic(() => {
      const parsed = MemoryInput.parse(input), value = ticketId ? this.get(ticketId) : undefined
      const claim = parsed.claimId ? value?.frames.at(-1)?.claims.find(item => item.id === parsed.claimId) : undefined
      if (parsed.claimId && !claim) throw new Error('判断不存在于当前任务形态')
      const evidenceIds = parsed.evidenceIds ?? claim?.evidenceIds ?? []
      if (value) this.references(value, evidenceIds)
      else if (evidenceIds.length) throw new Error('全局记忆请引用会话来源；evidenceIds 需要任务记录')
      const reference = source?.id ?? value?.latestSource.id
      if (!reference) throw new Error('记忆需要可追溯的会话或任务来源')
      const statement = parsed.statement ?? claim!.statement
      const row = this.store.db.prepare(`SELECT value FROM spirit_memory WHERE value->>'$.state' NOT IN ('forgotten','superseded','rejected')
        AND value->>'$.ticketId'=? AND coalesce(value->>'$.provenance.reference',value->>'$.claimId')=?
        AND value->>'$.statement'=? AND value->>'$.kind'=? AND coalesce(value->>'$.limits','')=? AND value->>'$.replaces' IS ?
        ORDER BY rowid DESC LIMIT 1`).get(ticketId ?? '', reference, statement, parsed.kind, parsed.limits ?? '', parsed.replaces ?? null)
      if (row) return readMemory({ value: row.value })
      const previous = parsed.replaces ? this.memory(parsed.replaces) : undefined
      if (previous && previous.state !== 'active' && previous.state !== 'accepted') throw new Error('只能修订一条有效记忆')
      const at = stamp()
      const memory: Memory = { id: randomUUID(), kind: parsed.kind, statement, ticketId: ticketId ?? '', claimId: parsed.claimId ?? '', evidenceIds,
        state: parsed.state, ownerConfirmed: false, limits: parsed.limits ?? '',
        provenance: { kind: 'model', reference, reason: parsed.reason ?? '根据当前材料形成的可修订记忆', at,
          sessionId: source?.sessionId ?? value?.ownerSession, ...(source ? { context: source.text, turn: source.turn } : {}) },
        history: [{ action: 'record', at }], ...(parsed.replaces ? { replaces: parsed.replaces } : {}), createdAt: at, updatedAt: at }
      if (previous && memory.state === 'active') this.supersede(previous, memory.id)
      this.saveMemory(memory); return memory
    })
  }
  /** Compatibility path for a model that explicitly wants to propose, rather than use, a memory. */
  propose(ticketId: string, claimId: string, kind: Memory['kind'], replaces?: string): Memory {
    return this.remember(ticketId, { claimId, kind, ...(replaces ? { replaces } : {}), state: 'proposed' })
  }
  /** Owner review changes provenance explicitly; a model cannot manufacture owner confirmation. */
  decideMemory(id: string, action: 'accept' | 'reject' | 'forget' | 'correct', correction?: { statement: string; reason?: string }): Memory {
    return this.store.atomic(() => {
      const memory = this.memory(id)
      const at = stamp()
      if (action === 'forget') {
        memory.statement = ''; memory.evidenceIds = []; memory.claimId = ''; memory.ticketId = ''; memory.limits = ''; delete memory.replaces
        memory.provenance = { kind: memory.provenance.kind, reference: '', reason: '', at: memory.provenance.at }
        memory.history = [{ action: 'forget', at }]; memory.ownerConfirmed = false; memory.state = 'forgotten'
      } else {
        if (!['proposed', 'active', 'accepted'].includes(memory.state)) throw new Error('这条记忆已被处理，请刷新面板')
        if (action === 'correct') {
          const statement = text.parse(correction?.statement)
          const replacement: Memory = { ...memory, id: randomUUID(), statement, state: 'accepted', ownerConfirmed: true, replaces: memory.id,
            provenance: { kind: 'owner', reference: id, reason: correction?.reason ?? '本人纠正记忆', at },
            history: [{ action: 'correct', at, reason: correction?.reason }], createdAt: at, updatedAt: at }
          this.supersede(memory, replacement.id); this.saveMemory(replacement); return replacement
        }
        if (action === 'accept' && memory.state === 'proposed' && memory.replaces) {
          const previous = this.memory(memory.replaces)
          if (previous.state !== 'active' && previous.state !== 'accepted') throw new Error('被修订的记忆已改变，请重新提出记忆')
          this.supersede(previous, memory.id)
        }
        memory.state = action === 'accept' ? 'accepted' : 'rejected'
        memory.ownerConfirmed = action === 'accept'
        memory.history.push({ action, at })
      }
      memory.updatedAt = at; this.saveMemory(memory); return memory
    })
  }
}
