import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { Store } from '../upstream/src/app/store.ts'
import { Continuity, publicSessionPage } from '../src/continuity.ts'

function event(type: string, seq: number, data: Record<string, unknown>) {
  return { type, seq, time: seq + 100, data }
}

it('shares committed orientation revisions and replays the same native tool call idempotently', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spirit-continuity-'))
  const store = new Store(join(directory, 'continuity.sqlite'))
  try {
    const first = new Continuity(store), other = new Continuity(store)
    const call = { sessionId: 'owner-session', startSeq: 2, throughSeq: 8, callId: 'model-call-0' }
    const draft = { expectedRevision: 0, outlook: '核对证据来源后再决定', reason: '两次来源记录互相矛盾', attention: 'quiet' as const }
    expect(first.revise(draft, call)).toMatchObject({ revision: 1, source: call, attributedTo: 'model' })
    expect(other.current()).toMatchObject({ revision: 1, attention: 'quiet' })
    expect(other.revise(draft, call).revision).toBe(1)
    expect(() => other.revise(draft, { ...call, sessionId: 'other-session' })).toThrow(/现行版本 1/)
    expect(() => other.revise({ ...draft, outlook: '伪造最初的修订' }, call)).toThrow(/同一调用/)
    const nextTurn = { ...call, startSeq: 10, throughSeq: 18 }
    other.revise({ expectedRevision: 1, outlook: '保留分歧供检验', reason: '证据仍不同' }, nextTurn)
    expect(new Continuity(store).history(0, 10).map(row => row.revision)).toEqual([2, 1])
    expect(first.current().attention).toBe('quiet')
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})

it('links exact native turns while keeping only visible excerpts and preserving source kinds', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spirit-continuity-'))
  const store = new Store(join(directory, 'continuity.sqlite'))
  try {
    const continuity = new Continuity(store), sessionId = 'owner-session'
    const observe = (startSeq: number | null, turn: number, raw: ReturnType<typeof event>) => {
      continuity.observe(sessionId, startSeq, turn, raw as unknown as SessionEvent)
    }
    observe(0, 1, event('user/message', 1, { id: 'relay', source: { kind: 'spirit' }, content: [{ type: 'text', text: 'outside' }] }))
    observe(0, 1, event('user/message', 2, { id: 'delegated', source: { kind: 'user', principal: 'delegate' }, content: [{ type: 'text', text: 'outside' }] }))
    observe(null, 1, event('turn/end', 3, { turn: 1, reason: { kind: 'completed' } }))
    expect(continuity.recent(5)).toEqual([])

    const messages = [event('turn/start', 4, { turn: 2 }),
      event('user/message', 5, { id: 'owner', source: { kind: 'user' }, content: [{ type: 'text', text: '本人的原话'.repeat(1000) }] }),
      event('assistant/attempt', 6, { stream: [{ type: 'reasoning', text: 'PRIVATE-ATTEMPT' }] }),
      event('assistant/message', 7, { turn: 2, step: 1, stream: [{ type: 'reasoning', text: 'PRIVATE-STREAM' }],
        message: { content: [{ type: 'thinking', text: 'PRIVATE-REASONING' }, { type: 'text', text: '公开回答与分歧' }] } }),
      event('tool/call', 8, { turn: 2, step: 1, callId: 'turn-call', name: 'spirit_orient', arguments: '{"reason":"公开理由"}' }),
      event('tool/result', 9, { turn: 2, step: 1, meta: 'PRIVATE-META', message: { toolCallId: 'turn-call', content: [{ type: 'text', text: '已生效' }] } }),
      event('turn/end', 10, { turn: 2, reason: { kind: 'completed' } })]
    for (const raw of messages.slice(0, -1)) observe(4, 2, raw)
    continuity.rememberTurn({ sessionId, startSeq: 4, throughSeq: 8, callId: 'turn-call' }, 2)
    observe(null, 2, messages.at(-1)!)
    expect(continuity.recent(1)[0]).toMatchObject({ sessionId, startSeq: 4, throughSeq: 10, assistantExcerpt: '公开回答与分歧', outcome: 'completed' })
    expect(String(continuity.recent(1)[0]?.ownerExcerpt)).toHaveLength(360)
    expect(new Continuity(store).throughSeq(sessionId, 4)).toBe(10)

    const page = publicSessionPage({ cursor: 10, hasMore: false, nextBeforeSeq: null,
      records: messages.map(raw => ({ type: 'event' as const, event: { ...raw, data: JSON.parse(JSON.stringify(raw.data)) } })) }, 4)
    expect(page.records.map(item => item.event.seq)).toEqual([4, 5, 7, 8, 9, 10])
    const visible = JSON.stringify(page)
    expect(visible).toContain('公开理由')
    expect(visible).toContain('已生效')
    expect(visible).not.toContain('PRIVATE')
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})
