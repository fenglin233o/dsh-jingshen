import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../upstream/src/app/store.ts'
import { Autonomy, type AutonomyOptions, type DeliberationPacket } from '../src/autonomy.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
const epoch = Date.parse('2026-11-15T10:00:00.000Z')
const source = { kind: 'system' as const, reference: 'worker:result' }
const self = { kind: 'self' as const, reference: 'main:tool-call' }
const accepted = async (_packet: DeliberationPacket, _signal: AbortSignal) => {}
const observation = (id: string, sessionId = 'main') => ({ id, sessionId, kind: 'task-result', summary: `事情有新进展：${id}`, source })
const intention = (sessionId = 'main') => ({ sessionId, statement: '继续关注尚未解决的安排', reason: '实际空闲时间尚未确定', source: self })
function fixture(options: AutonomyOptions = {}, deliver?: (packet: DeliberationPacket, signal: AbortSignal) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'spirit-autonomy-')), store = new Store(join(dir, 'test.sqlite'))
  let current = epoch
  const transport = { deliberate: vi.fn(deliver ?? (async () => {})) }
  const autonomy = new Autonomy(store, transport, { ...options, now: () => current })
  cleanup.push(async () => { await autonomy.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })
  return { dir, store, autonomy, transport, advance: (ms: number) => { current += ms }, now: () => current }
}
function acknowledge(autonomy: Autonomy, packet: DeliberationPacket, extra = {}) {
  return autonomy.decide({ opportunityId: packet.opportunity.id, dispatchId: packet.dispatchId,
    decision: 'refrain', reason: '已读实际变化，目前没有继续行动的理由', ...extra })
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve() }

function openActivity() {
  const state = { grant: undefined as number | undefined, willing: true, modelReady: true, userInput: false }
  return { state, options: { sessionId: 'main', intervalMs: 10_000, grant: () => state.grant, willing: () => state.willing,
    idle: () => state.modelReady && !state.userInput } }
}

