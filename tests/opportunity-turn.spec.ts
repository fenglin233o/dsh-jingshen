import { describe, expect, it } from 'vitest'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { OpportunityTurn } from '../src/opportunity-turn.ts'

function message(source: UserMessage['source']): UserMessage {
  return { role: 'user', id: MessageId(JSON.stringify(source)), content: [{ type: 'text', text: 'text' }], source }
}
const dispatch = 'spirit-opportunity-example'
const background = message({ kind: 'spirit', requestId: dispatch, fromSessionId: 'main', targetSessionId: 'main', delivery: 'queue', form: 'relay' })
const note = message({ kind: 'spirit', requestId: 'context', targetSessionId: 'main', delivery: 'context' })
const user = message({ kind: 'user' })
function create() {
  const valid = new Set([dispatch])
  const turn = new OpportunityTurn('main', 'main', id => { if (!valid.has(id)) throw new Error('过期') })
  return { valid, turn }
}
describe('native opportunity turn admission', () => {
  it('rechecks work at tool execution and on a continuation carrying only context', () => {
    const { valid, turn } = create()
    expect(turn.admit(3, [background])).toEqual([background])
    valid.clear()
    expect(() => turn.assertCurrent()).toThrow('过期')
    expect(() => turn.admit(3, [note])).toThrow('过期')
    expect(turn.admit(4, [user])).toEqual([user])
  })
  it('discards a stale dispatch alongside a direct message without rejecting that message', () => {
    const { valid, turn } = create()
    valid.clear()
    expect(turn.admit(5, [user, note, background])).toEqual([user, note])
    expect(() => turn.assertCurrent()).not.toThrow()
    expect(() => turn.admit(6, [note, background])).toThrow('过期')
  })
  it('allows fresh substantive steering to take over the native turn', () => {
    const { valid, turn } = create()
    turn.admit(1, [background])
    valid.clear()
    expect(turn.admit(1, [user])).toEqual([user])
    expect(() => turn.admit(1, [])).not.toThrow()
  })
  it('derives authority from claimed inputs that survive host admission', () => {
    const { valid, turn } = create()
    valid.clear()
    expect(() => turn.admit(2, [background, user], [background, note])).toThrow('过期')
    expect(() => turn.admit(3, [background], [background, user])).toThrow('过期')
  })
  it('closes only the actual turn and consumes its dispatch references once', () => {
    const { turn } = create()
    turn.admit(8, [background])
    expect(turn.finish(7)).toEqual([])
    expect(turn.finish(8)).toEqual([dispatch])
    expect(turn.finish(8)).toEqual([])
  })
})
