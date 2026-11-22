import { z } from 'zod'
import type { SessionEventsPage } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Store } from '../upstream/src/app/store.ts'

export const OrientationInput = z.object({
  expectedRevision: z.number().int().nonnegative(),
  outlook: z.string().trim().min(1).max(1600).describe('接下来的实践将怎样改变；可保留未解决的分歧'),
  reason: z.string().trim().min(1).max(1600).describe('可公开说明的根据'),
  attention: z.enum(['open', 'quiet']).optional().describe('open 接受无指定事项的空闲机会，quiet 让这类机会安静下来'),
}).strict()
export const TurnReferenceInput = z.object({ sessionId: z.string().min(1).max(300),
  startSeq: z.number().int().nonnegative(), throughSeq: z.number().int().nonnegative(), callId: z.string().min(1).max(300) }).strict()
  .refine(value => value.throughSeq >= value.startSeq, '回合引用的结束序号不能早于开始序号')
export type TurnReference = z.infer<typeof TurnReferenceInput>
interface Orientation {
  revision: number; outlook: string; reason: string; attention: 'open' | 'quiet'
  source?: TurnReference; at?: string; attributedTo?: 'model'
}
const initial: Orientation = { revision: 0, outlook: '', reason: '', attention: 'open' }
function publicExcerpt(parts: readonly { type: string; text?: string }[]): string {
  const limit = 360
  let result = ''
  for (const part of parts) {
    if (part.type !== 'text' || !part.text?.trim()) continue
    const remaining = limit + 1 - result.length
    result += (result ? '\n' : '') + part.text.trim().slice(0, remaining)
    if (result.length > limit) return result.slice(0, limit - 1) + '…'
  }
  return result
}
const recordData = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const clipped = (value: unknown, limit: number) => typeof value !== 'string' || value.length <= limit ? value : `${value.slice(0, limit)}…`
function visibleParts(content: unknown) {
  const parts: { type: 'text'; text: unknown }[] = []
  let remaining = 4000
  if (Array.isArray(content)) for (const entry of content) {
    const part = recordData(entry)
    if (part.type !== 'text' || typeof part.text !== 'string' || !part.text.length) continue
    parts.push({ type: 'text', text: clipped(part.text, remaining) })
    remaining -= part.text.length + 32
    if (remaining <= 0) break
  }
  return parts
}

/** Public conversation, tool action and result from the native log. Omit hidden model streams and tool-private payloads. */
export function publicSessionPage<T extends SessionEventsPage & { nextBeforeSeq: number | null }>(page: T, startSeq = 0) {
  const records = []
  let remaining = 24_000, nextBeforeSeq: number | null = null
  for (let i = page.records.length - 1; i >= 0; i--) {
    const { event } = page.records[i]!
    if (event.seq < startSeq) break
    const raw = recordData(event.data), message = recordData(raw.message)
    let data: unknown
    switch (event.type) {
      case 'turn/start': case 'turn/end': data = { turn: raw.turn, reason: raw.reason }; break
      case 'user/message': data = { id: raw.id, source: raw.source, content: visibleParts(raw.content) }; break
      case 'assistant/message': data = { turn: raw.turn, step: raw.step, interrupted: raw.interrupted,
        message: { id: message.id, source: message.source, content: visibleParts(message.content) } }; break
      case 'tool/call': data = { turn: raw.turn, step: raw.step, callId: raw.callId, name: raw.name, arguments: clipped(raw.arguments, 6000) }; break
      case 'tool/result': data = { turn: raw.turn, step: raw.step, message: { toolCallId: message.toolCallId, isError: message.isError,
        content: visibleParts(message.content) } }; break
      default: continue
    }
    const record = { type: 'event' as const, event: { seq: event.seq, time: event.time, type: event.type, data } }
    const length = JSON.stringify(record).length
    if (records.length && length > remaining) { nextBeforeSeq = records.at(-1)!.event.seq; break }
    remaining -= length
    records.push(record)
  }
  if (nextBeforeSeq === null && (page.nextBeforeSeq ?? -1) > startSeq) nextBeforeSeq = page.nextBeforeSeq
  return { ...page, records: records.reverse(), hasMore: nextBeforeSeq !== null, nextBeforeSeq }
}

/** One live working orientation per profile. Sessions participate in it; reconnecting a model
 * does not replay the archive. SQLite commits the revision before it becomes visible to peers. */
