// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Panel } from '../src/client.tsx'

const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
globals.IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()) })
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren()
})
const base = () => ({ tasks: [], memories: [], health: {}, busy: 0, mainId: 'owner-session',
  permissions: { mode: 'ask', status: 'applied', scope: '作用于精神管理的 Harness 会话。' },
  autonomy: { state: 'running', reason: '等待具体事情。', recoverable: false },
  sessions: [], intentions: [], activity: [], changes: [],
})
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => structuredClone(body) })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function mount(open = vi.fn(async (_id: string) => {})) {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node); roots.push(root)
  await act(async () => { root.render(<Panel openSession={open} />) })
  const button = (label: string) => {
    const found = [...node.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
    if (!found) throw new Error(`没有找到按钮：${label}`)
    return found
  }
  const tab = (label: string) => [...node.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent?.startsWith(label))!
  return { node, root, open, button, tab, click: async (label: string) => { await act(async () => { button(label).click() }) } }
}

it('权限是明确提交的宿主动作，只在服务器确认后显示生效', async () => {
  const state = base(), applied = deferred<ReturnType<typeof response>>()
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/permissions')) {
      expect(init?.method).toBe('POST')
      expect(init?.headers).toMatchObject({ 'x-personal-spirit': '1', 'content-type': 'application/json' })
      expect(JSON.parse(String(init?.body))).toEqual({ mode: 'full' })
      return applied.promise
    }
    return response(state)
  })
  vi.stubGlobal('fetch', fetcher)
  const view = await mount()
  expect(view.node.querySelector<HTMLInputElement>('input[value="ask"]')?.checked).toBe(true)
  expect(view.button('应用权限').disabled).toBe(true)
  await act(async () => { view.node.querySelector<HTMLInputElement>('input[value="full"]')!.click() })
  expect(fetcher.mock.calls.filter(call => call[0].endsWith('/permissions'))).toHaveLength(0)
  expect(view.node.textContent).toContain('尚未应用所选权限')
  await view.click('应用权限')
  expect(view.node.querySelector('.spirit-permission-status')?.textContent).toBe('敏感操作询问 · 已生效')
  expect(view.button('正在应用…').disabled).toBe(true)
  state.permissions.mode = 'full'
  await act(async () => { applied.resolve(response({ ok: true })); await applied.promise })
  expect(view.node.querySelector('.spirit-permission-status')?.textContent).toBe('完全访问 · 已生效')
  expect(view.button('应用权限').disabled).toBe(true)
  expect(fetcher.mock.calls.filter(call => call[0].endsWith('/permissions'))).toHaveLength(1)
})

it('权限请求失败不会伪装成已切换，未提交选择仍可重试', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/permissions')
    ? response({ error: '原生权限预设应用失败' }, false) : response(base())))
  const view = await mount()
  await act(async () => { view.node.querySelector<HTMLInputElement>('input[value="full"]')!.click() })
  await view.click('应用权限')
  expect(view.node.querySelector('[role="alert"]')?.textContent).toContain('原生权限预设应用失败')
  expect(view.node.querySelector('.spirit-permission-status')?.textContent).toBe('敏感操作询问 · 已生效')
  expect(view.node.querySelector<HTMLInputElement>('input[value="full"]')?.checked).toBe(true)
  expect(view.button('应用权限').disabled).toBe(false)
})

it('应用失败后重新读取宿主状态，显示部分应用的问题而非沿用旧的成功状态', async () => {
  const state = base()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/permissions')) {
      state.permissions.mode = 'full'
      state.permissions.status = 'error'
      return response({ error: '一个会话未能同步权限' }, false)
    }
    return response(state)
  }))
  const view = await mount()
  await act(async () => { view.node.querySelector<HTMLInputElement>('input[value="full"]')!.click() })
  await view.click('应用权限')
  expect(view.node.querySelector('.spirit-permission-status')?.textContent).toBe('完全访问 · 应用未完成')
  expect(view.node.textContent).not.toContain('完全访问 · 已生效')
  expect(view.button('应用权限').disabled).toBe(false)
  expect(view.node.textContent).toContain('一个会话未能同步权限')
})

it('导出保持服务返回的 v2 格式和状态包装，不丢弃加载回执', async () => {
  vi.useFakeTimers()
  const exported = { format: 'spirit-export-v2', at: '2026-11-15T08:00:00Z', mainId: 'owner-session',
    state: { ...base(), activation: { receipts: [] } } }
  let blob: Blob | undefined
  class DownloadURL extends URL {
    static createObjectURL(value: Blob) { blob = value; return 'blob:spirit-export' }
    static revokeObjectURL = vi.fn()
  }
  vi.stubGlobal('URL', DownloadURL)
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('精神记录.json')
    expect(this.href).toBe('blob:spirit-export')
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/export') ? exported : base())))
  const view = await mount()
  await view.click('导出记录')
  expect(click).toHaveBeenCalledOnce()
  const reading = new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob!)
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(JSON.parse(await reading)).toEqual(exported)
  expect(DownloadURL.revokeObjectURL).toHaveBeenCalledWith('blob:spirit-export')
})