describe('自主连续性：机会与判断分离', () => {
  it('没有实际事件或模型选定的再考虑时点，空转不会产生思考或改进', async () => {
    const { autonomy, transport, advance } = fixture()
    autonomy.recordIntent(intention())
    for (let i = 0; i < 10; i++) { advance(86_400_000); await autonomy.idle() }
    expect(transport.deliberate).not.toHaveBeenCalled()
    expect(autonomy.snapshot().opportunities).toEqual([])
    expect(autonomy.intents()[0]?.state).toBe('open')
  })

  it('持续授权下每个空闲期限只提供一次无题目机会，可以不行动后继续等待', async () => {
    const open = openActivity()
    const { autonomy, transport, advance } = fixture({ openActivity: open.options })
    await autonomy.idle()
    advance(30_000); await autonomy.idle()
    expect(autonomy.snapshot().opportunities).toEqual([])
    open.state.grant = 1
    await autonomy.idle()
    for (let second = 0; second < 9; second++) { advance(1_000); await autonomy.idle() }
    expect(transport.deliberate).not.toHaveBeenCalled()
    advance(1_000); await autonomy.idle()
    const first = transport.deliberate.mock.calls[0]![0]
    expect(first).toMatchObject({ opportunity: { openGrant: 1 }, events: [], revisits: [], intents: [] })
    advance(30_000); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(1)
    expect(acknowledge(autonomy, first)).toEqual(acknowledge(autonomy, first))
    advance(9_999); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(1)
    advance(1); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(2)
    expect(transport.deliberate.mock.calls[1]![0].dispatchId).not.toBe(first.dispatchId)
    expect(autonomy.events()).toEqual([])
    expect(autonomy.intents()).toEqual([])
  })

  it('开放原生回合可无声结束，回执可早于发送 flush 并允许后续具体及开放机会', async () => {
    const open = openActivity()
    open.state.grant = 7
    let finishSend!: () => void
    const flushPost = new Promise<void>(resolve => { finishSend = resolve })
    const { autonomy, transport, advance } = fixture({ openActivity: open.options })
    transport.deliberate.mockImplementationOnce(async () => flushPost)
    await autonomy.idle(); advance(10_000); autonomy.tick(); await flush()
    const packet = transport.deliberate.mock.calls[0]![0]
    expect(packet.instruction).toContain('不必发消息或给出理由')
    expect(autonomy.getOpportunity(packet.opportunity.id).state).toBe('dispatching')
    autonomy.recordOpenTurnEnd('other', packet.dispatchId, 1, 10)
    expect(autonomy.getOpportunity(packet.opportunity.id).state).toBe('dispatching')
    autonomy.recordOpenTurnEnd('main', packet.dispatchId, 1, 10)
    const closed = autonomy.getOpportunity(packet.opportunity.id)
    expect(closed).toMatchObject({ state: 'settled', resolution: expect.stringContaining('未登记判断'), endedWithoutDecision: { turn: 1, endSeq: 10 } })
    expect(closed.receiptAt).toBe(closed.settledAt)
    expect(autonomy.snapshot().decisions).toEqual([])
    expect(() => acknowledge(autonomy, packet)).toThrow(/失效/)
    advance(100); autonomy.recordOpenTurnEnd('main', packet.dispatchId, 1, 10)
    finishSend(); await autonomy.idle()
    expect(autonomy.getOpportunity(packet.opportunity.id)).toEqual(closed)

    autonomy.observe(observation('new-fact')); await autonomy.idle()
    const concrete = transport.deliberate.mock.calls[1]![0]
    autonomy.recordOpenTurnEnd('main', concrete.dispatchId, 2, 22)
    expect(autonomy.getOpportunity(concrete.opportunity.id).state).toBe('awaiting_decision')
    acknowledge(autonomy, concrete)
    advance(9_899); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(2)
    advance(1); await autonomy.idle()
    const next = transport.deliberate.mock.calls[2]![0]
    const decision = acknowledge(autonomy, next)
    autonomy.recordOpenTurnEnd('main', next.dispatchId, 3, 37)
    expect(autonomy.getOpportunity(next.opportunity.id).endedWithoutDecision).toBeUndefined()
    expect(autonomy.snapshot().decisions[0]).toEqual(decision)
    expect(autonomy.recordsPage('opportunities', 1, 1)).toMatchObject({ items: [{ id: concrete.opportunity.id }], total: 3 })
  })

  it('确实收到的开放回合可在发送端报告失败后正常结束', async () => {
    const open = openActivity()
    open.state.grant = 1
    const { autonomy, transport, advance } = fixture({ openActivity: open.options })
    transport.deliberate.mockRejectedValueOnce(new Error('入列之后发送端 flush 失败'))
    await autonomy.idle(); advance(10_000); await autonomy.idle()
    const packet = transport.deliberate.mock.calls[0]![0]
    expect(autonomy.getOpportunity(packet.opportunity.id).state).toBe('retry')
    autonomy.recordOpenTurnEnd('main', packet.dispatchId, 1, 10)
    expect(autonomy.getOpportunity(packet.opportunity.id)).toMatchObject({ state: 'settled', endedWithoutDecision: { turn: 1, endSeq: 10 } })
    advance(2_000); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(1)
  })

  it('安静、没有模型、已有本人输入、暂停和停止期间不会派发开放机会', async () => {
    const open = openActivity()
    const { autonomy, transport, advance } = fixture({ openActivity: open.options })
    open.state.grant = 4; open.state.willing = false
    await autonomy.idle()
    advance(40_000); await autonomy.idle()
    open.state.willing = true; open.state.modelReady = false; await autonomy.idle()
    advance(30_000); await autonomy.idle()
    open.state.modelReady = true; open.state.userInput = true; await autonomy.idle()
    expect(autonomy.snapshot().opportunities).toEqual([])
    autonomy.control('paused', '本人暂停'); open.state.userInput = false
    advance(30_000); await autonomy.idle()
    autonomy.control('stopped', '本人停止')
    advance(30_000); await autonomy.idle()
    expect(transport.deliberate).not.toHaveBeenCalled()
    autonomy.control('active', '本人恢复'); await autonomy.idle()
    expect(transport.deliberate).not.toHaveBeenCalled()
    advance(10_000); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(1)
    const packet = transport.deliberate.mock.calls[0]![0]
    autonomy.control('paused', '本人再次暂停'); autonomy.control('active', '本人再次恢复')
    expect(autonomy.getOpportunity(packet.opportunity.id).state).toBe('cancelled')
    expect(() => acknowledge(autonomy, packet)).toThrow(/失效/)
  })

  it('真正入列前再次检查本人输入；忙碌时保留同一派发版本且没有忙循环', async () => {
    const open = openActivity()
    open.state.grant = 4
    let entered = 0, unblock!: () => void
    const firstSend = new Promise<void>(resolve => { unblock = resolve })
    const { autonomy, transport, advance } = fixture({ openActivity: open.options, retryMs: [1000, 4000] }, async (packet, signal) => {
      await firstSend
      autonomy.assertReadyToDeliver('main', packet.dispatchId, signal)
      entered++
    })
    await autonomy.idle(); advance(10_000); autonomy.tick(); await flush()
    expect(transport.deliberate).toHaveBeenCalledTimes(1)
    open.state.userInput = true; unblock(); await autonomy.idle()
    expect(entered).toBe(0)
    advance(30_000); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(1)
    open.state.userInput = false; await autonomy.idle()
    expect(entered).toBe(1)
    expect(transport.deliberate.mock.calls[1]![0]).toEqual(transport.deliberate.mock.calls[0]![0])
  })

  it('安静使失败的开放发送失效，恢复开放会重新安排；进行中的回合仍可记录判断', async () => {
    const open = openActivity()
    open.state.grant = 1
    const { autonomy, transport, advance } = fixture({ openActivity: open.options })
    transport.deliberate.mockRejectedValueOnce(new Error('模型介质暂不可用')).mockRejectedValueOnce(new Error('模型介质仍未恢复'))
    await autonomy.idle(); advance(10_000); await autonomy.idle()
    const old = transport.deliberate.mock.calls[0]![0]
    expect(autonomy.getOpportunity(old.opportunity.id).state).toBe('retry')
    advance(1999); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(1)
    advance(1); await autonomy.idle()
    expect(transport.deliberate.mock.calls[1]![0]).toEqual(old)
    open.state.willing = false; advance(30_000); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(2)
    expect(autonomy.getOpportunity(old.opportunity.id).state).toBe('cancelled')
    open.state.willing = true; await autonomy.idle(); advance(9_999); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(2)
    advance(1); await autonomy.idle()
    const retired = transport.deliberate.mock.calls[2]![0]
    open.state.willing = false
    expect(() => autonomy.assertDispatchCurrent('main', retired.dispatchId, true)).toThrow(/安静/)
    expect(autonomy.getOpportunity(retired.opportunity.id).state).toBe('cancelled')
    await autonomy.idle()
    open.state.willing = true; await autonomy.idle(); advance(10_000); await autonomy.idle()
    const packet = transport.deliberate.mock.calls[3]![0]
    expect(() => autonomy.assertDispatchCurrent('main', packet.dispatchId, true)).not.toThrow()
    open.state.willing = false
    expect(() => autonomy.assertDispatchCurrent('main', packet.dispatchId)).not.toThrow()
    acknowledge(autonomy, packet)
    open.state.willing = true
    expect(() => autonomy.assertDispatchCurrent('main', packet.dispatchId, true)).toThrow(/已经处理/)
  })

  it('撤销授权会中止旧派发，旧回报不能落账；授权再次生效时以新期限开始', async () => {
    const open = openActivity()
    open.state.grant = 1
    const { autonomy, transport, advance } = fixture({ openActivity: open.options }, async () => new Promise(() => {}))
    await autonomy.idle(); advance(10_000); autonomy.tick(); await flush()
    const [old, signal] = transport.deliberate.mock.calls[0]!
    open.state.grant = undefined
    expect(() => acknowledge(autonomy, old)).toThrow(/授权.*过时/)
    autonomy.recordOpenTurnEnd('main', old.dispatchId, 1, 10)
    await autonomy.idle()
    expect(signal.aborted).toBe(true)
    expect(autonomy.getOpportunity(old.opportunity.id).state).toBe('cancelled')
    advance(100_000); await autonomy.idle()
    open.state.grant = 3; await autonomy.idle(); advance(9_999); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(1)
    transport.deliberate.mockImplementationOnce(accepted)
    advance(1); await autonomy.idle()
    expect(transport.deliberate.mock.calls[1]![0].opportunity.openGrant).toBe(3)
  })

  it('到期的具体再考虑优先使用主会话，开放机会不改写原意向或安排时点', async () => {
    const open = openActivity()
    open.state.grant = 1
    const { autonomy, transport, advance, now } = fixture({ openActivity: open.options })
    const at = new Date(now() + 10_000).toISOString()
    const intent = autonomy.recordIntent({ ...intention(), state: 'waiting', revisit: { at } })
    await autonomy.idle(); advance(10_000); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(1)
    const specific = transport.deliberate.mock.calls[0]![0]
    expect(specific.opportunity.openGrant).toBeUndefined()
    expect(specific.revisits[0]).toMatchObject({ at, intentId: intent.id })
    acknowledge(autonomy, specific); await autonomy.idle()
    const offered = transport.deliberate.mock.calls[1]![0]
    expect(offered).toMatchObject({ opportunity: { openGrant: 1 }, revisits: [] })
    acknowledge(autonomy, offered)
    expect(autonomy.getIntent(intent.id)).toEqual(intent)
    expect(autonomy.revisits()).toMatchObject([{ at, state: 'fired' }])
  })

  it('重启保留开放期限和未判断的派发，停机过久只给下一次机会并拒绝过期判断', async () => {
    const open = openActivity()
    open.state.grant = 9
    const { autonomy: first, store, advance, now } = fixture({ openActivity: open.options })
    await first.idle(); advance(9000); await first.close()
    const secondTransport = { deliberate: vi.fn(accepted) }
    const second = new Autonomy(store, secondTransport, { now, openActivity: open.options, opportunityLifetimeMs: 5_000 })
    cleanup.push(() => second.close())
    await second.idle(); expect(secondTransport.deliberate).not.toHaveBeenCalled()
    advance(1000); await second.idle(); await second.close()
    const firstPacket = secondTransport.deliberate.mock.calls[0]![0]
    const thirdTransport = { deliberate: vi.fn(accepted) }
    const third = new Autonomy(store, thirdTransport, { now, openActivity: open.options, opportunityLifetimeMs: 5_000 })
    cleanup.push(() => third.close())
    await third.idle()
    expect(thirdTransport.deliberate).not.toHaveBeenCalled()
    expect(third.getOpportunity(firstPacket.opportunity.id).state).toBe('awaiting_decision')
    advance(80_000); await third.idle()
    expect(third.getOpportunity(firstPacket.opportunity.id).state).toBe('expired')
    expect(() => acknowledge(third, firstPacket)).toThrow(/失效/)
    third.recordOpenTurnEnd('main', firstPacket.dispatchId, 1, 10)
    expect(third.getOpportunity(firstPacket.opportunity.id).endedWithoutDecision).toBeUndefined()
    expect(thirdTransport.deliberate).toHaveBeenCalledTimes(1)
    expect(thirdTransport.deliberate.mock.calls[0]![0].dispatchId).not.toBe(firstPacket.dispatchId)
  })

  it('观察幂等、合并；发送回执保留 awaiting_decision，明确判断才处理机会', async () => {
    const { autonomy, transport } = fixture()
    const first = autonomy.observe(observation('one'))
    expect(autonomy.observe(observation('one'))).toEqual(first)
    autonomy.observe(observation('two'))
    expect(transport.deliberate).not.toHaveBeenCalled() // The host decides when setup is complete and calls tick.
    await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(1)
    const packet = transport.deliberate.mock.calls[0]![0]
    expect(packet.eventCount).toBe(2)
    expect(autonomy.getOpportunity(first.opportunityId!).state).toBe('awaiting_decision')
    expect(autonomy.snapshot().decisions).toEqual([])
    const decision = acknowledge(autonomy, packet)
    expect(acknowledge(autonomy, packet)).toEqual(decision)
    expect(autonomy.getOpportunity(first.opportunityId!).state).toBe('settled')
    expect(() => autonomy.observe({ ...observation('one'), summary: '不同的事情' })).toThrow(/同一事件/)
    expect(() => acknowledge(autonomy, packet, { decision: 'act' })).toThrow(/已经/)
  })

  it('模型可选择等待与一次性再考虑；触发不自动完成意向，也不自动重复排期', async () => {
    const { autonomy, transport, advance, now } = fixture()
    const intent = autonomy.recordIntent(intention())
    autonomy.observe(observation('result')); await autonomy.idle()
    acknowledge(autonomy, transport.deliberate.mock.calls[0]![0], { decision: 'defer', reason: '明天应能得到真实可用时段',
      intentId: intent.id, intentRevision: intent.revision, intentState: 'waiting', revisit: { at: new Date(now() + 60_000).toISOString() } })
    expect(autonomy.getIntent(intent.id).state).toBe('waiting')
    advance(59_999); await autonomy.idle(); expect(transport.deliberate).toHaveBeenCalledTimes(1)
    advance(1); await autonomy.idle(); expect(transport.deliberate).toHaveBeenCalledTimes(2)
    expect(autonomy.revisits()[0]?.state).toBe('fired')
    expect(autonomy.getIntent(intent.id).state).toBe('waiting')
    const second = transport.deliberate.mock.calls[1]![0]
    acknowledge(autonomy, second, { decision: 'learn', reason: '实际检验完成，记录所得', intentId: intent.id,
      intentRevision: 2, intentState: 'done' })
    advance(10 * 86_400_000); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(2)
    expect(autonomy.getIntent(intent.id).state).toBe('done')
    expect(autonomy.intentHistory(intent.id).map(value => value.state)).toEqual(['open', 'waiting', 'done'])
  })

  it('事件条件只是候选机会，保留条件供模型判断；回声与无关事件不触发条件', async () => {
    const { autonomy, transport } = fixture()
    const intent = autonomy.recordIntent({ ...intention(), state: 'waiting', revisit: { condition: {
      description: '排期结果是否真正解决冲突', eventKind: 'schedule-result', affairId: 'schedule', sourceKind: 'system',
    } } })
    autonomy.observe({ ...observation('echo'), kind: 'schedule-result', affairId: 'schedule', source: self })
    expect(autonomy.revisits()[0]?.state).toBe('waiting')
    autonomy.observe(observation('unrelated')); await autonomy.idle()
    acknowledge(autonomy, transport.deliberate.mock.calls[0]![0])
    const event = autonomy.observe({ ...observation('matching'), kind: 'schedule-result', affairId: 'schedule' })
    await autonomy.idle()
    const packet = transport.deliberate.mock.calls[1]![0]
    expect(packet.revisits[0]).toMatchObject({ intentId: intent.id, matchedEventId: event.id, state: 'fired' })
    expect(packet.revisits[0]?.condition?.description).toContain('是否真正')
    expect(packet.revisits[0]?.resolution).toContain('仍由模型判断')
  })

  it('并发预算包含等待模型判断的会话；同一会话的新事件保留在下一次机会', async () => {
    const { autonomy, transport } = fixture({ concurrency: 2 })
    autonomy.observe(observation('main-1')); autonomy.observe(observation('other-1', 'other'))
    autonomy.observe(observation('third-1', 'third')); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(2)
    autonomy.observe(observation('main-2')); autonomy.tick(); autonomy.tick(); await flush()
    expect(transport.deliberate).toHaveBeenCalledTimes(2)
    const first = transport.deliberate.mock.calls.find(([packet]) => packet.opportunity.sessionId === 'main')![0]
    acknowledge(autonomy, first); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(3)
    expect(transport.deliberate.mock.calls[2]![0].opportunity.sessionId).toBe('third')
    expect(autonomy.snapshot().opportunities.filter(value => value.sessionId === 'main' && value.state === 'pending')).toHaveLength(1)
  })

  it('大批观察只发送有界上下文，原记录仍可分页读取', async () => {
    const { autonomy, transport } = fixture({ contextLimit: 3 })
    for (let i = 0; i < 11; i++) autonomy.observe({ ...observation(`result-${i}`), summary: '实际观察'.repeat(1000) })
    await autonomy.idle()
    const packet = transport.deliberate.mock.calls[0]![0]
    expect(packet.events).toHaveLength(3); expect(packet.eventCount).toBe(11)
    expect(packet.events[0]!.summary.length).toBeLessThan(1100)
    expect(packet.opportunity.eventIds).toHaveLength(3)
    expect(autonomy.events({ opportunityId: packet.opportunity.id, offset: 3, limit: 8 })).toHaveLength(8)
    expect(autonomy.events({ opportunityId: packet.opportunity.id })[0]?.summary.length).toBe(4000)
  })

  it('传输失败有可见退避，以稳定身份和相同上下文恢复；新事件不会修改已发送的消息', async () => {
    const { autonomy, transport, advance } = fixture({ retryMs: [1000, 8000] })
    transport.deliberate.mockRejectedValueOnce(new Error('连接暂时断开'))
    const event = autonomy.observe(observation('original')); await autonomy.idle()
    const failed = autonomy.getOpportunity(event.opportunityId!)
    expect(failed).toMatchObject({ state: 'retry', attempts: 1, lastError: 'Error: 连接暂时断开' })
    autonomy.observe(observation('new-result'))
    advance(999); await autonomy.idle()
    // A separate observation may be delivered while another send backs off, but no old payload is overwritten.
    expect(transport.deliberate).toHaveBeenCalledTimes(2)
    acknowledge(autonomy, transport.deliberate.mock.calls[1]![0])
    advance(1); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(3)
    expect(transport.deliberate.mock.calls[2]![0]).toEqual(transport.deliberate.mock.calls[0]![0])
    expect(autonomy.getOpportunity(failed.id).state).toBe('awaiting_decision')
  })

  it('暂停中止尚未发出的请求并保存机会；停止取消旧意向，恢复不复活它们', async () => {
    const { autonomy, transport, advance, now } = fixture({}, async () => new Promise(() => {}))
    const intent = autonomy.recordIntent({ ...intention(), revisit: { at: new Date(now() + 60_000).toISOString() } })
    const event = autonomy.observe(observation('before-pause')); autonomy.tick()
    autonomy.control('paused', '本人需要安静')
    await autonomy.idle()
    expect(transport.deliberate).not.toHaveBeenCalled()
    expect(autonomy.getOpportunity(event.opportunityId!).state).toBe('retry')
    autonomy.observe(observation('during-pause')); advance(60_000); await autonomy.idle()
    expect(transport.deliberate).not.toHaveBeenCalled()
    expect(autonomy.revisits()[0]?.state).toBe('fired')
    expect(() => autonomy.recordIntent(intention())).toThrow(/暂停/)
    autonomy.control('stopped', '本人结束这些活动')
    expect(autonomy.getIntent(intent.id).state).toBe('cancelled')
    expect(autonomy.snapshot().opportunities.every(value => value.state === 'cancelled')).toBe(true)
    expect(autonomy.observe(observation('during-stop')).disposition).toBe('stopped')
    autonomy.control('active', '允许新的自主活动'); await autonomy.idle()
    expect(transport.deliberate).not.toHaveBeenCalled()
    expect(() => autonomy.recordIntent({ ...intention(), id: intent.id, expectedRevision: 2 })).toThrow(/不会复活/)
  })

  it('正在发送的旧租约不能在暂停恢复后覆盖新请求', async () => {
    let release!: () => void
    const { autonomy, transport } = fixture({}, async () => new Promise<void>(resolve => { release = resolve }))
    const event = autonomy.observe(observation('race')); autonomy.tick(); await flush()
    const firstSignal = transport.deliberate.mock.calls[0]![1]
    autonomy.control('paused', '检查中'); await autonomy.idle()
    expect(firstSignal.aborted).toBe(true)
    const oldRelease = release
    transport.deliberate.mockImplementationOnce(async () => {})
    autonomy.control('active', '检查结束'); await autonomy.idle()
    const current = autonomy.getOpportunity(event.opportunityId!)
    expect(current).toMatchObject({ state: 'awaiting_decision', attempts: 2 })
    oldRelease(); await flush()
    expect(autonomy.getOpportunity(current.id)).toEqual(current)
  })

  it('意向与事情的旧版本不会继续唤醒；过期机会不是完成', async () => {
    const { autonomy, transport, advance, now } = fixture({ opportunityLifetimeMs: 5000 })
    const original = autonomy.recordIntent({ ...intention(), revisit: { at: new Date(now() + 1000).toISOString() } })
    const updated = autonomy.recordIntent({ ...intention(), id: original.id, expectedRevision: 1, statement: '实际事情已经改变' })
    expect(() => autonomy.recordIntent({ ...intention(), id: original.id, expectedRevision: 1 })).toThrow(/版本/)
    advance(1000); await autonomy.idle(); expect(transport.deliberate).not.toHaveBeenCalled()
    expect(autonomy.revisits()[0]?.state).toBe('stale')
    const old = autonomy.observe({ ...observation('revision-1'), affairId: 'work', revision: 1 }); await autonomy.idle()
    const oldPacket = transport.deliberate.mock.calls[0]![0]
    expect(() => autonomy.assertDispatchCurrent('main', oldPacket.dispatchId)).not.toThrow()
    autonomy.observe({ ...observation('revision-2'), affairId: 'work', revision: 2 })
    expect(() => autonomy.assertDispatchCurrent('main', oldPacket.dispatchId)).toThrow(/版本/)
    expect(() => acknowledge(autonomy, oldPacket)).toThrow(/版本/)
    await autonomy.idle()
    expect(autonomy.getOpportunity(old.opportunityId!).state).toBe('stale')
    expect(autonomy.observe({ ...observation('late-revision-1'), affairId: 'work', revision: 1 }).disposition).toBe('stale')
    advance(5000); await autonomy.idle()
    expect(autonomy.snapshot().opportunities.some(value => value.state === 'expired')).toBe(true)
    expect(autonomy.getIntent(updated.id).state).toBe('open')
  })

  it('当前意向按活动会话和再考虑排序，保留可分页查阅的归档和陈旧版本', async () => {
    const { autonomy, transport, advance, now } = fixture()
    const related = autonomy.recordIntent({ ...intention(), state: 'waiting', revisit: { at: new Date(now() + 1000).toISOString() } })
    const local = autonomy.recordIntent(intention())
    const global = autonomy.recordIntent(intention('other'))
    const old = autonomy.recordIntent({ ...intention('other'), affairId: 'project', affairRevision: 1 })
    autonomy.recordIntent({ ...intention('other'), state: 'done' })
    advance(1000); await autonomy.idle()
    const packet = transport.deliberate.mock.calls[0]![0]
    autonomy.observe({ ...observation('updated', 'other'), affairId: 'project', revision: 2 })
    expect(autonomy.workingIntents(2, { sessionId: 'main' })).toMatchObject({ items: [{ id: related.id }, { id: local.id }], total: 3 })
    expect(autonomy.intentPage({ sessionId: 'other', activeOnly: true })).toMatchObject({ items: [{ id: global.id }], total: 1 })
    expect(autonomy.intentPage({ sessionId: 'other', affairId: 'project' })).toMatchObject({ items: [{ id: old.id }], total: 1 })
    expect(autonomy.isCurrentIntent(old.id, old.revision)).toBe(false)
    expect(autonomy.isCurrentIntent(related.id, related.revision)).toBe(true)
    autonomy.recordIntent({ ...intention(), id: related.id, expectedRevision: related.revision, state: 'cancelled' })
    expect(() => autonomy.assertDispatchCurrent('main', packet.dispatchId)).toThrow(/意向版本已过时/)
    expect(autonomy.isCurrentIntent(related.id, related.revision)).toBe(false)
    expect(autonomy.intentHistoryPage(related.id, 1, 1)).toMatchObject({ items: [{ revision: 2, state: 'cancelled' }], total: 2 })
    await autonomy.idle()
    expect(transport.deliberate.mock.calls[1]![0].opportunity.sessionId).toBe('other')
  })

  it('旧意向版本和无效再考虑不能部分提交判断；没有错误对象的传输拒绝也不是成功', async () => {
    const { autonomy, transport, advance, now } = fixture({ retryMs: [1000, 1000] })
    const intent = autonomy.recordIntent(intention())
    transport.deliberate.mockRejectedValueOnce(undefined)
    const event = autonomy.observe(observation('result')); await autonomy.idle()
    expect(autonomy.getOpportunity(event.opportunityId!).state).toBe('retry')
    advance(1000); await autonomy.idle()
    const packet = transport.deliberate.mock.calls[1]![0]
    expect(() => acknowledge(autonomy, packet, { intentId: intent.id, intentRevision: 0, intentState: 'done' })).toThrow(/版本/)
    expect(() => acknowledge(autonomy, packet, { intentId: intent.id, intentRevision: 1,
      intentState: 'waiting', revisit: { at: new Date(now()).toISOString() } })).toThrow(/未来/)
    expect(autonomy.getIntent(intent.id)).toEqual(intent)
    expect(autonomy.getOpportunity(event.opportunityId!).state).toBe('awaiting_decision')
    expect(autonomy.snapshot().decisions).toHaveLength(0)
  })

  it('仅发起本人消息或自身消息的回声不会形成新循环，旧发送身份在明确重试后仍可识别', async () => {
    const { autonomy, transport } = fixture()
    autonomy.observe(observation('real')); await autonomy.idle()
    const oldPacket = transport.deliberate.mock.calls[0]![0]
    expect(autonomy.observe({ ...observation('own-echo'), causedBy: oldPacket.dispatchId }).disposition).toBe('echo')
    autonomy.retry(oldPacket.opportunity.id, '上一回合未记录判断，明确要求再看'); await autonomy.idle()
    const current = transport.deliberate.mock.calls[1]![0]
    expect(current.dispatchId).not.toBe(oldPacket.dispatchId)
    expect(() => autonomy.assertDispatchCurrent('main', oldPacket.dispatchId)).toThrow(/发送版本/)
    expect(() => autonomy.assertDispatchCurrent('main', current.dispatchId)).not.toThrow()
    expect(() => acknowledge(autonomy, oldPacket)).toThrow(/发送版本/)
    expect(autonomy.observe({ ...observation('late-echo'), causedBy: oldPacket.dispatchId }).disposition).toBe('echo')
    acknowledge(autonomy, current); await autonomy.idle()
    expect(transport.deliberate).toHaveBeenCalledTimes(2)
  })

  it('多实例竞争同一 SQLite 队列时只领取一次；过期发送租约由另一个实例恢复', async () => {
    const { autonomy, store, transport, advance, now } = fixture({ dispatchLeaseMs: 1000, retryMs: [1000, 4000] }, async () => new Promise(() => {}))
    const secondTransport = { deliberate: vi.fn(accepted) }
    const second = new Autonomy(store, secondTransport, { now, dispatchLeaseMs: 1000, retryMs: [1000, 4000] })
    cleanup.push(() => second.close())
    const event = autonomy.observe(observation('contended')); autonomy.tick(); second.tick(); await flush()
    expect(transport.deliberate).toHaveBeenCalledTimes(1); expect(secondTransport.deliberate).not.toHaveBeenCalled()
    const dispatchId = transport.deliberate.mock.calls[0]![0].dispatchId
    advance(1000); second.tick()
    expect(second.getOpportunity(event.opportunityId!)).toMatchObject({ state: 'retry', lastError: expect.stringContaining('租约') })
    advance(1000); await second.idle()
    expect(secondTransport.deliberate).toHaveBeenCalledTimes(1)
    expect(secondTransport.deliberate.mock.calls[0]![0].dispatchId).toBe(dispatchId)
    await autonomy.close()
    expect(second.getOpportunity(event.opportunityId!).state).toBe('awaiting_decision')
  })

  it('重启保留选定时点和未获得判断的收件，不因为恢复而制造新的思考', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spirit-autonomy-restart-')), path = join(dir, 'state.sqlite')
    let current = epoch
    const now = () => current, firstStore = new Store(path), firstTransport = { deliberate: vi.fn(accepted) }
    const first = new Autonomy(firstStore, firstTransport, { now })
    const waiting = first.recordIntent({ ...intention(), revisit: { at: new Date(current + 10_000).toISOString() } })
    first.observe(observation('received')); await first.idle()
    const receipt = firstTransport.deliberate.mock.calls[0]![0]
    await first.close(); firstStore.close()
    const secondStore = new Store(path), secondTransport = { deliberate: vi.fn(accepted) }
    const second = new Autonomy(secondStore, secondTransport, { now })
    cleanup.push(async () => { await second.close(); secondStore.close(); rmSync(dir, { recursive: true, force: true }) })
    await second.idle()
    expect(secondTransport.deliberate).not.toHaveBeenCalled()
    expect(second.getOpportunity(receipt.opportunity.id).state).toBe('awaiting_decision')
    acknowledge(second, receipt)
    current += 10_000; await second.idle()
    expect(secondTransport.deliberate).toHaveBeenCalledTimes(1)
    expect(secondTransport.deliberate.mock.calls[0]![0].intents[0]?.id).toBe(waiting.id)
    expect(second.revisits()[0]?.state).toBe('fired')
  })

  it('关闭会中止挂起的传输并允许 Store 安全关闭，重启按原消息身份重试', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spirit-autonomy-close-')), path = join(dir, 'state.sqlite')
    const firstStore = new Store(path), firstTransport = { deliberate: vi.fn(async (_packet: DeliberationPacket, _signal: AbortSignal) => new Promise<void>(() => {})) }
    const first = new Autonomy(firstStore, firstTransport, { now: () => epoch })
    const event = first.observe(observation('closing')); first.tick(); await flush()
    const id = firstTransport.deliberate.mock.calls[0]![0].dispatchId
    await first.close()
    expect(firstTransport.deliberate.mock.calls[0]![1].aborted).toBe(true)
    expect(first.getOpportunity(event.opportunityId!).state).toBe('retry')
    firstStore.close()
    const secondStore = new Store(path), secondTransport = { deliberate: vi.fn(accepted) }
    const second = new Autonomy(secondStore, secondTransport, { now: () => epoch })
    cleanup.push(async () => { await second.close(); secondStore.close(); rmSync(dir, { recursive: true, force: true }) })
    await second.idle()
    expect(secondTransport.deliberate.mock.calls[0]![0].dispatchId).toBe(id)
  })

  it('意向与安排在外层事务回滚时一起回滚，无提前派发；发起来源不会被后续判断改写', async () => {
    const { autonomy, store, transport, now } = fixture()
    expect(() => store.atomic(() => {
      autonomy.observe(observation('rolled-back'))
      autonomy.recordIntent({ ...intention(), revisit: { at: new Date(now() + 10_000).toISOString() } })
      autonomy.tick() // Even an explicit tick cannot leak the enclosing transaction's uncommitted opportunity.
      throw new Error('outer rollback')
    })).toThrow('outer rollback')
    await autonomy.idle()
    expect(transport.deliberate).not.toHaveBeenCalled(); expect(autonomy.intents()).toEqual([]); expect(autonomy.events()).toEqual([])
    const original = autonomy.recordIntent({ ...intention(), source: { kind: 'user', reference: 'request:1' } })
    const updated = autonomy.recordIntent({ ...intention(), id: original.id, expectedRevision: 1 })
    expect(updated.source).toEqual({ kind: 'user', reference: 'request:1' })
    expect(updated.updatedBy).toEqual(self)
    expect(() => autonomy.recordIntent({ ...intention(), revisit: { at: new Date(now()).toISOString() } })).toThrow(/未来/)
    expect(autonomy.intents()).toHaveLength(1)
  })
})
