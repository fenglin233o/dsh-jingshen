import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../upstream/src/app/store.ts'
import { SpiritControl } from '../src/control.ts'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).reverse().forEach(cleanup => cleanup()))
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'spirit-control-')), path = join(directory, 'state.sqlite')
  let store = new Store(path), control = new SpiritControl(store)
  cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
  return {
    get store() { return store }, get control() { return control },
    restart() { store.close(); store = new Store(path); control = new SpiritControl(store); return control },
  }
}

describe('durable owner control and permission revocation', () => {
  it('starts in ask mode, preserves full mode across restart, and keeps the original standing revision valid until changed', () => {
    const f = fixture(), initial = f.control.current()
    expect(initial).toMatchObject({ mode: 'ask', state: 'running', revision: 1 })
    const selected = f.control.select({ mode: 'full' }, '本人允许持续使用完整权限')
    expect(selected.revision).toBeGreaterThan(initial.revision)
    const restored = f.restart()
    expect(restored.current()).toEqual(selected)
    expect(() => restored.assertActive(selected.revision)).not.toThrow()
    expect(() => restored.assertActive(initial.revision)).toThrow(/已改变/)
    expect(restored.activity()).toMatchObject([{ kind: 'owner-control', summary: '本人允许持续使用完整权限' }])
  })

  it('pause, permission downgrade and stop survive restart; resuming never revives an old in-flight grant', () => {
    const f = fixture(), full = f.control.select({ mode: 'full' }, '本人启用完整权限')
    f.control.select({ state: 'paused' }, '本人暂停以检查当前成果')
    expect(f.restart().current()).toMatchObject({ mode: 'full', state: 'paused' })
    expect(() => f.control.assertActive()).toThrow(/暂停/)
    const resumed = f.control.select({ state: 'running' }, '本人继续')
    expect(() => f.control.assertActive(resumed.revision)).not.toThrow()
    expect(() => f.control.assertActive(full.revision)).toThrow(/已改变/)
    const ask = f.control.select({ mode: 'ask' }, '本人要求敏感操作重新询问')
    expect(f.restart().current()).toEqual(ask)
    expect(() => f.control.assertActive(resumed.revision)).toThrow(/已改变/)
    f.control.select({ state: 'stopped' }, '本人停止活动')
    expect(() => f.restart().assertActive()).toThrow(/停止/)
    const restarted = f.control.select({ state: 'running' }, '本人明确恢复')
    expect(restarted.mode).toBe('ask')
    expect(() => f.control.assertActive(ask.revision)).toThrow(/已改变/)
    expect(() => f.control.assertActive(restarted.revision)).not.toThrow()
  })

  it('commits permission state and its owner activity together, leaving neither behind after rollback', () => {
    const f = fixture(), before = f.control.current()
    expect(() => f.store.atomic(() => {
      f.control.select({ mode: 'full', state: 'stopped' }, '不得部分提交')
      throw new Error('simulated enclosing transaction failure')
    })).toThrow('simulated enclosing transaction failure')
    expect(f.restart().current()).toEqual(before)
    expect(f.control.activity()).toEqual([])
  })

  it('does not turn an observed session into a managed session or lose managed-session provenance on restart', () => {
    const f = fixture()
    f.control.manage('main', '本人会话', '本人从精神面板进入', 'main')
    f.control.manage('task', '整理笔记', '本人请求 message-17', 'task')
    f.control.manage('initiative', '检查未完成的索引', '模型依据失败的工具记录自行继续；授权版本 1', 'initiative')
    f.control.watch('external-session', '观察上下文变化；没有接管该会话')
    expect(f.control.managed('external-session')).toBe(false)
    const original = f.control.sessions()
    const restored = f.restart()
    expect(restored.sessions()).toEqual(original)
    expect(restored.watches()).toEqual([{ id: 'external-session', reason: '观察上下文变化；没有接管该会话' }])
    expect(restored.sessions().find(item => item.id === 'initiative')).toMatchObject({ kind: 'initiative', reason: expect.stringContaining('模型') })
    restored.manage('task', '整理后的笔记', '同一任务的会话标题变化', 'task')
    expect(restored.sessions()).toHaveLength(3)
    expect(restored.sessions().find(item => item.id === 'task')!.createdAt).toBe(original.find(item => item.id === 'task')!.createdAt)
    restored.unwatch('external-session')
    expect(restored.managed('task')).toBe(true)
    expect(restored.managed('external-session')).toBe(false)
    expect(f.restart().watches()).toEqual([])
  })

  it('retains the session and stated reason of autonomous activity without rewriting it as owner control', () => {
    const f = fixture()
    const activity = f.control.record('self-initiative', '复查索引生成失败', '上一轮 shell 返回非零退出码', 'initiative')
    f.control.select({ mode: 'full' }, '本人后来选择完整权限')
    const history = f.restart().activity()
    expect(history).toHaveLength(2)
    expect(history.find(item => item.id === activity.id)).toEqual(activity)
    expect(activity.kind).toBe('self-initiative')
    expect(activity.reason).toContain('非零退出码')
    expect(activity.sessionId).toBe('initiative')
  })
})