it('暂停、恢复、停止与未决思考重试都调用服务，暂停时必须先恢复活动', async () => {
  const state = base(); state.autonomy.recoverable = true
  const actions: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/control')) {
      const { action } = JSON.parse(String(init?.body)) as { action: string }; actions.push(action)
      if (action === 'pause') state.autonomy.state = 'paused'
      if (action === 'resume') state.autonomy.state = 'running'
      if (action === 'stop') state.autonomy.state = 'stopped'
      if (action === 'recover') state.autonomy.recoverable = false
    }
    return response(state)
  }))
  const view = await mount()
  await view.click('暂停活动')
  expect(view.node.querySelector('.spirit-runtime-title')?.textContent).toBe('已暂停')
  expect(view.button('重试未决思考').disabled).toBe(true)
  expect(view.node.textContent).toContain('先恢复活动，再重试未决思考')
  await view.click('恢复活动')
  expect(view.node.querySelector('.spirit-runtime-title')?.textContent).toBe('已就绪')
  expect(view.button('重试未决思考').disabled).toBe(false)
  await view.click('重试未决思考')
  expect(view.node.querySelector('.spirit-recovery')).toBeNull()
  expect(view.node.textContent).not.toContain('恢复改动记录')
  state.autonomy.recoverable = true
  await view.click('停止所有活动')
  expect(view.node.querySelector('.spirit-runtime-title')?.textContent).toBe('已停止')
  expect(view.button('停止所有活动').disabled).toBe(true)
  expect(view.button('重试未决思考').disabled).toBe(true)
  expect(actions).toEqual(['pause', 'resume', 'recover', 'stop'])
})

it('自身改动显示匹配的最新真实加载回执，不被文件记录中的 pending 覆盖', async () => {
  const at = '2026-11-15T08:00:00Z', later = '2026-11-15T09:00:00Z'
  const change = (id: string, status = 'applied') => ({ id, at, summary: `改动 ${id}`, status,
    activation: [{ target: 'spirit', required: 'plugin-reload', status: 'pending' }] })
  const receipt = (id: string, changeId: string, status: string, requestedAt = at) => ({ id, changeId, status, requestedAt, updatedAt: requestedAt })
  vi.stubGlobal('fetch', vi.fn(async () => response({ ...base(), changes: [change('a'), change('b'), change('c'), change('d', 'rolled-back'), change('e')],
    activation: { receipts: [receipt('r1', 'a', 'runtime-loaded'), receipt('r2', 'b', 'restart-required'),
      { ...receipt('r4', 'c', 'failed', later), error: '启动检查未通过' }, receipt('r3', 'c', 'runtime-loaded'), receipt('r5', 'unrelated', 'runtime-loaded')] },
  })))
  const view = await mount()
  await act(async () => { view.tab('自身改动').click() })
  const cards = [...view.node.querySelectorAll('article')]
  expect(cards[0]?.textContent).toContain('文件已应用')
  expect(cards[0]?.textContent).toContain('运行版本已加载')
  expect(cards[1]?.textContent).toContain('需要重新启动')
  expect(cards[2]?.textContent).toContain('加载失败')
  expect(cards[2]?.textContent).not.toContain('运行版本已加载')
  expect(cards[2]?.querySelector('[role="alert"]')?.textContent).toBe('启动检查未通过')
  expect(cards[3]?.textContent).toContain('文件已回退')
  expect(cards[4]?.textContent).toContain('尚无加载回执')
  expect(cards[4]?.textContent).not.toContain('运行版本已加载')
  expect(view.node.querySelector('[role="tabpanel"]')?.textContent).not.toContain('pending')
})

