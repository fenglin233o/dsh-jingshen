import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalService, workerId, type InitiativeRequest, type ServiceOptions, type Transport } from '../src/service.ts'
import { sameOrigin } from '../src/http.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.useRealTimers() })
function transportFixture(): Transport { return { ensure: vi.fn(async () => {}), send: vi.fn(async () => {}), stop: vi.fn(async () => {}) } }
function fixture(concurrency = 2, options: ServiceOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'spirit-service-')), transport = transportFixture()
  const app = new PersonalService(dir, transport, concurrency, undefined, options)
  cleanup.push(async () => { await app.stop(); rmSync(dir, { recursive: true, force: true }) })
  return { app, transport, dir }
}
const request = { sessionId: 'owner-session', id: 'user-1', text: '比较两个读书计划，形成适合我的安排' }
const input = { title: '读书安排', criteria: ['能依据实际空闲时间执行'] }
const initiative: InitiativeRequest = { kind: 'self', sessionId: 'owner-session', id: 'initiative-1', text: '复查读书安排的可执行性',
  reason: '实际执行记录显示需要调整；沿用本人允许持续跟进的长期授权', grantRevision: 2 }
const allowed: ServiceOptions = { initiativeAllowed: source => source.grantRevision === 2 }

describe('SuperAgent核心上的个人任务', () => {
  it('拒绝决定保留真实来源并阻止同一请求随后产生委派', async () => {
    const { app, transport } = fixture()
    const turn = { sessionId: request.sessionId, startSeq: 7, throughSeq: 11, callId: 'decline' }
    const decision = app.decline(request, '没有共同依据，决定不做', turn.callId, turn)
    expect(decision).toMatchObject({ kind: 'ignore', audit: { source: { kind: 'owner', ...request }, decidedBy: 'self', turn } })
    expect(app.decline(request, '再次尝试', 'other-call').id).toBe(decision.id)
    expect(() => app.open(request, input)).toThrow(/已经被拒绝|已被拒绝/)
    await app.effects.idle()
    expect(transport.ensure).not.toHaveBeenCalled()
    const later = { ...request, id: 'new-owner-request' }
    app.open(later, input)
    expect(() => app.decline(later, '已经承接', 'too-late')).toThrow(/已进入工作/)
  })
  it('意向修订停止旧版本委派，继续需要新依据，独立本人任务仍然有效', async () => {
    let revision = 1
    const { app, transport } = fixture(2, { ...allowed, intentCurrent: intent => intent.id === 'intent' && intent.revision === revision })
    const task = app.open({ ...initiative, intent: { id: 'intent', revision: 1 } }, input)
    const separate = app.open(request, { title: '独立的本人请求' })
    await app.effects.idle()
    expect(app.book.get(task.id).source).toMatchObject({ intent: { id: 'intent', revision: 1 } })
    revision = 2
    expect(() => app.assertTaskIntent(task.id)).toThrow(/意向版本已失效/)
    app.reconcileIntents()
    expect(app.require(task.id).ended).toMatchObject({ by: 'executor', outcome: 'dropped' })
    expect(app.require(separate.id).ended).toBeUndefined()
    expect(transport.stop).toHaveBeenCalledWith(workerId(task))
    expect(() => app.followup(task.id, { ...initiative, id: 'old-continuation' })).toThrow(/意向版本已失效/)
    const successor = app.followup(task.id, { ...initiative, id: 'new-continuation', intent: { id: 'intent', revision: 2 } })
    expect(successor.id).not.toBe(task.id)
    expect(app.book.get(successor.id)).toMatchObject({ parentTicketId: task.id, source: { intent: { id: 'intent', revision: 2 } } })
  })
  it('保留本人原话与模型执行停止的判断，且真正撤销工作', async () => {
    const { app, transport } = fixture(), task = app.open(request, input)
    await app.effects.idle()
    const stopRequest = { ...request, id: 'stop-request', text: '停止读书安排任务' }
    const turn = { sessionId: request.sessionId, startSeq: 30, throughSeq: 38, callId: 'stop' }
    const result = app.stopTask(task.id, '依据本人当前的要求执行停止', turn, stopRequest)
    expect(result.task.ended).toMatchObject({ by: 'human', outcome: 'stopped' })
    expect(result).toMatchObject({ decision: { kind: 'stop', audit: { source: { kind: 'owner', ...stopRequest }, decidedBy: 'self', turn } } })
    expect(transport.stop).toHaveBeenCalledWith(workerId(task))
  })
  it('同一请求重试只有一个任务，启动独立执行会话并持久交付输入', async () => {
    const { app, transport } = fixture(), task = app.open(request, input)
    expect(app.open(request, input).id).toBe(task.id)
    await app.effects.idle()
    const current = app.require(task.id)
    expect(app.store.tickets.list()).toHaveLength(1)
    expect(transport.ensure).toHaveBeenCalledWith(workerId(task), task.execution!.directory, task.title, request.sessionId)
    expect(current.undelivered).toHaveLength(0)
    expect(app.book.get(task.id).source.kind).toBe('owner')
    expect(app.store.triggers.get(task.origin.triggerId)?.human).toBe(true)
  })
  it('实际成果可以直接交付，证据和限度保存，结构化形态不成为必经流程', async () => {
    const { app, transport } = fixture(), task = app.open(request, { title: '读书安排' }); await app.effects.idle()
    const evidence = app.book.evidence(task.id, { kind: 'artifact', reference: 'reading-plan.md', content: '逐日时段与章节安排' })
    app.report(task.id, { state: 'ready', summary: '安排已形成：reading-plan.md' }, '尚待实际生活检验', [evidence.id], '逐日对应现有空闲时段')
    await app.effects.idle()
    expect(app.require(task.id).ended?.outcome).toBe('completed')
    expect(app.book.get(task.id).frames).toEqual([])
    expect(app.book.get(task.id).result).toMatchObject({ evidenceIds: [evidence.id], limits: '尚待实际生活检验', check: '逐日对应现有空闲时段' })
    expect(vi.mocked(transport.send).mock.calls.some(call => call[0] === request.sessionId && call[2].includes('reading-plan.md'))).toBe(true)
    expect(transport.stop).not.toHaveBeenCalled()
  })
  it('自主任务引用长期授权，持久来源不会伪造本人发言', async () => {
    const { app, transport } = fixture(2, allowed), task = app.open(initiative, input)
    await app.effects.idle()
    expect(app.open(initiative, input).id).toBe(task.id)
    expect(task.mandate.actor.id).toBe('spirit'); expect(task.mandate.strength).toBe('inferred')
    expect(app.store.triggers.get(task.origin.triggerId)).toMatchObject({ human: false, actor: { id: 'spirit' }, meta: { request: initiative } })
    expect(app.book.get(task.id).evidence[0]).toMatchObject({ kind: 'initiative', source: initiative })
    expect(app.book.get(task.id).evidence.some(item => item.kind === 'user')).toBe(false)
    expect(vi.mocked(transport.send).mock.calls[0]?.[2]).toContain('不是新的本人消息')
  })
  it('未授予或已改变的自主权限不能发起，派发时也复核授权', async () => {
    let enabled = true
    const { app, transport } = fixture(2, { initiativeAllowed: () => enabled })
    app.open(initiative, input); enabled = false
    await app.effects.idle()
    expect(transport.ensure).not.toHaveBeenCalled()
    expect(() => app.open({ ...initiative, id: 'revoked' }, input)).toThrow(/长期授权/)
    enabled = true; app.store.db.prepare('UPDATE effect SET due=0').run(); await app.effects.idle()
    expect(transport.ensure).toHaveBeenCalledTimes(1)
    const disabled = fixture()
    expect(() => disabled.app.open(initiative, input)).toThrow(/长期授权/)
  })
  it('自主跟进运行任务维持真实来源，同一决策重试不会多开轮次', async () => {
    const { app } = fixture(2, allowed), task = app.open(request, input); await app.effects.idle(); app.idle(task.id)
    const current = app.followup(task.id, initiative)
    expect(current.id).toBe(task.id)
    expect(current.inputs.at(-1)).toMatchObject({ kind: 'trigger' })
    expect(current.inputs.at(-1)).not.toHaveProperty('human')
    expect(app.book.get(task.id).latestSource).toEqual(initiative)
    expect(app.book.get(task.id).round).toBe(2)
    app.followup(task.id, initiative)
    expect(app.book.get(task.id).round).toBe(2)
    expect(app.store.threads.get(`personal:${task.origin.triggerId}`)?.pending).toEqual([])
  })
  it('已完成任务的自主跟进建立关联任务，保留原结果而非冒充本人重开', async () => {
    const { app } = fixture(2, allowed), task = app.open(request, input); await app.effects.idle()
    app.report(task.id, { state: 'ready', summary: '第一版计划' }); app.idle(task.id)
    const next = app.followup(task.id, initiative)
    expect(next.id).not.toBe(task.id); expect(app.followup(task.id, initiative).id).toBe(next.id)
    expect(app.book.get(next.id)).toMatchObject({ parentTicketId: task.id, source: initiative })
    expect(app.require(task.id).ended?.outcome).toBe('completed')
    expect(app.book.get(task.id).results[0]?.text).toBe('第一版计划')
  })
  it('并发上限约束真实任务，而不是只限制启动函数', async () => {
    const { app, transport } = fixture(1), first = app.open(request, input)
    app.open({ ...request, id: 'user-2' }, { ...input, title: '另一件事' })
    await app.effects.idle()
    expect(transport.ensure).toHaveBeenCalledTimes(1); expect(app.busy.size).toBe(1)
    app.idle(first.id)
    app.store.db.prepare('UPDATE effect SET due=0').run(); await app.effects.idle()
    expect(transport.ensure).toHaveBeenCalledTimes(2)
  })
  it('停止撤回任务授权；本人或自主消息均不能自动复活', async () => {
    const { app, transport } = fixture(2, allowed), task = app.open(request, input); await app.effects.idle()
    app.engine.stopTicket(task.id, '本人停止'); await Promise.resolve()
    expect(transport.stop).toHaveBeenCalledWith(workerId(task))
    expect(() => app.followup(task.id, { ...request, id: 'user-2' })).toThrow(/停止/)
    expect(() => app.followup(task.id, initiative)).toThrow(/停止/)
  })
  it('初始化和本人暂停均阻止持久队列派发，恢复后处理已接收请求', async () => {
    let paused = true
    const { app, transport } = fixture(2, { paused: () => paused }), task = app.open(request, input)
    await app.effects.idle(); expect(transport.ensure).not.toHaveBeenCalled()
    paused = false; app.refresh(); await app.effects.idle(); expect(transport.ensure).toHaveBeenCalledTimes(1)
    app.report(task.id, { state: 'ready', summary: '第一轮成果' }); app.idle(task.id)
    paused = true; transport.send = vi.fn(async () => {})
    app.followup(task.id, { ...request, id: 'user-2', text: '继续检查' })
    await app.effects.idle(); expect(transport.send).not.toHaveBeenCalled()
    expect(app.require(task.id).ended).toBeDefined()
    paused = false; app.refresh(); await app.effects.idle()
    expect(app.require(task.id).ended).toBeUndefined(); expect(transport.send).toHaveBeenCalled()
  })
  it('准备会话期间发生暂停，也不能越过暂停开始执行', async () => {
    let paused = false, release!: () => void
    const { app, transport } = fixture(2, { paused: () => paused })
    transport.ensure = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    app.open(request, input)
    await Promise.resolve(); await Promise.resolve()
    paused = true; release(); await app.effects.idle()
    expect(transport.send).not.toHaveBeenCalled(); expect(app.busy.size).toBe(0)
  })
  it('恢复保留原会话、经验和检查提示，不把宿主重启变成本人请求', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spirit-restart-')), transport = transportFixture()
    const first = new PersonalService(dir, transport), task = first.open(request, input)
    await first.effects.idle()
    const admitted = new Map(vi.mocked(transport.send).mock.calls.map(call => [`${call[0]}:${call[1]}`, call[2]]))
    await first.stop()
    transport.send = vi.fn(async (sessionId, id, text) => {
      const previous = admitted.get(`${sessionId}:${id}`)
      if (previous !== undefined && previous !== text) throw new Error('消息ID内容冲突')
      admitted.set(`${sessionId}:${id}`, text)
    })
    const recovered = new PersonalService(dir, transport)
    cleanup.push(async () => { await recovered.stop(); rmSync(dir, { recursive: true, force: true }) })
    await recovered.effects.idle()
    expect(workerId(recovered.require(task.id))).toBe(workerId(task))
    expect(recovered.require(task.id).attention).toBeUndefined()
    expect(recovered.book.get(task.id).round).toBe(1)
    expect(recovered.book.get(task.id).recovery?.instruction).toContain('不要重复执行')
    expect(vi.mocked(transport.send).mock.calls.some(call => call[2].includes('不要重复执行'))).toBe(true)
    expect(recovered.pending()[0]?.experience.source.kind).toBe('owner')
    expect(recovered.effects.pending('launch')).toBe(false); expect(recovered.effects.pending('delivery')).toBe(false)
  })
  it('重启不会越过本人暂停、已停止任务或待本人回答的阻碍', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spirit-paused-restart-')), transport = transportFixture()
    const first = new PersonalService(dir, transport), blocked = first.open(request, input)
    const stopped = first.open({ ...request, id: 'stop' }, { title: '已停止' })
    await first.effects.idle()
    first.report(blocked.id, { state: 'blocked', summary: '需要本人补充当前班表', question: '本周哪些日子加班？' }); first.idle(blocked.id)
    first.engine.stopTicket(stopped.id, '本人停止'); await first.effects.idle(); await first.stop()
    vi.mocked(transport.send).mockClear(); vi.mocked(transport.ensure).mockClear()
    const recovered = new PersonalService(dir, transport, 2, undefined, { paused: () => true })
    cleanup.push(async () => { await recovered.stop(); rmSync(dir, { recursive: true, force: true }) })
    await recovered.effects.idle()
    expect(transport.ensure).not.toHaveBeenCalled(); expect(transport.send).not.toHaveBeenCalled()
    expect(recovered.require(blocked.id).attention?.question).toBe('本周哪些日子加班？')
    expect(recovered.require(stopped.id).ended?.by).toBe('human')
  })
  it('模型可依据已解决的运行故障自行跟进，但不会伪造本人回答', async () => {
    const { app } = fixture(2, allowed), task = app.open(request, input); await app.effects.idle()
    app.report(task.id, { state: 'failed', summary: '文件暂时不可读' }); app.idle(task.id)
    const next = app.followup(task.id, initiative)
    expect(next.assignments).toHaveLength(2)
    expect(app.book.get(task.id).latestSource.kind).toBe('self')
    await app.effects.idle()
    app.report(task.id, { state: 'blocked', summary: '需要班表', question: '本周哪些日子加班？' }); app.idle(task.id)
    const held = app.followup(task.id, { ...initiative, id: 'review' })
    expect(held.attention?.question).toBe('本周哪些日子加班？'); expect(held.assignments).toHaveLength(2)
  })
  it('同一时钟毫秒内的真实本人跟进也能解除阻碍', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-15T13:00:00Z'))
    const { app, transport } = fixture(), task = app.open(request, input); await app.effects.idle()
    app.report(task.id, { state: 'blocked', summary: '需要时间安排', question: '哪天加班？' }); app.idle(task.id)
    vi.mocked(transport.send).mockClear()
    app.followup(task.id, { ...request, id: 'answer', text: '周二加班，其余工作日晚间有空' })
    await app.effects.idle()
    expect(vi.mocked(transport.send).mock.calls.some(call => call[0] === workerId(task) && call[2].includes('周二加班'))).toBe(true)
  })
  it('原自主授权已变更时，本人的真实继续请求建立新的本人授权任务', async () => {
    let grant = true
    const { app } = fixture(2, { initiativeAllowed: () => grant }), task = app.open(initiative, input); await app.effects.idle()
    app.report(task.id, { state: 'ready', summary: '初步复查完成' }); app.idle(task.id); grant = false
    const continued = app.followup(task.id, { ...request, id: 'new-owner-request', text: '请继续检查最新记录' })
    expect(continued.id).not.toBe(task.id); expect(continued.mandate.actor.id).toBe('owner')
    expect(app.book.get(continued.id)).toMatchObject({ parentTicketId: task.id, source: { kind: 'owner', id: 'new-owner-request' } })
    expect(app.require(task.id).ended?.outcome).toBe('completed')
  })
  it('原自主授权变更后，新的自主判断为运行任务建立当前授权下的后继', async () => {
    let revision = 2
    const { app, transport } = fixture(2, { initiativeAllowed: source => source.grantRevision === revision })
    const task = app.open(initiative, input); await app.effects.idle()
    app.book.evidence(task.id, { kind: 'artifact', reference: 'partial.md', content: '已经形成的局部结果' })
    revision = 3
    const nextSource = { ...initiative, id: 'reconsidered', grantRevision: 3, text: '检查局部结果后继续', reason: '在当前长期授权下重新判断仍应继续' }
    const next = app.followup(task.id, nextSource)
    expect(next.id).not.toBe(task.id); expect(next.mandate.basis.scope?.request).toEqual(nextSource)
    expect(app.book.get(next.id)).toMatchObject({ parentTicketId: task.id, source: nextSource })
    expect(app.require(task.id).ended).toMatchObject({ by: 'executor', outcome: 'dropped' })
    expect(app.book.get(task.id).source).toEqual(initiative)
    await app.effects.idle()
    expect(vi.mocked(transport.send).mock.calls.some(call => call[0] === workerId(next) && call[2].includes(task.execution!.directory))).toBe(true)
  })
  it('运行中旧自主授权失效时，本人的真实跟进建立本人授权后继', async () => {
    let granted = true
    const { app } = fixture(2, { initiativeAllowed: () => granted }), task = app.open(initiative, input); await app.effects.idle()
    granted = false
    const next = app.followup(task.id, { ...request, id: 'direct-followup', text: '请继续检查局部结果' })
    expect(next.id).not.toBe(task.id); expect(next.mandate.actor.id).toBe('owner')
    expect(app.book.get(next.id).parentTicketId).toBe(task.id)
    expect(app.require(task.id).ended).toMatchObject({ by: 'executor', outcome: 'dropped' })
  })
  it('授权变更后的自主判断仍不能取代待本人的真实答复', async () => {
    let revision = 2
    const { app, transport } = fixture(2, { initiativeAllowed: source => source.grantRevision === revision })
    const task = app.open(initiative, input); await app.effects.idle()
    app.report(task.id, { state: 'blocked', summary: '需要真实班表', question: '本周哪些日子加班？' }); app.idle(task.id); await app.effects.idle()
    vi.mocked(transport.send).mockClear(); revision = 3
    const held = app.followup(task.id, { ...initiative, id: 'revisit-blocked', grantRevision: 3 })
    await app.effects.idle()
    expect(held.id).toBe(task.id); expect(app.store.tickets.list()).toHaveLength(1)
    expect(held.attention?.question).toBe('本周哪些日子加班？'); expect(transport.send).not.toHaveBeenCalled()
    const answered = app.followup(task.id, { ...request, id: 'real-answer', text: '本周三加班，其余日子照常' })
    expect(answered.id).not.toBe(task.id); expect(answered.mandate.actor.id).toBe('owner')
  })
  it('派发已接收但确认失败后，经验变化也不会改变同一消息ID的重试内容', async () => {
    const { app, transport } = fixture()
    const admitted = new Map<string, string>(); let fail = true
    transport.send = vi.fn(async (sessionId, id, text) => {
      const key = `${sessionId}:${id}`, previous = admitted.get(key)
      if (previous !== undefined && previous !== text) throw new Error('消息ID内容冲突')
      admitted.set(key, text)
      if (fail) { fail = false; throw new Error('接收后持久确认中断') }
    })
    const task = app.open(request, input); await app.effects.idle()
    app.book.evidence(task.id, { kind: 'observation', reference: 'retry-change', content: '重试前新增材料' })
    app.store.db.prepare('UPDATE effect SET due=0').run(); await app.effects.idle()
    const calls = vi.mocked(transport.send).mock.calls
    expect(calls).toHaveLength(2); expect(calls[1]![2]).toBe(calls[0]![2]); expect(app.effects.pending('launch')).toBe(false)
  })
  it('报告事务失败不留下虚假的完成记录', async () => {
    const { app } = fixture(), task = app.open(request, input); await app.effects.idle()
    expect(() => app.report(task.id, { state: 'ready', summary: '成果', question: '仍需要问本人' })).toThrow()
    expect(app.book.get(task.id).result).toBeUndefined(); expect(app.book.get(task.id).results).toEqual([])
  })
  it('面板拒绝跨站写入及非回环Host', () => {
    expect(sameOrigin({ headers: { host: '127.0.0.1:3080', 'x-personal-spirit': '1' } }, 3080)).toBe(true)
    expect(sameOrigin({ headers: { host: '127.0.0.1:3080', origin: 'https://example.com', 'x-personal-spirit': '1' } }, 3080)).toBe(false)
    expect(sameOrigin({ headers: { host: 'attacker.example:3080', 'x-personal-spirit': '1' } }, 3080)).toBe(false)
  })
})
