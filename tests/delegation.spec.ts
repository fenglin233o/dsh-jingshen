import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import { expect, test, vi } from 'vitest'
import { SpiritDelegation } from '../src/delegation.ts'

test('Cordis unload discards native late settlement and only cancels the managed tree', async () => {
  const host = new Context()
  const makeAgent = (id: string) => {
    const nextTurn: UserMessage[] = []
    return {
      id: id as SessionId,
      status: 'idle',
      session: { append: vi.fn() },
      inbox: {
        nextTurn, nextStep: [],
        remove(messageId: MessageId) {
          const index = nextTurn.findIndex(item => item.id === messageId)
          if (index === -1) return false
          nextTurn.splice(index, 1)
          return true
        },
      },
      cancel: vi.fn(),
    }
  }
  const root = makeAgent('spirit')
  const local = makeAgent('worker')
  const otherRoot = makeAgent('ordinary')
  const otherChild = makeAgent('ordinary-worker')
  const agents = new Map([root, local, otherRoot, otherChild].map(agent => [agent.id, agent]))
  const roots = new Map([[local.id, root], [otherChild.id, otherRoot]])
  host.provide('agents', { get: (id: SessionId) => agents.get(id) })
  host.provide('subagents', { rootOf: (agent: Agent) => roots.get(agent.id) ?? agent })
  host.provide('approval', { overrideOf: () => 'never' })
  const killJob = vi.fn()
  host.provide('jobs', { list: () => [{ id: 'owned-job', owner: local.id, status: 'running' },
    { id: 'other-job', owner: otherChild.id, status: 'running' }], kill: killJob })
  const stopped = Promise.withResolvers<void>()
  local.cancel.mockImplementation(() => { stopped.resolve() })
  const fiber = host.plugin(ctx => {
    new SpiritDelegation(ctx, {
      owns: agent => agent.id === root.id,
      revision: () => 1,
      assert: () => {},
    })
  })
  await fiber
  const run = { id: local.id, parentSessionId: root.id, provider: 'spawn', local: true, runId: 'run' } as SubagentRunInfo
  const otherRun = { ...run, id: otherChild.id, parentSessionId: otherRoot.id, runId: 'other' } as SubagentRunInfo
  host.emit('subagent/start', run)
  host.emit('subagent/start', otherRun)
  const unloading = fiber.dispose()
  await stopped.promise

  const late: UserMessage = {
    role: 'user', id: MessageId('late'), content: [{ type: 'text', text: 'stale result' }],
    source: { kind: 'subagent-settled', form: 'notice', senderSessionId: local.id, summary: 'stale result' },
  }
  root.inbox.nextTurn.push(late)
  host.emit('agent/inbox/inserted', { agent: root as unknown as Agent, message: late })
  expect(root.inbox.nextTurn).toEqual([])
  host.emit('agent/status', { agent: root as unknown as Agent, status: 'running' })
  host.emit('subagent/end', { ...run, stopReason: 'aborted' })
  await unloading
  expect(root.cancel).toHaveBeenCalledWith({ kind: 'parent' }, { keepInbox: true })
  expect(local.cancel).toHaveBeenCalledWith({ kind: 'parent' }, { keepInbox: false })
  expect(killJob.mock.calls[0]).toEqual(['owned-job', local.id, expect.stringContaining('权限或活动状态已改变')])
  expect(killJob.mock.calls.every(([id]) => id === 'owned-job')).toBe(true)
  expect(killJob.mock.invocationCallOrder[0]).toBeLessThan(local.cancel.mock.invocationCallOrder[0]!)
  expect(otherRoot.cancel).not.toHaveBeenCalled()
  expect(otherChild.cancel).not.toHaveBeenCalled()
})