it('活动解释缘由和待决定事项，会话显示实际模型；标签页支持键盘', async () => {
  const state = { ...base(),
    intentions: [{ id: 'intent-1', title: '整理散落的研究资料', reason: '三个会话反复提到同一个问题', state: 'blocked', question: '是否纳入旧笔记？', sessionId: 'research' }],
    activity: [{ id: 'activity-1', at: '2026-11-15T08:00:00Z', kind: 'notice', summary: '正在核对来源', reason: '资料有相互冲突的说法', sessionId: 'research' }],
    sessions: [{ id: 'research', title: '资料核对', status: 'running', model: 'configured-model', effort: 'high', reason: '继续核对来源' }],
  }
  vi.stubGlobal('fetch', vi.fn(async () => response(state)))
  const view = await mount()
  expect(view.node.textContent).toContain('三个会话反复提到同一个问题')
  expect(view.node.textContent).toContain('等待你的决定')
  expect(view.node.textContent).toContain('是否纳入旧笔记？')
  expect(view.node.textContent).toContain('资料有相互冲突的说法')
  await view.click('进入相关会话')
  expect(view.open).toHaveBeenCalledWith('research')
  await act(async () => { view.tab('活动').focus(); view.tab('活动').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
  expect(view.tab('会话').getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(view.tab('会话'))
  expect(view.node.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(view.tab('会话').id)
  expect(view.node.textContent).toContain('configured-model')
  expect(view.node.textContent).toContain('high')
  await view.click('打开会话')
  expect(view.open).toHaveBeenLastCalledWith('research')
  await act(async () => { view.tab('会话').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
  expect(view.tab('自身改动').getAttribute('aria-selected')).toBe('true')
})

it('自主记忆保留来源和限度，待接纳记忆只在本人操作后确认；内容以文本呈现', async () => {
  const memory = { id: 'memory-1', kind: 'practice', statement: '<script>不会作为代码执行</script>', ticketId: '', state: 'active',
    limits: '还没有跨项目验证', provenance: { reason: '本次测试支持这一方法', reference: 'test-run', sessionId: 'source-session' } }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/memory')) {
      expect(JSON.parse(String(init?.body))).toEqual({ id: 'memory-1', action: 'accept' })
      memory.state = 'accepted'
    }
    return response({ ...base(), memories: [memory] })
  }))
  const view = await mount()
  await act(async () => { view.tab('记忆').click() })
  expect(view.node.textContent).toContain('自主保留'); expect(view.node.querySelector('script')).toBeNull()
  expect(view.node.textContent).toContain('本次测试支持这一方法'); expect(view.node.textContent).toContain('还没有跨项目验证')
  await view.click('接纳')
  expect(view.node.textContent).toContain('本人已确认')
  await view.click('查看来源会话')
  expect(view.open).toHaveBeenCalledWith('source-session')
})

it('读取失败可重试，不会一直假装正在加载；恢复后进入已知主会话', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('离线')).mockResolvedValue(response(base()))
  vi.stubGlobal('fetch', fetcher)
  const view = await mount()
  expect(view.node.querySelector('[role="alert"]')?.textContent).toContain('离线')
  expect(view.node.textContent).not.toContain('正在读取精神的状态与记录')
  await view.click('重试')
  expect(view.node.querySelector('[role="alert"]')).toBeNull()
  expect(view.node.textContent).toContain('目前没有记录中的主动意图')
  await view.click('与精神对话')
  expect(view.open).toHaveBeenCalledWith('owner-session')
})

it('拒绝不完整的状态响应，也不把未同步权限当成已授权', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ mainId: 'main', tasks: null }))
    .mockResolvedValue(response({ ...base(), permissions: undefined, autonomy: undefined }))
  vi.stubGlobal('fetch', fetcher)
  const view = await mount()
  expect(view.node.querySelector('[role="alert"]')?.textContent).toContain('面板状态不完整')
  await view.click('重试')
  expect(view.node.textContent).toContain('当前权限尚未同步')
  expect(view.node.querySelector('fieldset')?.disabled).toBe(true)
  expect(view.button('停止所有活动').disabled).toBe(true)
})

it('操作后迟到的旧轮询结果不会覆盖刚确认的权限状态', async () => {
  vi.useFakeTimers()
  const state = base(), stale = deferred<ReturnType<typeof response>>()
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/permissions')) { state.permissions.mode = 'full'; return response({ ok: true }) }
    reads++
    if (reads === 2) return stale.promise
    return response(state)
  }))
  const view = await mount()
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  await act(async () => { view.node.querySelector<HTMLInputElement>('input[value="full"]')!.click() })
  await view.click('应用权限')
  expect(view.node.querySelector('.spirit-permission-status')?.textContent).toBe('完全访问 · 已生效')
  await act(async () => { stale.resolve(response(base())); await stale.promise })
  expect(view.node.querySelector('.spirit-permission-status')?.textContent).toBe('完全访问 · 已生效')
})

it('事情保留原有经验历史并能停止具体任务，没有预定阶段界面', async () => {
  const task = { id: 'task-1', title: '核对资料', sessionId: 'worker-session', mandate: { scope: '核对两份资料的出处' },
    assignments: [{ state: 'running', report: { state: 'progress', summary: '已经核对一份' } }],
    experience: { round: 1, source: { kind: 'self', reason: '两份引用不一致' },
      frames: [{ number: 1, at: '2026-11-15T08:00:00Z', object: '曾认为两份材料相同', claims: [], criteria: [], limits: '当时未看原件' }],
      evidence: [{ id: 'e1', reference: '原件记录', content: '原件内容', at: '2026-11-15T08:00:00Z' }], examinations: [], reflections: [], results: [] } }
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/stop')) expect(JSON.parse(String(init?.body))).toEqual({ id: 'task-1' })
    return response({ ...base(), tasks: [task] })
  })
  vi.stubGlobal('fetch', fetcher)
  const view = await mount()
  await act(async () => { view.tab('事情').click() })
  expect(view.node.textContent).toContain('精神主动发起')
  expect(view.node.textContent).toContain('两份引用不一致')
  const history = view.node.querySelector<HTMLDetailsElement>('.spirit-history')!
  expect(history.open).toBe(false)
  await act(async () => { history.querySelector('summary')!.click() })
  expect(history.open).toBe(true)
  expect(history.textContent).toContain('曾认为两份材料相同')
  expect(view.node.textContent).not.toContain('个理解形态')
  await view.click('停止这件事')
  expect(fetcher.mock.calls.some(call => call[0].endsWith('/stop'))).toBe(true)
})