export class Continuity {
  constructor(private readonly store: Store) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS spirit_orientation (
        revision INTEGER PRIMARY KEY, session_id TEXT NOT NULL, call_id TEXT NOT NULL, value TEXT NOT NULL,
        UNIQUE(session_id, call_id));
      CREATE TABLE IF NOT EXISTS spirit_exchange (
        session_id TEXT NOT NULL, start_seq INTEGER NOT NULL, turn INTEGER NOT NULL, through_seq INTEGER NOT NULL,
        owner_text TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', ended INTEGER, outcome TEXT,
        PRIMARY KEY(session_id,start_seq));
      CREATE INDEX IF NOT EXISTS spirit_exchange_recent ON spirit_exchange(ended DESC) WHERE ended IS NOT NULL;
      CREATE INDEX IF NOT EXISTS spirit_exchange_open ON spirit_exchange(session_id,turn) WHERE ended IS NULL;
      CREATE TABLE IF NOT EXISTS spirit_action_turn (session_id TEXT NOT NULL, start_seq INTEGER NOT NULL, turn INTEGER NOT NULL,
        through_seq INTEGER NOT NULL, finished INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id,start_seq));
      CREATE INDEX IF NOT EXISTS spirit_action_turn_open ON spirit_action_turn(session_id,turn) WHERE finished=0;
    `)
  }
  current(): Readonly<Orientation> {
    const row = this.store.db.prepare('SELECT value FROM spirit_orientation ORDER BY revision DESC LIMIT 1').get()
    return row ? JSON.parse(String(row.value)) as Orientation : { ...initial }
  }
  revise(input: z.infer<typeof OrientationInput>, source: TurnReference): Orientation {
    TurnReferenceInput.parse(source)
    return this.store.atomic(() => {
      const callKey = `${source.startSeq}:${source.callId}`
      const previous = this.store.db.prepare(`SELECT value FROM spirit_orientation WHERE session_id=?
        AND (call_id=? OR call_id=? AND value->>'$.source.startSeq'=?)`).get(source.sessionId, callKey, source.callId, source.startSeq)
      if (previous) {
        const saved = JSON.parse(String(previous.value)) as Orientation
        if (saved.revision !== input.expectedRevision + 1 || saved.outlook !== input.outlook || saved.reason !== input.reason
          || saved.source?.startSeq !== source.startSeq
          || (input.attention !== undefined && saved.attention !== input.attention)) throw new Error('同一调用不能代表两项修订')
        return saved
      }
      const current = this.current()
      if (input.expectedRevision !== current.revision) throw new Error(`其他会话已修订共同理解，请依据现行版本 ${current.revision} 重新判断`)
      const value: Orientation = { revision: input.expectedRevision + 1, outlook: input.outlook, reason: input.reason,
        attention: input.attention ?? current.attention, source, attributedTo: 'model', at: new Date().toISOString() }
      this.store.db.prepare('INSERT INTO spirit_orientation VALUES(?,?,?,?)')
        .run(value.revision, source.sessionId, callKey, JSON.stringify(value))
      return value
    })
  }
  history(offset: number, limit: number): Orientation[] {
    return this.store.db.prepare('SELECT value FROM spirit_orientation ORDER BY revision DESC LIMIT ? OFFSET ?')
      .all(limit, offset).map(row => JSON.parse(String(row.value)) as Orientation)
  }
  rememberTurn(reference: TurnReference, turn: number): void {
    this.store.db.prepare(`INSERT INTO spirit_action_turn(session_id,start_seq,turn,through_seq) VALUES(?,?,?,?)
      ON CONFLICT(session_id,start_seq) DO UPDATE SET through_seq=max(through_seq,excluded.through_seq) WHERE finished=0`)
      .run(reference.sessionId, reference.startSeq, turn, reference.throughSeq)
  }
  throughSeq(sessionId: string, startSeq: number): number | undefined {
    const exchange = this.store.db.prepare('SELECT through_seq FROM spirit_exchange WHERE session_id=? AND start_seq=?').get(sessionId, startSeq)
    const action = this.store.db.prepare('SELECT through_seq FROM spirit_action_turn WHERE session_id=? AND start_seq=?').get(sessionId, startSeq)
    const throughSeq = Math.max(Number(exchange?.through_seq ?? -1), Number(action?.through_seq ?? -1))
    return throughSeq >= startSeq ? throughSeq : undefined
  }

  /** The exact conversation, tools and outcome stay in the native log. Only direct owner
   * turns contribute excerpts; no reasoning blocks, synthetic inputs or background echoes. */
  observe(sessionId: string, startSeq: number | null, turn: number, event: SessionEvent): void {
    if (event.type === 'turn/end') {
      // The native projection can already have closed the turn. Use its number to find
      // the start via the caller's durable open row, even across process restarts.
      this.store.db.prepare('UPDATE spirit_exchange SET through_seq=?, ended=?, outcome=? WHERE session_id=? AND ended IS NULL AND turn=?')
        .run(event.seq, event.time, event.data.reason.kind, sessionId, event.data.turn)
      this.store.db.prepare('UPDATE spirit_action_turn SET through_seq=?, finished=1 WHERE session_id=? AND finished=0 AND turn=?')
        .run(event.seq, sessionId, event.data.turn)
      return
    }
    if (startSeq === null) return
    if (event.type === 'user/message') {
      const { source, content } = event.data
      if (source.kind !== 'user' || Object.hasOwn(source, 'principal')) return
      const text = publicExcerpt(content)
      if (!text) return
      this.store.db.prepare(`INSERT INTO spirit_exchange(session_id,start_seq,turn,through_seq,owner_text) VALUES(?,?,?,?,?)
        ON CONFLICT(session_id,start_seq) DO UPDATE SET through_seq=excluded.through_seq,owner_text=excluded.owner_text
        WHERE spirit_exchange.ended IS NULL AND excluded.through_seq>spirit_exchange.through_seq`).run(sessionId, startSeq, turn, event.seq, text)
    } else if (event.type === 'assistant/message') {
      const text = publicExcerpt(event.data.message.content)
      if (text) this.store.db.prepare('UPDATE spirit_exchange SET through_seq=?,answer=? WHERE session_id=? AND start_seq=? AND ended IS NULL AND through_seq<?')
        .run(event.seq, text, sessionId, startSeq, event.seq)
    }
  }
  recent(limit: number, offset = 0) {
    return this.store.db.prepare(`SELECT session_id AS sessionId,start_seq AS startSeq,through_seq AS throughSeq,
      owner_text AS ownerExcerpt,answer AS assistantExcerpt,outcome FROM spirit_exchange WHERE ended IS NOT NULL
      ORDER BY ended DESC,rowid DESC LIMIT ? OFFSET ?`).all(limit, offset)
  }
}
