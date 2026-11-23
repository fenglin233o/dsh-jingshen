import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { Store } from '../upstream/src/app/store.ts'
import { Conversation } from '../src/conversation.ts'

const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close() })
const epoch = Date.parse('2026-11-22T12:00:00.000Z')
const event = <T extends SessionEvent['type']>(seq: number, type: T, data: object) => ({ seq, type, time: epoch + seq, data }) as SessionEvent
const ownerMessage = (id: string, text: string, source: object = { kind: 'user' }) => ({ id, source, content: [{ type: 'text', text }] })
const modelMessage = (id: string, text: string, turn: number, interrupted = false) => ({ message: {
  id, content: [{ type: 'reasoning', text: '内部内容' }, { type: 'text', text }],
}, turn, ...(interrupted ? { interrupted: true } : {}) })
const source = (callId: string, sessionId = 'main') => ({ sessionId, startSeq: 10, throughSeq: 18, callId })
const noReply = () => undefined
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'spirit-chat-')), store = new Store(join(dir, 'chat.sqlite'))
  let now = epoch
  const chat = new Conversation(store, 'main', () => now)
  cleanup.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
  return { chat, store, advance: (time: number) => { now += time } }
}

describe('精神主聊天', () => {
  it('幂等提交真实本人输入；持久发送与原生入场只显示一次', () => {
    const { chat, store } = fixture()
    chat.beginNative(-1)
    const input = { requestId: 'client-1', text: ' 本人的原话 ' }
    const pending = chat.prepareInput(input)
    expect(pending).toMatchObject({ accepted: false, text: ' 本人的原话 ' })
    expect(chat.page().messages).toEqual([])
    const message = ownerMessage(pending.messageId, pending.text)
    chat.absorbNative([event(0, 'agent/inbox/spliced', { inserted: [message] }), event(1, 'user/message', message),
      event(2, 'user/message', ownerMessage('delegated', '别的主体的消息', { kind: 'user', principal: 'delegate' }))], noReply, true)
    const recovered = new Conversation(store, 'main')
    recovered.beginNative(50)
    expect(recovered.nativeOffset()).toBe(3)
    expect(recovered.prepareInput(input)).toEqual({ ...pending, accepted: true })
    expect(() => recovered.prepareInput({ ...input, text: '改写' })).toThrow(/不能对应/)
    expect(recovered.page().messages).toMatchObject([{ author: 'owner', text: ' 本人的原话 ', source: { kind: 'native', messageId: pending.messageId, seq: 0 } }])
  })

  it('公开聊天只接纳旧公开记录、新的原生投递事实和明确说出的独立短消息', () => {
    const { chat } = fixture(), delivered = vi.fn()
    chat.onDelivered(delivered)
    chat.beginNative(1)
    chat.absorbNative([event(0, 'user/message', ownerMessage('previous-owner', '以前的问题')), event(1, 'assistant/message', modelMessage('previous', '以前的回答', 1))], noReply, true)
    expect(delivered).not.toHaveBeenCalled()

    const first = chat.say({ text: '同一轮的话', tone: 'warm' }, source('a'), 2)
    expect(chat.say({ text: '同一轮的话', tone: 'warm' }, source('a'), 2)).toEqual(first)
    expect(() => chat.say({ text: '改写', tone: 'warm' }, source('a'), 2)).toThrow(/不能发布/)
    chat.say({ text: '同一轮的话' }, source('b'), 2)
    chat.absorbNative([
      event(2, 'assistant/message', modelMessage('private', '未发布', 2)),
      event(3, 'assistant/message', modelMessage('independent-repeat', '同一轮的话', 2)),
      event(4, 'assistant/message', modelMessage('interrupted-answer', '已中断', 2, true)),
      event(5, 'assistant/message', modelMessage('delivered', '另一个公开回答', 3)),
      event(6, 'user/message', ownerMessage('system', '自主调度的上下文', { kind: 'spirit' })),
    ], (_session, id) => id === 'private' ? undefined : { tone: 'gentle' }, true)
    expect(chat.page().messages.map(row => row.text)).toEqual(['以前的问题', '以前的回答', '同一轮的话', '同一轮的话', '同一轮的话', '另一个公开回答'])
    expect(delivered).toHaveBeenCalledTimes(4)
    expect(delivered.mock.calls[3]?.[0]).toMatchObject({ tone: 'gentle', source: { kind: 'native', messageId: 'delivered' } })
    const latest = chat.page({ limit: 2 })
    const older = chat.page({ before: latest.nextBefore!, limit: 4 })
    expect(older.messages).toHaveLength(4)
    expect(older.hasMore).toBe(false)
    expect(chat.page({ after: older.cursor }).messages).toEqual(latest.messages)
  })

  it('真实工具和媒体活动只在实际生命周期显示，表情与有限休息保持独立', () => {
    const { chat, advance } = fixture()
    expect(chat.presence('running', 3, false)).toEqual({ activity: { kind: 'idle' } })
    const rest = chat.rest({ kind: 'sleep', minutes: 1 }, source('sleep'), 3)
    chat.express({ kind: 'wave' }, source('expression', 'project'), 3)
    expect(chat.presence('running', 3, false)).toMatchObject({ activity: { kind: 'sleep' }, expression: { kind: 'wave' } })
    expect(chat.presence('paused', 4, false)).toEqual({ activity: { kind: 'paused' } })
    expect(chat.resting(4)).toBe(false)
    advance(8_001)
    const stopWork = chat.beginWork('project', '研究记录')
    expect(chat.presence('running', 3, false)).toEqual({ activity: { kind: 'working', sessionId: 'project', label: '研究记录' } })
    const stopMedia = chat.beginMedia({ kind: 'audio', state: 'playing', id: 'real-playback' })
    expect(chat.presence('running', 3, false)).toMatchObject({ activity: { kind: 'phone', media: { id: 'real-playback' } } })
    stopMedia(); stopWork()
    expect(chat.rest({ kind: 'sleep', minutes: 1 }, source('sleep'), 3)).toEqual(rest)
    advance(52_000)
    expect(chat.resting(3)).toBe(false)
    expect(chat.presence('running', 3, true)).toMatchObject({ activity: { kind: 'thinking' } })
    chat.rest({ kind: 'idle', minutes: 2 }, source('daydream'), 3)
    expect(chat.resting(3)).toBe(true)
    chat.wake()
    expect(chat.resting(3)).toBe(false)
  })
})
