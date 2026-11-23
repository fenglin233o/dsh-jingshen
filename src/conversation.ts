import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { Store } from '../upstream/src/app/store.ts'
import type { TurnReference } from './continuity.ts'

const Tone = z.enum(['neutral', 'warm', 'serious', 'gentle', 'playful'])
const PublicText = z.string().min(1).max(8000).refine(value => !!value.trim(), '需要可见正文')
export const ChatInput = z.object({ requestId: z.string().trim().min(1).max(200), text: PublicText }).strict()
export const SayInput = z.object({ text: PublicText, tone: Tone.optional() }).strict()
export const ExpressionInput = z.object({ kind: z.enum(['smile', 'wave', 'thoughtful', 'excited', 'sad', 'neutral']) }).strict()
export const RestInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('wake') }).strict(),
  z.object({ kind: z.enum(['sleep', 'idle']), minutes: z.number().int().min(1).max(1440) }).strict(),
])

export type ChatSubmission = z.infer<typeof ChatInput>
type Tone = z.infer<typeof Tone>
type Expression = { kind: z.infer<typeof ExpressionInput>['kind']; until: string; sessionId: string }
type Rest = { kind: 'sleep' | 'idle'; until: string }
type Media = { kind: 'audio' | 'video' | 'camera' | 'image'; state: 'playing' | 'observing'; id: string; title?: string }
type Source = { kind: 'native'; sessionId: string; messageId: string; seq: number; turn?: number; historical?: true }
  | ({ kind: 'say'; turn: number } & TurnReference)
export interface ConversationMessage {
  cursor: number; id: string; author: 'owner' | 'spirit'; text: string; at: string; source: Source; tone?: Tone
}
export interface Presence {
  activity: { kind: 'idle' | 'thinking' | 'working' | 'phone' | 'observing' | 'sleep' | 'paused' | 'stopped'; sessionId?: string; label?: string; until?: string; media?: Media }
  expression?: Expression
}
type ReplyDelivery = { tone?: Tone }
type InputRecord = ChatSubmission & { messageId: string; accepted: boolean }
type ChatState = 'running' | 'paused' | 'stopped'
const iso = (time: number) => new Date(time).toISOString()
const key = (...items: (string | number)[]) => createHash('sha256').update(JSON.stringify(items)).digest('hex')
const callKey = ({ sessionId, startSeq, callId }: TurnReference) => key(sessionId, startSeq, callId)
const textOf = (content: readonly { type: string; text?: string }[], separator = '\n') => content
  .filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text!).join(separator)

/** One owner inbox across UI and speech. The closed native log supplies delivery and authorship. */
export class Conversation {
  private readonly listeners = new Set<(message: ConversationMessage) => void>()
  private readonly work = new Map<object, { sessionId: string; label: string }>()
  private readonly media = new Map<object, Media>()

