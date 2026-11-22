import { describe, expect, it, vi } from 'vitest'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionPage } from '@deepseek-ai/dsh-api-session-controller'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { HarnessBridge, preserveManagedBlankPreset, spiritMessageId, type HarnessBridgeContext, type HarnessBridgeOptions, type PresetContinuityContext } from '../src/harness-bridge.ts'

function fixture(options: HarnessBridgeOptions = {}) {
  const agents = new Map<string, Agent>()
  const logs = new Map<string, SessionEvent[]>()
  const presets = new Map<string, string>()
  const workspaces = new Map<string, Workspace>()
  const calls = { followup: vi.fn(), steer: vi.fn(), inject: vi.fn(), cancel: vi.fn(), select: vi.fn(), close: vi.fn() }
  const makeAgent = (id: string, cwd = '/tmp/workspace'): Agent => {
    const events = logs.get(id) ?? []
    logs.set(id, events)
    const nextTurn: UserMessage[] = [], nextStep: UserMessage[] = []
    const append = (type: string, data: unknown) => events.push({ type, data, seq: events.length, time: 1 } as SessionEvent)
    let selected: ModelSelection | undefined
    const send = (message: UserMessage, target: 'next-turn' | 'next-step') => {
      const queue = target === 'next-turn' ? nextTurn : nextStep
      append('agent/inbox/spliced', { target, start: queue.length, removedCount: 0, inserted: [message] })
      queue.push(message)
    }
    const agent = {
      id, session: { id, header: { cwd } }, status: 'idle', inbox: { nextTurn, nextStep },
      model: { current: () => selected, select: (value: ModelSelection) => { calls.select(id, value); selected = value; append('model/selection', value) } },
      followup: (message: UserMessage) => { calls.followup(id, message); send(message, 'next-turn') },
      steer: (message: UserMessage) => { calls.steer(id, message); send(message, 'next-step') },
      inject: (message: UserMessage) => { calls.inject(id, message); send(message, 'next-step') },
      cancel: (cause: unknown, { keepInbox }: { keepInbox: boolean }) => {
        calls.cancel(id, cause, { keepInbox })
        if (!keepInbox) for (const [target, queue] of [['next-turn', nextTurn], ['next-step', nextStep]] as const) {
          if (queue.length) append('agent/inbox/spliced', { target, start: 0, removedCount: queue.length, inserted: [], outcome: 'canceled' })
          queue.splice(0)
        }
      },
      whenIdle: vi.fn(async () => {}),
    } as unknown as Agent
    agents.set(id, agent)
    return agent
  }
  const resolveAgent = vi.fn(async (id: string) => agents.has(id) ? { agent: agents.get(id)! } : { error: { code: 'session/not-found' } })
  const create = vi.fn(async (request: { sessionId?: string; cwd?: string }) => {
    const sessionId = request.sessionId ?? 'new-session'
    makeAgent(sessionId, request.cwd)
    return { sessionId, agentPreset: 'dsh-spirit' }
  })
  const flush = vi.fn(async () => {})
  const open = vi.fn(async (id: string) => ({
    read: vi.fn(async (offset: number, count: number) => ({ events: logs.get(id)!.slice(offset, offset + count), eventState: 'frozen' })),
    [Symbol.asyncDispose]: async () => { calls.close(id) },
  }))
  const list = vi.fn(async () => ({ items: Array.from(agents.keys(), sessionId => ({ sessionId, agentAvailable: true, running: false, blank: true, updatedAt: 1 })) }))
  const page = vi.fn<HarnessBridgeContext['sessionController']['page']>(async () => ({ cursor: 7, records: [{ type: 'event', event: { type: 'user/message', seq: 7, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'original text' }] } } }], hasMore: true }))
  const search = vi.fn(async () => ({ items: [{ sessionId: 'a', snippet: 'query result' }], hasMore: true }))
  const catalog = { default: { provider: 'test', model: 'base' }, routableProviders: ['test'], groups: [{ id: 'test', name: 'Test', models: [{ id: 'base', name: 'Base', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } }] }], failures: [{ id: 'offline', name: 'Offline', message: 'unavailable' }] }
  const resolveCallConfig = vi.fn(async (value: ModelSelection) => ({ ...value, reasoningEffort: value.reasoningEffort ?? 'high' }))
  const permissionResolve = vi.fn((name: string) => {
    if (name === 'danger-full-access') return { sandbox: 'danger-full-access', approval: 'never' }
    if (name === 'workspace-write') return { sandbox: 'workspace-write', approval: 'ask' }
    throw new Error('Unknown permission preset')
  })
  const setPermission = vi.fn((session: { id: string }, name: string) => { permissionResolve(name); presets.set(session.id, name) })
  const rename = vi.fn(async (input: { sessionId: string; title: string }) => ({ title: input.title, seq: 0 }))
  const workspaceCreate = vi.fn(async (path: string, title = 'Workspace') => {
    const sessionIds: string[] = []
    const workspace = { id: `workspace-${workspaces.size}`, path, title, sessionIds,
      attachSession: vi.fn(async (id: string) => { if (!sessionIds.includes(id)) sessionIds.push(id) }) } as unknown as Workspace
    workspaces.set(path, workspace)
    return workspace
  })
  const workspaceResolve = vi.fn(async (path: string) => workspaces.get(path))
  const ctx = {
    agents: { get: (id: string) => agents.get(id) },
    sessionController: { resolveAgent, create, list, page, search, rename, modelCatalog: vi.fn(async () => catalog) },
    sessionPersistence: { flush, open },
    workspaceRegistry: { create: workspaceCreate, resolveByPath: workspaceResolve },
    permissionPresets: { resolve: permissionResolve, current: (session: { id: string }) => presets.get(session.id) ?? 'workspace-write', set: setPermission,
      catalog: () => ({ options: [{ value: 'workspace-write', name: 'Workspace write' }, { value: 'danger-full-access', name: 'Full access' }], defaultOptions: [], defaultPreset: 'workspace-write' }) },
    llm: { resolveCallConfig },
  } as unknown as HarnessBridgeContext
  return { bridge: new HarnessBridge(ctx, options), ctx, agents, logs, makeAgent, calls, resolveAgent, create, flush, open, list, page, search, catalog, resolveCallConfig, setPermission, rename, workspaces, workspaceCreate, workspaceResolve }
}

