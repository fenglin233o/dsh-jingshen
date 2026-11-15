import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../upstream/src/app/store.ts'
import { ExperienceBook } from '../src/experience.ts'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()))
function fixture(maxRevisions = Number.POSITIVE_INFINITY, firstClaim = '每日两小时是衡量学习的尺度') {
  const dir = mkdtempSync(join(tmpdir(), 'spirit-experience-')), store = new Store(join(dir, 'state.sqlite')),
    book = new ExperienceBook(store, maxRevisions)
  cleanup.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
  book.create('task', 'owner', 'message-1', '整理适合我的学习安排', ['每天投入两小时', '不损害睡眠'])
  const frame = book.frame('task', { object: '学习安排是每日时长的分配',
    claims: [{ statement: firstClaim, evidenceIds: ['request'] }, { statement: '睡眠需要保留', evidenceIds: ['request'] }], limits: '尚未经过实际一周的检验' })
  const evidence = book.evidence('task', { kind: 'observation', reference: '一周学习记录', content: '加班日两小时挤压睡眠，而较短时段仍能完成练习' })
  return { store, book, frame, evidence }
}
function examine(f: ReturnType<typeof fixture>, contradicted = true, criterion = false) {
  return f.book.examine('task', { frame: f.frame.number,
    checks: f.frame.criteria.map(item => ({ criterionId: item.id, outcome: contradicted ? 'unmet' : 'met', evidenceIds: [f.evidence.id], reason: '与实际记录比较' })),
    contradictions: contradicted && !criterion ? [{ claimId: f.frame.claims[0]!.id, evidenceIds: [f.evidence.id], reason: '增加时长反而破坏了可持续的学习' }] : [],
    criterionContradictions: criterion ? [{ criterionId: f.frame.criteria[0]!.id, evidenceIds: [f.evidence.id], reason: '时长这一尺度不能衡量实际学习所得' }] : [],
  })
}
describe('由经验产生的理解变化', () => {
  it('保留有效内容和旧形态，不把新知识写回过去', () => {
    const f = fixture(); examine(f)
    const old = f.book.get('task').frames[0]!
    const next = f.book.revise('task', { frame: 1, negated: [old.claims[0]!.id], preserved: [old.claims[1]!.id],
      object: '学习安排须放回工作与休息的关系中理解', replacements: [{ statement: '按实际可用时段与练习结果安排', evidenceIds: [f.evidence.id] }],
      reason: '原安排在自己的可持续要求上失败', limits: '新安排尚待验证' })
    expect(next.claims[0]).toEqual(old.claims[1]); expect(f.book.get('task').frames[0]).toEqual(old)
    expect(next.transition?.negated).toEqual([old.claims[0]!.id])
    f.book.complete('task', '已形成下一版安排', '新安排尚待实际检验')
    expect(f.book.get('task').result?.limits).toBe('新安排尚待实际检验')
  })
  it('尺度可以因自身矛盾改变；不只允许更换答案', () => {
    const f = fixture(4, '本人希望继续学习'); examine(f, true, true)
    const next = f.book.revise('task', { frame: 1, negated: [], preserved: f.frame.claims.map(item => item.id), object: '学习的内容与生活的关系',
      replacements: [], reason: '时长与学习的目的发生不一致', limits: '试行一周',
      criterionChanges: [{ criterionId: 'criterion-1', replacement: '能解释并独立应用本周所学', reason: '保留学习目的，否定时长作为唯一标准' }] })
    expect(next.criteria[0]!.text).toContain('独立应用'); expect(f.book.get('task').frames[0]!.criteria[0]!.text).toBe('每天投入两小时')
  })
  it('不能为了过关直接改掉尺度', () => {
    const f = fixture(); examine(f, false)
    expect(() => f.book.revise('task', { frame: 1, negated: [], preserved: f.frame.claims.map(item => item.id), object: '改变对象', replacements: [], reason: '方便成功', limits: '无',
      criterionChanges: [{ criterionId: 'criterion-1', replacement: '做了就算成功', reason: '更容易' }] })).toThrow(/尺度修订/)
  })
  it('否定具体判断需要可追溯的反例，不能发明矛盾', () => {
    const f = fixture(); examine(f, false)
    expect(() => f.book.revise('task', { frame: 1, negated: [f.frame.claims[0]!.id], preserved: [f.frame.claims[1]!.id], object: '新对象',
      replacements: [{ statement: '新判断', evidenceIds: [f.evidence.id] }], reason: '想更换', limits: '待检验' })).toThrow(/具体依据/)
  })
  it('不能无声丢弃旧判断，也不能只留下空的否定', () => {
    const f = fixture(); examine(f)
    expect(() => f.book.revise('task', { frame: 1, negated: [f.frame.claims[0]!.id], preserved: [], object: '新对象', replacements: [], reason: '改变', limits: '无' })).toThrow(/无声丢弃/)
  })
  it('不接受缺少检验项、虚构引用或只用推断证明完成', () => {
    const f = fixture(), imagined = f.book.evidence('task', { kind: 'inference', reference: '假设', content: '应该会有效' })
    expect(() => f.book.examine('task', { frame: 1, checks: [], contradictions: [] })).toThrow()
    expect(() => f.book.examine('task', { frame: 1, checks: f.frame.criteria.map(item => ({ criterionId: item.id, outcome: 'met', reason: '预测', evidenceIds: [imagined.id] })), contradictions: [] })).toThrow(/推断不能/)
    expect(() => f.book.evidence('task', { kind: 'user', reference: '伪装本人', content: '我同意' })).toThrow()
  })
  it('一次完成不证明下一轮也完成', () => {
    const f = fixture(); examine(f, false); f.book.complete('task', '第一轮成果', '实际记录支持')
    f.book.userEvidence('task', 'new-request', '现在我的工作时间变了')
    expect(f.book.get('task').result).toBeUndefined()
    expect(f.book.get('task').results).toHaveLength(1)
    expect(f.book.get('task').results[0]?.text).toBe('第一轮成果')
    f.book.userEvidence('task', 'new-request', '现在我的工作时间变了')
    expect(f.book.get('task').round).toBe(2)
  })
  it('未完成的任务也可以提出记忆；提出不等于本人确认', () => {
    const f = fixture()
    const memory = f.book.propose('task', f.frame.claims[1]!.id, 'preference')
    expect(f.book.memories('accepted')).toHaveLength(0)
    f.book.decideMemory(memory.id, 'accept'); expect(f.book.memories('accepted')).toHaveLength(1)
    f.book.decideMemory(memory.id, 'forget'); expect(f.book.memories('accepted')).toHaveLength(0)
    expect(f.book.memories()[0]!.statement).toBe(''); expect(f.book.get('task').frames[0]).toEqual(f.frame)
  })
  it('事务失败时，经验变化随任务一起回滚', () => {
    const f = fixture()
    expect(() => f.store.atomic(() => { f.book.userEvidence('task', 'rollback', '不应留下'); throw new Error('失败') })).toThrow('失败')
    expect(f.book.get('task').round).toBe(1)
  })
})