  constructor(private readonly store: Store, readonly mainId: string, private readonly now = Date.now) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS spirit_chat_message (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, author TEXT NOT NULL,
        session_id TEXT NOT NULL, turn INTEGER, text TEXT NOT NULL, value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS spirit_chat_message_turn ON spirit_chat_message(session_id,turn,author);
      CREATE TABLE IF NOT EXISTS spirit_chat_native (session_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, legacy_through INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_chat_input (
        request_id TEXT PRIMARY KEY, message_id TEXT UNIQUE NOT NULL, text TEXT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS spirit_chat_action (id TEXT PRIMARY KEY, input TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spirit_chat_presence (key TEXT PRIMARY KEY, revision INTEGER NOT NULL, value TEXT NOT NULL);
    `)
  }

  /** Freeze the pre-mediation native history boundary once per profile. */
  beginNative(legacyThrough: number): void {
    this.store.db.prepare('INSERT OR IGNORE INTO spirit_chat_native VALUES (?,-1,?)').run(this.mainId, legacyThrough)
  }

  nativeOffset(): number {
    return Number(this.store.db.prepare('SELECT seq FROM spirit_chat_native WHERE session_id=?').get(this.mainId)?.seq ?? -1) + 1
  }

  absorbNative(events: readonly SessionEvent[], approvedReply: (sessionId: string, messageId: string) => ReplyDelivery | undefined, active: boolean): void {
    this.store.atomic(() => {
      const row = this.store.db.prepare('SELECT seq,legacy_through FROM spirit_chat_native WHERE session_id=?').get(this.mainId)
      if (!row) throw new Error('主会话聊天日志尚未初始化')
      let seq = Number(row.seq)
      for (const event of events) {
        if (event.seq <= seq) continue
        if (event.seq !== seq + 1) throw new Error('主会话聊天日志的原生序号不连续')
        const historical = event.seq <= Number(row.legacy_through)
        if (event.type === 'agent/inbox/spliced') {
          for (const item of event.data.inserted) {
            const request = this.store.db.prepare('SELECT 1 FROM spirit_chat_input WHERE message_id=?').get(item.id)
            if (request && item.source.kind === 'user' && !Object.hasOwn(item.source, 'principal')) {
              this.recordOwner(item.id, textOf(item.content), event.seq, event.time)
            }
          }
        } else if (event.type === 'user/message' && event.data.source.kind === 'user' && !Object.hasOwn(event.data.source, 'principal')) {
          this.recordOwner(event.data.id, textOf(event.data.content), event.seq, event.time)
        } else if (event.type === 'assistant/message' && !event.data.interrupted) {
          const { message, turn } = event.data
          const delivery = approvedReply(this.mainId, message.id)
          if (delivery || historical) {
            const text = textOf(message.content, '')
            if (text.trim()) {
              this.append({ id: this.nativeId(message.id), author: 'spirit', text, at: iso(event.time),
                source: { kind: 'native', sessionId: this.mainId, seq: event.seq, messageId: message.id, turn,
                  ...(historical && !delivery ? { historical: true } : {}) },
                ...(delivery?.tone ? { tone: delivery.tone } : {}) }, !!delivery && active && !historical)
            }
          }
        }
        seq = event.seq
      }
      if (seq !== Number(row.seq)) this.store.db.prepare('UPDATE spirit_chat_native SET seq=? WHERE session_id=?').run(seq, this.mainId)
    })
  }

  prepareInput(input: ChatSubmission): InputRecord {
    const value = ChatInput.parse(input)
    const messageId = `spirit-owner:${key(this.mainId, value.requestId)}`
    return this.store.atomic(() => {
      this.store.db.prepare('INSERT OR IGNORE INTO spirit_chat_input(request_id,message_id,text) VALUES (?,?,?)').run(value.requestId, messageId, value.text)
      const row = this.store.db.prepare('SELECT text,accepted FROM spirit_chat_input WHERE request_id=?').get(value.requestId)!
      if (row.text !== value.text) throw new Error('同一发送编号不能对应其他正文')
      return { ...value, messageId, accepted: row.accepted === 1 }
    })
  }

  page({ after, before, limit = 40 }: { after?: number; before?: number; limit?: number } = {}) {
    const rows = after === undefined
      ? this.store.db.prepare('SELECT cursor,value FROM spirit_chat_message WHERE (? IS NULL OR cursor<?) ORDER BY cursor DESC LIMIT ?').all(before ?? null, before ?? null, limit + 1)
      : this.store.db.prepare('SELECT cursor,value FROM spirit_chat_message WHERE cursor>? ORDER BY cursor LIMIT ?').all(after, limit + 1)
    const hasMore = rows.length > limit
    const records = rows.slice(0, limit)
    if (after === undefined) records.reverse()
    const messages = records.map(row => ({ ...JSON.parse(String(row.value)) as Omit<ConversationMessage, 'cursor'>, cursor: Number(row.cursor) }))
    return { mainId: this.mainId, messages, cursor: messages.at(-1)?.cursor ?? after ?? 0,
      nextBefore: after === undefined && hasMore ? (messages[0]?.cursor ?? null) : null, hasMore }
  }

  say(raw: z.infer<typeof SayInput>, source: TurnReference, turn: number): ConversationMessage {
    const input = SayInput.parse(raw)
    return this.store.atomic(() => {
      const at = iso(this.now())
      const value = { id: `say:${callKey(source)}`, author: 'spirit' as const, text: input.text, at,
        source: { kind: 'say' as const, ...source, turn }, ...(input.tone ? { tone: input.tone } : {}) }
      const message = this.append(value, true)
      if (message.text !== input.text || message.tone !== input.tone) throw new Error('同一发言调用不能发布其他内容')
      return message
    })
  }

  onDelivered(listener: (message: ConversationMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  express(input: z.infer<typeof ExpressionInput>, source: TurnReference, revision: number): Expression {
    return this.action('expression', input, source, () => {
      const value = { ...input, sessionId: source.sessionId, until: iso(this.now() + 8000) }
      this.setPresence('expression', value, revision)
      return value
    })
  }

  rest(input: z.infer<typeof RestInput>, source: TurnReference, revision: number): Rest | null {
    return this.action('rest', input, source, () => {
      if (input.kind === 'wake') { this.wake(); return null }
      const value = { kind: input.kind, until: iso(this.now() + input.minutes * 60_000) }
      this.setPresence('rest', value, revision)
      return value
    })
  }

  resting(revision: number): boolean { return !!this.getPresence<Rest>('rest', revision) }
  wake(): void { this.store.db.prepare("DELETE FROM spirit_chat_presence WHERE key='rest'").run() }

  beginWork(sessionId: string, label: string): () => void {
    const token = {}
    this.work.set(token, { sessionId, label })
    return () => { this.work.delete(token) }
  }

  beginMedia(media: Media): () => void {
    const token = {}
    this.media.set(token, media)
    return () => { this.media.delete(token) }
  }

  clearTransient(): void { this.work.clear(); this.media.clear() }

  presence(state: ChatState, revision: number, thinking: boolean, activeProject?: { sessionId: string; label: string }): Presence {
    if (state !== 'running') return { activity: { kind: state } }
    const work = [...this.work.values()].at(-1) ?? activeProject, media = [...this.media.values()].at(-1)
    const rest = this.getPresence<Rest>('rest', revision), expression = this.getPresence<Expression>('expression', revision)
    const activity: Presence['activity'] = media ? { kind: 'phone', media } : work ? { kind: 'working', ...work }
      : thinking ? { kind: 'thinking', sessionId: this.mainId } : rest ? rest : { kind: 'idle' }
    return { activity, ...(expression ? { expression } : {}) }
  }

  private action<T>(name: string, input: object, source: TurnReference, perform: () => T): T {
    return this.store.atomic(() => {
      const id = callKey(source), encoded = JSON.stringify({ name, input })
      const prior = this.store.db.prepare('SELECT input,result FROM spirit_chat_action WHERE id=?').get(id)
      if (prior) {
        if (prior.input !== encoded) throw new Error('同一次调用不能记录其他操作')
        return JSON.parse(String(prior.result)) as T
      }
      const result = perform()
      this.store.db.prepare('INSERT INTO spirit_chat_action VALUES (?,?,?)').run(id, encoded, JSON.stringify(result))
      return result
    })
  }

  private setPresence(name: string, value: Rest | Expression, revision: number): void {
    this.store.db.prepare('INSERT OR REPLACE INTO spirit_chat_presence VALUES (?,?,?)').run(name, revision, JSON.stringify(value))
  }

  private getPresence<T extends Rest | Expression>(name: string, revision: number): T | undefined {
    const row = this.store.db.prepare('SELECT value FROM spirit_chat_presence WHERE key=? AND revision=?').get(name, revision)
    const value = row && JSON.parse(String(row.value)) as T
    return value && Date.parse(value.until) > this.now() ? value : undefined
  }

  private nativeId(messageId: string): string { return `native:${key(this.mainId, messageId)}` }

  private recordOwner(messageId: string, text: string, seq: number, time: number): void {
    const row = this.store.db.prepare('SELECT text FROM spirit_chat_input WHERE message_id=?').get(messageId)
    if (row && row.text !== text) throw new Error('原生本人消息与原发送内容不一致')
    if (row) this.store.db.prepare('UPDATE spirit_chat_input SET accepted=1 WHERE message_id=?').run(messageId)
    if (text.trim()) this.append({ id: this.nativeId(messageId), author: 'owner', text, at: iso(time),
      source: { kind: 'native', sessionId: this.mainId, messageId, seq } }, false)
  }

  private append(value: Omit<ConversationMessage, 'cursor'>, publish: boolean): ConversationMessage {
    const result = this.store.db.prepare('INSERT INTO spirit_chat_message(id,author,session_id,turn,text,value) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .run(value.id, value.author, value.source.sessionId, value.source.turn ?? null, value.text, JSON.stringify(value))
    if (!result.changes) {
      const row = this.store.db.prepare('SELECT cursor,value FROM spirit_chat_message WHERE id=?').get(value.id)!
      return { ...JSON.parse(String(row.value)) as Omit<ConversationMessage, 'cursor'>, cursor: Number(row.cursor) }
    }
    const message = { ...value, cursor: Number(result.lastInsertRowid) }
    if (publish) for (const listener of this.listeners) this.store.afterCommit(() => listener(message))
    return message
  }
}