describe('Harness 0.2.2-rc.5 native Spirit bridge', () => {
  const record = (seq: number, type: string, data: SessionPage['records'][number]['event']['data']): SessionPage['records'][number] =>
    ({ type: 'event', event: { seq, type, time: 1, data } })
  const user = (id: string, kind = 'user', principal?: unknown) => ({ role: 'user', id, content: [{ type: 'text', text: 'Owner request' }],
    source: { kind, ...(principal === undefined ? {} : { principal: principal as string }) } })

  it('preserves only an omitted preset on managed blank reuse, including the owners own later choice', async () => {
    const f = fixture(); f.makeAgent('managed')
    let recorded = 'dsh-spirit', lastTurn = 0
    const original = vi.fn(async function(this: unknown, request: { sessionId?: string; agentPreset?: string }) {
      expect(this).toBe(f.ctx.sessionController)
      recorded = request.agentPreset ?? 'standard'
      return { sessionId: (request.sessionId ?? 'new-session') as never, agentPreset: recorded }
    })
    f.ctx.sessionController.create = original as PresetContinuityContext['sessionController']['create']
    const ctx = { sessionController: f.ctx.sessionController,
      agents: { turnBoundaryOf: () => ({ openTurnStartSeq: null, lastTurn }) },
      agentPresets: { presetForSession: () => recorded } } as unknown as PresetContinuityContext
    const dispose = preserveManagedBlankPreset(ctx, id => id === 'managed')
    await ctx.sessionController.create({ sessionId: 'managed' as never, cwd: '/tmp/workspace' })
    expect(original).toHaveBeenLastCalledWith({ sessionId: 'managed', cwd: '/tmp/workspace', agentPreset: 'dsh-spirit' })
    await ctx.sessionController.create({ sessionId: 'managed' as never, agentPreset: 'my-custom-preset' })
    await ctx.sessionController.create({ sessionId: 'managed' as never })
    expect(original).toHaveBeenLastCalledWith({ sessionId: 'managed', agentPreset: 'my-custom-preset' })
    await ctx.sessionController.create({ sessionId: 'unmanaged' as never })
    expect(original).toHaveBeenLastCalledWith({ sessionId: 'unmanaged' })
    lastTurn = 1
    await ctx.sessionController.create({ sessionId: 'managed' as never })
    expect(original).toHaveBeenLastCalledWith({ sessionId: 'managed' })
    dispose()
    expect(ctx.sessionController.create).toBe(original)
  })

  it('disposes only its own preset compatibility wrapper and does not change a call after disposal', async () => {
    const f = fixture(); const agent = f.makeAgent('managed')
    const resolution = Promise.withResolvers<{ agent: Agent }>()
    f.resolveAgent.mockReturnValueOnce(resolution.promise)
    const ctx = { sessionController: f.ctx.sessionController,
      agents: { turnBoundaryOf: () => ({ openTurnStartSeq: null, lastTurn: 0 }) },
      agentPresets: { presetForSession: () => 'dsh-spirit' } } as unknown as PresetContinuityContext
    const dispose = preserveManagedBlankPreset(ctx, () => true)
    const pending = ctx.sessionController.create({ sessionId: 'managed' as never })
    const replacement = vi.fn(async () => ({ sessionId: 'replacement' as never }))
    ctx.sessionController.create = replacement
    dispose(); resolution.resolve({ agent }); await pending
    expect(ctx.sessionController.create).toBe(replacement)
    expect(f.create).toHaveBeenLastCalledWith({ sessionId: 'managed' })
  })

  it('reads existing sessions without resuming them and reports bounded list/history cursors', async () => {
    const f = fixture()
    for (let i = 0; i < 55; i++) f.makeAgent(`session-${i}`)
    const list = await f.bridge.list()
    expect(list).toMatchObject({ total: 55, offset: 0, hasMore: true, nextOffset: 50 })
    expect(list.items).toHaveLength(50)
    expect(await f.bridge.list({ offset: 50 })).toMatchObject({ hasMore: false, nextOffset: null })
    const page = await f.bridge.read('session-1', { beforeSeq: 10, throughSeq: 20, maxMessages: 3 })
    expect(page).toMatchObject({ sessionId: 'session-1', hasMore: true, nextBeforeSeq: 7 })
    expect(page.records[0]!.event.data).toEqual({ source: { kind: 'user' }, content: [{ type: 'text', text: 'original text' }] })
    expect(f.page).toHaveBeenCalledWith({ address: { kind: 'session', sessionId: 'session-1' }, beforeSeq: 10, throughSeq: 20, maxMessages: 3 }, expect.any(AbortSignal))
    expect(await f.bridge.search('query')).toMatchObject({ hasMore: true })
    expect(f.resolveAgent).not.toHaveBeenCalled()
    await expect(f.bridge.list({ limit: 201 })).rejects.toThrow('limit')
  })

  it('sends truthfully attributed messages through native queue, steering and non-waking context paths', async () => {
    const f = fixture(), agent = f.makeAgent('existing')
    await f.bridge.post({ sessionId: 'existing', requestId: 'queue', text: 'Hello', fromSessionId: 'main' })
    await f.bridge.post({ sessionId: 'existing', requestId: 'steer', text: 'Update', mode: 'steer' })
    await f.bridge.post({ sessionId: 'existing', requestId: 'context', text: 'Evidence', mode: 'context', summary: 'Observation' })
    expect(f.calls.followup).toHaveBeenCalledTimes(1)
    expect(f.calls.steer).toHaveBeenCalledTimes(1)
    expect(f.calls.inject).toHaveBeenCalledTimes(1)
    const queued = agent.inbox.nextTurn[0]!
    expect(queued.source).toEqual({ kind: 'spirit', form: 'relay', requestId: 'queue', targetSessionId: 'existing', fromSessionId: 'main', delivery: 'queue' })
    expect(queued.content[0]).toMatchObject({ text: expect.stringContaining('精神（Spirit）发送') })
    expect(Object.isFrozen(queued)).toBe(true)
    expect(agent.inbox.nextStep[1]!.source).toMatchObject({ kind: 'spirit', form: 'notice', summary: 'Observation', delivery: 'context' })
    expect(f.calls.close).toHaveBeenCalledTimes(3)
  })

  it('serializes concurrent duplicate posts and rejects reuse of an identity with different content', async () => {
    const f = fixture(); f.makeAgent('a')
    const input = { sessionId: 'a', requestId: 'same', text: 'once' }
    const results = await Promise.all([f.bridge.post(input), f.bridge.post(input), f.bridge.post(input)])
    expect(results.map(item => item.duplicate)).toEqual([false, true, true])
    expect(f.calls.followup).toHaveBeenCalledTimes(1)
    expect(results[0]!.messageId).toBe(spiritMessageId('a', 'same'))
    await expect(f.bridge.post({ ...input, text: 'changed' })).rejects.toThrow('different content')
    await expect(f.bridge.post({ ...input, mode: 'steer' })).rejects.toThrow('different content')
  })

  it('does not resurrect an admitted message after stop and restore, even when it never entered the transcript', async () => {
    const f = fixture(); f.makeAgent('a')
    const input = { sessionId: 'a', requestId: 'stopped', text: 'work' }
    await f.bridge.post(input)
    await f.bridge.stop('a')
    f.makeAgent('a') // new live object restored from the same durable log, with an empty inbox
    const restarted = new HarnessBridge(f.ctx)
    expect(await restarted.post(input)).toMatchObject({ duplicate: true, accepted: true })
    expect(f.calls.followup).toHaveBeenCalledTimes(1)
    expect(f.logs.get('a')!.some(event => event.type === 'user/message')).toBe(false)
    expect(f.calls.cancel).toHaveBeenCalledWith('a', { kind: 'hook', reason: 'Spirit stop request' }, { keepInbox: false })
  })

  it('retries failed durability acknowledgement without sending twice', async () => {
    const f = fixture(); f.makeAgent('a')
    f.flush.mockResolvedValueOnce().mockRejectedValueOnce(new Error('disk unavailable'))
    const input = { sessionId: 'a', requestId: 'flush-failure', text: 'work' }
    await expect(f.bridge.post(input)).rejects.toThrow('disk unavailable')
    expect(await f.bridge.post(input)).toMatchObject({ duplicate: true })
    expect(f.calls.followup).toHaveBeenCalledTimes(1)
  })

  it('compares durable messages independently of JSON property order', async () => {
    const f = fixture(); f.makeAgent('a')
    const input = { sessionId: 'a', requestId: 'reordered', text: 'work', fromSessionId: 'main' }
    await f.bridge.post(input)
    const log = f.logs.get('a')!
    const first = log[0]!
    if (first.type !== 'agent/inbox/spliced') throw new Error('missing admission')
    const message = first.data.inserted[0]!
    const reordered = { ...message, source: Object.fromEntries(Object.entries(message.source).reverse()) }
    log[0] = { ...first, data: { ...first.data, inserted: [reordered] } } as SessionEvent
    f.makeAgent('a')
    expect(await new HarnessBridge(f.ctx).post(input)).toMatchObject({ duplicate: true })
    expect(f.calls.followup).toHaveBeenCalledTimes(1)
  })

  it('uses native session-only model selection, preserves omitted effort, and propagates unsupported choices', async () => {
    const f = fixture(); f.makeAgent('a')
    expect(await f.bridge.models()).toEqual(f.catalog)
    expect(await f.bridge.selectModel('a', { provider: 'test', model: 'base' })).toEqual({ provider: 'test', model: 'base' })
    expect(f.calls.select).toHaveBeenLastCalledWith('a', { provider: 'test', model: 'base' })
    await f.bridge.selectModel('a', { provider: 'test', model: 'base', reasoningEffort: 'low' })
    expect(f.calls.select).toHaveBeenLastCalledWith('a', { provider: 'test', model: 'base', reasoningEffort: 'low' })
    f.resolveCallConfig.mockRejectedValueOnce(new Error('unsupported effort'))
    await expect(f.bridge.selectModel('a', { provider: 'test', model: 'base', reasoningEffort: 'unavailable' })).rejects.toThrow('unsupported effort')
    expect(f.calls.select).toHaveBeenCalledTimes(2)
  })

  it('uses the actual session identity returned by native creation and preflights invalid selections', async () => {
    const f = fixture()
    f.create.mockImplementationOnce(async () => { f.makeAgent('replacement'); return { sessionId: 'replacement', agentPreset: 'dsh-spirit' } })
    const created = await f.bridge.create({ sessionId: 'nonblank-requested', cwd: '/tmp/workspace', title: 'New conversation', agentPreset: 'dsh-spirit', permissionPreset: 'danger-full-access', model: { provider: 'test', model: 'base' } })
    expect(created).toMatchObject({ sessionId: 'replacement', permissionPreset: 'danger-full-access' })
    expect(f.setPermission).toHaveBeenCalledWith(expect.objectContaining({ id: 'replacement' }), 'danger-full-access')
    expect(f.calls.select).toHaveBeenCalledWith('replacement', { provider: 'test', model: 'base' })
    expect(f.rename).toHaveBeenCalledWith({ sessionId: 'replacement', title: 'New conversation' })
    await expect(f.bridge.create({ permissionPreset: 'imaginary' })).rejects.toThrow('Unknown permission preset')
    await expect(f.bridge.create({ cwd: 'relative' })).rejects.toThrow('absolute')
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.workspaceCreate).toHaveBeenCalledWith('/tmp/workspace', 'New conversation')
    expect(f.workspaces.get('/tmp/workspace')?.sessionIds).toEqual(['replacement'])
  })

  it('repairs native Workspace membership without changing the actual session directory or existing workspace title', async () => {
    const f = fixture(); f.makeAgent('old-main', '/tmp/existing-spirit')
    const first = await f.bridge.ensureWorkspace('old-main', { title: '精神' })
    f.makeAgent('second', '/tmp/existing-spirit')
    const second = await f.bridge.ensureWorkspace('second', { title: 'Do not retitle' })
    expect(first).toMatchObject({ path: '/tmp/existing-spirit', title: '精神' })
    expect(second).toMatchObject({ workspaceId: first.workspaceId, title: '精神' })
    expect(f.workspaceCreate).toHaveBeenCalledTimes(1)
    expect(f.workspaces.get('/tmp/existing-spirit')?.sessionIds).toEqual(['old-main', 'second'])
    expect(f.calls.select).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it('does not attach a workspace after owner authority changes during native lookup', async () => {
    let allowed = true
    const f = fixture({ authorize: () => { if (!allowed) throw new Error('revoked') } }); f.makeAgent('a')
    const workspace = await f.workspaceCreate('/tmp/workspace', 'Existing')
    f.workspaceResolve.mockImplementationOnce(async () => { allowed = false; return workspace })
    await expect(f.bridge.ensureWorkspace('a')).rejects.toThrow('revoked')
    expect(workspace.attachSession).not.toHaveBeenCalled()
    expect(f.workspaceCreate).toHaveBeenCalledTimes(1)
  })

  it('rechecks authority after asynchronous preparations and observes disposal and aborts', async () => {
    let allowed = true
    const authorize = vi.fn(() => { if (!allowed) throw new Error('owner revoked authority') })
    const f = fixture({ authorize }); f.makeAgent('a')
    f.flush.mockImplementationOnce(async () => { allowed = false })
    await expect(f.bridge.post({ sessionId: 'a', requestId: 'revoked', text: 'work' })).rejects.toThrow('revoked')
    expect(f.calls.followup).not.toHaveBeenCalled()
    expect(authorize).toHaveBeenLastCalledWith('session.post', expect.objectContaining({ sessionId: 'a', requestId: 'revoked', mode: 'queue' }))
    allowed = true
    f.flush.mockImplementationOnce(async () => { f.agents.delete('a') })
    await expect(f.bridge.post({ sessionId: 'a', requestId: 'disposed', text: 'work' })).rejects.toThrow('disposed or replaced')
    const canceled = new AbortController(); canceled.abort(new Error('canceled'))
    await expect(f.bridge.post({ sessionId: 'a', requestId: 'abort', text: 'work', signal: canceled.signal })).rejects.toThrow('canceled')
  })

  it('uses the configured permission catalog and native setters without inventing presets', async () => {
    const f = fixture(); f.makeAgent('a')
    expect(f.bridge.permissions().options.map(item => item.value)).toEqual(['workspace-write', 'danger-full-access'])
    expect(await f.bridge.setPermission('a', 'danger-full-access')).toEqual({ current: 'danger-full-access' })
    await expect(f.bridge.setPermission('a', 'custom')).rejects.toThrow('Unknown permission preset')
    expect(f.setPermission).toHaveBeenCalledTimes(1)
  })

  it('can stop without waiting on its own model turn and never resumes a cold session to stop it', async () => {
    const f = fixture(), agent = f.makeAgent('a')
    expect(await f.bridge.stop('a', { wait: false, cause: { kind: 'user' } })).toEqual({ accepted: true, active: true, clearedInbox: true })
    expect(agent.whenIdle).not.toHaveBeenCalled()
    expect(await f.bridge.stop('cold')).toEqual({ accepted: true, active: false, clearedInbox: false })
    expect(f.resolveAgent).not.toHaveBeenCalled()
  })

  it('finds the current owner input through native runtime snapshots and model-switch notices', async () => {
    const f = fixture()
    f.page.mockResolvedValueOnce({ cursor: 8, hasMore: true, records: [
      record(5, 'turn/start', { turn: 2 }), record(6, 'user/message', user('owner-2')),
      record(7, 'user/message', user('runtime', 'runtime-context')), record(8, 'user/message', user('switch', 'model-selection')),
    ] })
    expect(await f.bridge.latestOwnerRequest('a')).toEqual({ sessionId: 'a', id: 'owner-2', text: 'Owner request' })
    expect(f.resolveAgent).not.toHaveBeenCalled()
  })

  it('does not borrow an old human request for a restored Spirit or other plugin turn', async () => {
    for (const source of ['spirit', 'dsh-superagent', 'unknown-plugin']) {
      const f = fixture()
      f.page.mockResolvedValueOnce({ cursor: 5, hasMore: false, records: [
        record(0, 'turn/start', { turn: 1 }), record(1, 'user/message', user('old-owner')),
        record(2, 'turn/end', { turn: 1 }), record(3, 'turn/start', { turn: 2 }),
        record(4, 'user/message', user('background', source)), record(5, 'user/message', user('runtime', 'runtime-context')),
      ] })
      expect(await f.bridge.latestOwnerRequest('a')).toBeUndefined()
    }
  })

  it('rejects non-owner remote principals and completed historical owner turns', async () => {
    const f = fixture()
    f.page.mockResolvedValueOnce({ cursor: 1, hasMore: false, records: [record(0, 'turn/start', { turn: 1 }), record(1, 'user/message', user('peer', 'user', 'remote-peer'))] })
    expect(await f.bridge.latestOwnerRequest('a')).toBeUndefined()
    f.page.mockResolvedValueOnce({ cursor: 2, hasMore: false, records: [record(0, 'turn/start', { turn: 1 }), record(1, 'user/message', user('owner')), record(2, 'turn/end', { turn: 1 })] })
    expect(await f.bridge.latestOwnerRequest('a')).toBeUndefined()
    f.page.mockResolvedValueOnce({ cursor: 0, hasMore: false, records: [record(0, 'user/message', user('owner'))] })
    expect(await f.bridge.latestOwnerRequest('a')).toBeUndefined() // no current turn boundary
  })

  it('pins native pagination while finding the current turn boundary', async () => {
    const f = fixture()
    f.page.mockResolvedValueOnce({ cursor: 52, hasMore: true, records: [record(51, 'assistant/message', { text: 'working' }), record(52, 'tool/call', { name: 'spirit_start' })] })
    f.page.mockResolvedValueOnce({ cursor: 52, hasMore: true, records: [record(20, 'user/message', user('owner')), record(21, 'user/message', user('context', 'runtime-context'))] })
    f.page.mockResolvedValueOnce({ cursor: 52, hasMore: false, records: [record(10, 'turn/start', { turn: 2 }), record(11, 'step/start', { turn: 2, step: 1 })] })
    expect(await f.bridge.latestOwnerRequest('a')).toMatchObject({ id: 'owner' })
    expect(f.page).toHaveBeenNthCalledWith(2, expect.objectContaining({ throughSeq: 52, beforeSeq: 51 }), expect.any(AbortSignal))
    expect(f.page).toHaveBeenNthCalledWith(3, expect.objectContaining({ throughSeq: 52, beforeSeq: 20 }), expect.any(AbortSignal))
  })
})