describe('可选反思与持续学习', () => {
  it('无形态也能记录限定成果，不能虚构所引用的证据', () => {
    const f = fixture()
    f.book.create('simple', 'owner', 'simple-request', '记录今天的阅读内容', [])
    const evidence = f.book.evidence('simple', { kind: 'artifact', reference: 'notes.md', content: '整理好的阅读札记' })
    f.book.complete('simple', '札记已保存', '尚未与其他版本对读', [evidence.id], '文件可读且包含本次阅读内容')
    expect(f.book.get('simple').result).toMatchObject({ evidenceIds: [evidence.id], round: 1 })
    expect(f.book.get('simple').result?.frame).toBeUndefined()
    expect(() => f.book.complete('simple', '另一个结果', '', ['invented'])).toThrow(/未知证据/)
  })
  it('局部未知与未解决判断保留，不阻止交付范围明确的实际成果', () => {
    const f = fixture(); examine(f)
    const exam = f.book.get('task').examinations[0]
    f.book.complete('task', '已交付第一周的记录和下一周试行安排', '学习成效尚有未知；原两小时尺度的矛盾仍待处理', [f.evidence.id], '记录与实际空闲时段吻合')
    expect(f.book.get('task').examinations[0]).toEqual(exam)
    expect(f.book.get('task').result?.limits).toContain('矛盾仍待处理')
  })
  it('结构化修订默认没有终身四次上限，旧判断和检查仍完整保留', () => {
    const f = fixture(), preserved = f.frame.claims[1]!.id
    for (let week = 1; week <= 6; week++) {
      const previous = f.book.get('task').frames.at(-1)!, claim = previous.claims.find(item => item.id !== preserved)!
      const evidence = f.book.evidence('task', { kind: 'observation', reference: `week-${week}`, content: `第${week}周加班记录与上次可用时段估计不一致` })
      f.book.examine('task', { frame: previous.number, checks: previous.criteria.map(item => ({ criterionId: item.id,
        outcome: 'unmet', evidenceIds: [evidence.id], reason: '本周实际可用时段与估计不符' })),
        contradictions: [{ claimId: claim.id, evidenceIds: [evidence.id], reason: '实际时间安排不同于上周估计' }] })
      f.book.revise('task', { frame: previous.number, negated: [claim.id], preserved: [preserved], object: `第${week}周学习与生活关系`,
        replacements: [{ statement: `依据第${week}周记录重新分配学习时段`, evidenceIds: [evidence.id] }], reason: '已有安排不能涵盖本周变化', limits: '新时段仍需要检验' })
    }
    expect(f.book.get('task').frames).toHaveLength(7)
    expect(f.book.get('task').frames[0]).toEqual(f.frame)
    expect(f.book.get('task').examinations).toHaveLength(6)
  })
  it('普通细化可以写入追加式反思，无需制造否定或覆盖旧理解', () => {
    const f = fixture()
    const first = f.book.reflect('task', { source: '一周观察', previous: '时长尚不清楚', new: '可用时长随工作日变化', reason: '增加了更细的观察范围',
      check: '比较每日记录', limits: '只覆盖本周', evidenceIds: [f.evidence.id] })
    const second = f.book.reflect('task', { new: '周末与工作日应分别估计', details: { openQuestion: '周末的其他事务' } })
    expect(f.book.reflections('task')).toEqual([first, second])
    expect(f.book.get('task').frames).toEqual([f.frame])
    expect(f.book.get('task').examinations).toEqual([])
    expect(f.book.context('task').reflections[0]?.provenance.kind).toBe('model')
    expect(() => f.book.reflect('task', { new: '来自不存在材料', evidenceIds: ['invented'] })).toThrow(/未知证据/)
  })
  it('自主发起的来源不能当作用户发言或实际检验的凭据', () => {
    const f = fixture(), source = { kind: 'self' as const, sessionId: 'owner', id: 'model-choice', text: '重新观察睡眠安排', reason: '持续跟进的需要', grantRevision: 3 }
    f.book.create('initiative', 'owner', source.id, source.text, ['观察实际睡眠'], source)
    const frame = f.book.frame('initiative', { object: '睡眠', claims: [{ statement: '需要观察', evidenceIds: ['request'] }], limits: '尚未观察' })
    expect(f.book.get('initiative').source).toEqual(source)
    expect(f.book.get('initiative').evidence[0]?.kind).toBe('initiative')
    expect(() => f.book.examine('initiative', { frame: 1, checks: frame.criteria.map(item => ({ criterionId: item.id,
      outcome: 'met', reason: '自主计划', evidenceIds: ['request'] })), contradictions: [] })).toThrow(/推断不能/)
    expect(() => f.book.evidence('initiative', { kind: 'initiative', reference: 'pretend', content: '我已获授权' })).toThrow()
  })
  it('运行中的假设可形成自主记忆，后续修订保留旧版本与来源', () => {
    const f = fixture()
    const first = f.book.remember('task', { kind: 'practice', statement: '加班日先安排较短时段', evidenceIds: [f.evidence.id],
      reason: '一周记录支持这种尝试', limits: '仍是待检验的做法' })
    expect(first.state).toBe('active'); expect(first.ownerConfirmed).toBe(false)
    expect(first.provenance).toMatchObject({ kind: 'model', reference: 'message-1' })
    expect(f.book.usableMemories()).toHaveLength(1)
    f.book.decideMemory(first.id, 'accept')
    const nextInput = { kind: 'practice', statement: '加班日根据疲劳情况安排短时段或休息', replaces: first.id, reason: '休息也应纳入选择', limits: '仍须实际检验' }
    const next = f.book.remember('task', nextInput)
    expect(next.state).toBe('active'); expect(next.ownerConfirmed).toBe(false)
    expect(f.book.remember('task', nextInput).id).toBe(next.id)
    const history = f.book.memories().find(item => item.id === first.id)!
    expect(history.statement).toBe(first.statement); expect(history.state).toBe('superseded'); expect(history.ownerConfirmed).toBe(true)
    expect(history.history.at(-1)).toMatchObject({ action: 'supersede', replacementId: next.id })
    expect(f.book.usableMemories().map(item => item.id)).toEqual([next.id])
  })
  it('任务记忆记录实际模型工具调用来源，不借用最近用户请求', () => {
    const f = fixture(), input = { kind: 'practice', statement: '依实际记录调整学习安排', evidenceIds: [f.evidence.id] }
    const source = { sessionId: 'worker-session', id: 'tool-call-1', text: '根据一周记录保留工作方法' }
    const first = f.book.remember('task', input, source)
    expect(first.provenance).toMatchObject({ kind: 'model', reference: source.id, sessionId: source.sessionId, context: source.text })
    expect(first.provenance.reference).not.toBe('message-1'); expect(first.ownerConfirmed).toBe(false)
    expect(f.book.remember('task', input, source).id).toBe(first.id)
    const second = f.book.remember('task', input, { ...source, id: 'tool-call-2', text: '第二次独立审视后记录此做法' })
    expect(second.id).not.toBe(first.id); expect(second.provenance.reference).toBe('tool-call-2')
    expect(f.book.memories()).toHaveLength(2)
  })
  it('本人可以确认、纠正、拒绝及忘记自主记忆，纠正生成可追溯版本', () => {
    const f = fixture(), first = f.book.remember('task', { kind: 'preference', statement: '本人似乎喜欢晚间学习', limits: '仅由本周记录推测' })
    const corrected = f.book.decideMemory(first.id, 'correct', { statement: '本人更喜欢清晨学习', reason: '本人说明的偏好' })
    expect(corrected).toMatchObject({ state: 'accepted', ownerConfirmed: true, replaces: first.id, provenance: { kind: 'owner' } })
    expect(f.book.memories().find(item => item.id === first.id)?.statement).toBe(first.statement)
    f.book.decideMemory(corrected.id, 'reject')
    expect(f.book.usableMemories()).toEqual([])
    f.book.decideMemory(corrected.id, 'forget')
    expect(f.book.memories().find(item => item.id === corrected.id)).toMatchObject({ state: 'forgotten', statement: '', evidenceIds: [], provenance: { reference: '' } })
    expect(f.book.get('task').frames).toEqual([f.frame])
  })
  it('普通会话也能学习并反思，不要求先虚构一个完成任务', () => {
    const f = fixture(), source = { sessionId: 'owner', id: 'discussion-1', text: '我们刚讨论了今后的作息安排' }
    const memory = f.book.rememberGlobal({ kind: 'practice', statement: '先观察实际作息再排计划', reason: '本次讨论后形成的工作方法' }, source)
    const reflection = f.book.reflect(undefined, { source: source.id, new: '对作息的理解仍需真实记录校正' }, source)
    expect(memory.ticketId).toBe(''); expect(memory.provenance).toMatchObject({ kind: 'model', reference: source.id, context: source.text })
    expect(memory.ownerConfirmed).toBe(false); expect(reflection.ticketId).toBeUndefined()
    expect(f.book.reflections()).toEqual([reflection])
    expect(() => f.book.rememberGlobal({ kind: 'fact', statement: '假内容', evidenceIds: ['pretend'] }, source)).toThrow(/任务记录/)
    expect(() => f.book.rememberGlobal({ kind: 'fact', statement: '本人已同意', ownerConfirmed: true }, source)).toThrow()
  })
  it('持久重开保留完成史、反思、记忆状态及真实来源', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spirit-book-restart-')), file = join(dir, 'state.sqlite')
    const first = new Store(file), book = new ExperienceBook(first)
    const source = { kind: 'self' as const, sessionId: 'owner', id: 'choice', text: '审视已有结果', reason: '发现需要补充的范围', grantRevision: 5 }
    book.create('durable', 'owner', source.id, source.text, [], source)
    const memory = book.remember('durable', { kind: 'practice', statement: '在检查后安排下一步' })
    book.reflect('durable', { new: '已补充结果的适用范围' }); book.complete('durable', '一轮观察结束', '仅适用于已有材料')
    book.userEvidence('durable', 'new-user', '再看一个例子'); first.close()
    const second = new Store(file), restored = new ExperienceBook(second)
    cleanup.push(() => { second.close(); rmSync(dir, { recursive: true, force: true }) })
    expect(restored.get('durable')).toMatchObject({ source, latestSource: { kind: 'owner', id: 'new-user' }, round: 2 })
    expect(restored.get('durable').result).toBeUndefined(); expect(restored.get('durable').results).toHaveLength(1)
    expect(restored.reflections('durable')).toHaveLength(1)
    expect(restored.usableMemories()[0]).toMatchObject({ id: memory.id, ownerConfirmed: false })
  })
  it('早期记录可读取，不把过去的模型提议升级为本人确认', () => {
    const f = fixture(), old = f.book.get('task')
    const { source: _source, latestSource: _latest, requests: _requests, results: _results, reflections: _reflections, ...legacy } = old
    f.store.db.prepare('UPDATE spirit_experience SET value=? WHERE id=?').run(JSON.stringify({ ...legacy, result: { text: '历史结果', limits: '历史范围', frame: 1, at: '2026-01-01' } }), 'task')
    f.store.db.prepare('INSERT INTO spirit_memory VALUES (?,?)').run('old-memory', JSON.stringify({ id: 'old-memory', kind: 'practice', statement: '历史提议',
      ticketId: 'task', claimId: f.frame.claims[0]!.id, evidenceIds: ['request'], state: 'proposed', createdAt: '2026-01-01', updatedAt: '2026-01-01' }))
    expect(f.book.get('task').source.kind).toBe('owner')
    expect(f.book.get('task').results[0]?.text).toBe('历史结果')
    expect(f.book.memories()[0]).toMatchObject({ state: 'proposed', ownerConfirmed: false, provenance: { kind: 'model' } })
  })
})
