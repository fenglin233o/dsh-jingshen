import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ModelCatalog, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { NativeInteractions } from './native-interactions.tsx'
import { SpiritWindow, spiritRequest } from './spirit-ui.tsx'
import type { PersonalService } from './service.ts'
import type { Experience, Memory } from './experience.ts'
import type { ActivationReceipt, ActivationStatus } from './activation.ts'
import css from './style.css?raw'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  // This rc.5 Chat slot is present in the official Web bundle. Keeping the
  // small public contract local avoids making Chat a runtime dependency.
  interface SlotMap {
    'conversation.chat.assistant-actions': { kind: 'list'; scope: 'session'; owner: { messageId: MessageId } }
  }
}

type PermissionMode = 'full' | 'ask'
type ControlAction = 'pause' | 'resume' | 'stop' | 'recover'
type SessionView = { id: string; title: string; status?: string; model?: string; effort?: string; reason?: string }
type IntentionView = { id: string; title: string; reason: string; state: string; sessionId?: string; question?: string }
type ActivityView = { id: string; at: string; kind: string; summary: string; reason?: string; sessionId?: string }
type ChangeView = { id: string; at: string; summary: string; reason?: string; status?: string; sessionId?: string;
  activation?: { target: string; required: 'plugin-reload' | 'host-restart'; status: 'pending' }[] }
type ReceiptView = Pick<ActivationReceipt, 'id' | 'changeId' | 'status' | 'requestedAt' | 'updatedAt' | 'loadedAt' | 'error' | 'runtime'>
type Snapshot = ReturnType<PersonalService['snapshot']>
type State = Pick<Snapshot, 'tasks' | 'memories' | 'health' | 'busy'> & {
  mainId: string
  permissions?: { mode: PermissionMode; status: 'applied' | 'pending' | 'error'; detail?: string; scope?: string; nativePreset?: string; revision?: number }
  autonomy?: { state: 'running' | 'paused' | 'stopped'; reason?: string; recoverable?: boolean }
  sessions?: SessionView[]
  intentions?: IntentionView[]
  activity?: ActivityView[]
  changes?: ChangeView[]
  activation?: { supervisor?: unknown; receipts: ReceiptView[] }
}
type Task = State['tasks'][number]
type Tab = 'activity' | 'sessions' | 'tasks' | 'memory' | 'changes'
const tabs: { id: Tab; label: string }[] = [
  { id: 'activity', label: '活动' }, { id: 'sessions', label: '会话' }, { id: 'tasks', label: '事情' },
  { id: 'memory', label: '记忆' }, { id: 'changes', label: '自身改动' },
]
const labels: Record<string, string> = {
  progress: '进行中', waiting: '等待继续', ready: '已交付', blocked: '等待决定', failed: '受阻',
  dropped: '已结束', stopped: '已停止', completed: '已完成', pending: '等待执行', running: '进行中', ended: '已结束',
  idle: '空闲', busy: '运行中', paused: '已暂停', proposed: '待考虑', active: '推进中', dismissed: '已搁置',
  accepted: '已采纳', rejected: '未采纳', planned: '已计划', applied: '已应用', verified: '已验证',
  rolled_back: '已回退', interrupted: '曾中断', recovered: '已恢复', error: '发生错误',
  stored: '已保存', awaiting_decision: '等待判断', retry: '等待重试',
}
const changeStates: Record<string, string> = {
  candidate: '候选改动', 'checkpoint-failed': '备份失败', verifying: '正在验证', verified: '验证通过',
  'verification-failed': '验证未通过', applying: '正在应用文件', 'apply-failed': '文件应用失败', applied: '文件已应用',
  'rolling-back': '正在回退文件', 'rollback-conflict': '回退遇到冲突', 'rollback-failed': '文件回退失败', 'rolled-back': '文件已回退',
}
const activationStates: Record<ActivationStatus, string> = {
  requested: '等待加载', 'restart-required': '需要重新启动', restarting: '正在重启', booting: '正在启动',
  'runtime-loaded': '运行版本已加载', failed: '加载失败', cancelled: '已取消加载',
}
const memoryStates: Record<string, string> = { proposed: '待接纳', active: '自主保留', accepted: '本人已确认', rejected: '未接纳', superseded: '已修订', forgotten: '已遗忘' }
const memoryKinds: Record<string, string> = { preference: '偏好', fact: '事实', practice: '方法' }
const permissionLabels: Record<PermissionMode, string> = { full: '完全访问', ask: '敏感操作询问' }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function dateLabel(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value || '时间未记录'
}
function SessionArrow() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" focusable="false">
    <path d="M4 12 12 4M4 4h8v8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

async function request<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timeout = setTimeout(abort, 20_000)
  try {
    const response = await fetch(`/personal-spirit/api/${path}`, {
      method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal: controller.signal,
      headers: { 'x-personal-spirit': '1', ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    })
    let result: unknown
    try { result = await response.json() } catch { throw new Error(response.ok ? '服务返回了无法读取的数据，请重试。' : `请求失败（HTTP ${response.status}），请重试。`) }
    if (!response.ok) throw new Error(isRecord(result) && typeof result.error === 'string' ? result.error : `请求失败（HTTP ${response.status}）`)
    return result as T
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('请求超时，当前状态尚未确认。请刷新后查看。')
    throw error
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}

/** Refuse an incompatible response instead of rendering a blank panel or claiming a permission mode. */
function readState(value: unknown): State {
  if (!isRecord(value) || typeof value.mainId !== 'string' || !value.mainId || !Array.isArray(value.tasks)
    || !Array.isArray(value.memories) || !isRecord(value.health) || typeof value.busy !== 'number') {
    throw new Error('面板状态不完整，请刷新或检查精神服务。')
  }
  if (value.tasks.some(item => !isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string'
    || typeof item.sessionId !== 'string' || !Array.isArray(item.assignments))
    || value.memories.some(item => !isRecord(item) || typeof item.id !== 'string' || typeof item.statement !== 'string' || typeof item.state !== 'string')) {
    throw new Error('记录格式无法读取，请检查精神服务。')
  }
  if (value.permissions !== undefined && (!isRecord(value.permissions) || !['full', 'ask'].includes(String(value.permissions.mode))
    || !['applied', 'pending', 'error'].includes(String(value.permissions.status)))) throw new Error('权限状态无法读取，尚未确认当前权限。')
  if (value.autonomy !== undefined && (!isRecord(value.autonomy) || !['running', 'paused', 'stopped'].includes(String(value.autonomy.state)))) {
    throw new Error('运行状态无法读取，请刷新后查看。')
  }
  for (const key of ['sessions', 'intentions', 'activity', 'changes']) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(item => !isRecord(item) || typeof item.id !== 'string'))) {
      throw new Error('活动记录无法读取，请刷新后查看。')
    }
  }
  if (value.activation !== undefined && (!isRecord(value.activation) || !Array.isArray(value.activation.receipts)
    || value.activation.receipts.some(item => !isRecord(item) || typeof item.id !== 'string' || typeof item.changeId !== 'string'
      || typeof item.requestedAt !== 'string' || typeof item.updatedAt !== 'string' || typeof item.status !== 'string'
      || !Object.hasOwn(activationStates, item.status)))) throw new Error('运行加载回执无法读取，请刷新后查看。')
  return value as State
}

function Activation({ change, receipts }: { change: ChangeView; receipts?: ReceiptView[] }) {
  const receipt = receipts?.filter(item => item.changeId === change.id).reduce<ReceiptView | undefined>((latest, item) =>
    !latest || item.requestedAt >= latest.requestedAt ? item : latest, undefined)
  if (!receipt && !change.activation?.length) return null
  return <div className="spirit-activation">
    <p><strong>最近加载回执</strong> · {receipt ? activationStates[receipt.status] : '尚无加载回执'}</p>
    {receipt ? <>
      {receipt.error && <p className="spirit-prose" role={receipt.status === 'failed' ? 'alert' : undefined}>{receipt.error}</p>}
      {receipt.runtime?.version && <p className="spirit-muted">加载版本：{receipt.runtime.version}</p>}
      <small>回执更新：<time dateTime={receipt.updatedAt}>{dateLabel(receipt.updatedAt)}</time></small>
    </> : <p className="spirit-muted">{change.activation?.some(item => item.required === 'host-restart')
      ? '改动应用后还需请求重启宿主，加载结果将记录在这里。'
      : '改动应用后还需请求加载插件，加载结果将记录在这里。'}</p>}
  </div>
}

function History({ experience }: { experience?: Experience }) {
  if (!experience) return null
  return <details className="spirit-history"><summary>历史经验记录</summary>
    <p className="spirit-muted">保留当时的材料、判断和修改原因，便于回看。</p>
    {!experience.frames.length && !experience.evidence.length && !experience.reflections?.length && !experience.results?.length && <p className="spirit-muted">尚无历史经验记录。</p>}
    {experience.reflections?.map(item => <details key={item.id}><summary>{dateLabel(item.at)} · 留下的认识</summary>
      <p className="spirit-prose">{item.new}</p>{item.previous && <p className="spirit-prose">此前的理解：{item.previous}</p>}
      {item.reason && <p className="spirit-prose">调整原因：{item.reason}</p>}{item.check && <p className="spirit-prose">检验情况：{item.check}</p>}
      {item.limits && <p className="spirit-muted spirit-prose">尚有限制：{item.limits}</p>}
    </details>)}
    {experience.results?.map((result, index) => <details key={`${result.at}:${index}`}><summary>{dateLabel(result.at)} · 当时的成果</summary>
      <p className="spirit-prose">{result.text}</p>{result.check && <p className="spirit-prose">检验情况：{result.check}</p>}
      {result.limits && <p className="spirit-muted spirit-prose">尚有限制：{result.limits}</p>}
    </details>)}
    {experience.frames.map(frame => <details key={frame.number}><summary>{dateLabel(frame.at)} · 当时的判断</summary>
      <p className="spirit-prose">{frame.object}</p>
      <ul>{frame.claims.map(claim => <li key={claim.id}>{claim.statement}</li>)}</ul>
      {frame.limits && <p className="spirit-muted">尚有限制：{frame.limits}</p>}
      {frame.transition && <p className="spirit-prose">调整原因：{frame.transition.reason}</p>}
      {!!frame.criteria.length && <><h4>当时的检验依据</h4><ul>{frame.criteria.map(item => <li key={item.id}>{item.text}</li>)}</ul></>}
      {experience.examinations.filter(exam => exam.frame === frame.number).map(exam => <div className="spirit-history-check" key={exam.id}>
        {exam.checks.map(check => <p key={check.criterionId}>{check.outcome === 'met' ? '符合' : check.outcome === 'unmet' ? '不符合' : '尚不清楚'} · {frame.criteria.find(item => item.id === check.criterionId)?.text}：{check.reason}</p>)}
        {[...exam.contradictions, ...exam.criterionContradictions].map((item, index) => <p key={index}>发现的问题：{item.reason}</p>)}
      </div>)}
    </details>)}
    {!!experience.evidence.length && <><h4>留下的材料</h4>{experience.evidence.map(item => <details key={item.id}>
      <summary>{item.reference}</summary><p className="spirit-prose">{item.content}</p><small>{dateLabel(item.at)}</small>
    </details>)}</>}
  </details>
}

export function Panel({ openSession, embedded = false }: { openSession: (id: string) => Promise<unknown>; embedded?: boolean }) {
  const [state, setState] = useState<State>(), [readError, setReadError] = useState(''), [actionError, setActionError] = useState('')
  const [selected, setSelected] = useState<string>(), [tab, setTab] = useState<Tab>('activity')
  const [pending, setPending] = useState<string>(), [reloading, setReloading] = useState(false), [notice, setNotice] = useState('')
  const [permissionDraft, setPermissionDraft] = useState<PermissionMode>(), [updatedAt, setUpdatedAt] = useState<string>()
  const live = useRef(false), sequence = useRef(0), acting = useRef(false), fetching = useRef(false), life = useRef<AbortController>()
  const panelId = useId()
  const refresh = useCallback(async () => {
    const id = ++sequence.current
    fetching.current = true
    try {
      const next = readState(await request<unknown>('state', undefined, life.current?.signal))
      if (live.current && id === sequence.current) { setState(next); setReadError(''); setUpdatedAt(new Date().toISOString()) }
      return next
    } catch (error) {
      if (live.current && id === sequence.current) setReadError(message(error))
      throw error
    } finally { if (id === sequence.current) fetching.current = false }
  }, [])
  useEffect(() => {
    live.current = true; life.current = new AbortController()
    void refresh().catch(() => {})
    const timer = setInterval(() => { if (!acting.current && !fetching.current) void refresh().catch(() => {}) }, 5000)
    return () => { live.current = false; sequence.current++; life.current?.abort(); clearInterval(timer) }
  }, [refresh])
  const retry = async () => {
    if (reloading) return
    setReloading(true)
    try { await refresh() } catch { /* Keep the read error visible until a successful refresh. */ }
    finally { if (live.current) setReloading(false) }
  }
  const act = async (key: string, action: () => Promise<unknown>, success = '', reload = true) => {
    if (acting.current) return false
    acting.current = true; sequence.current++; fetching.current = false
    setPending(key); setActionError(''); setNotice('')
    let submitted = false
    try {
      await action(); submitted = true
      if (!live.current) return false
      if (reload) await refresh()
      if (live.current) setNotice(success)
      return true
    } catch (error) {
      // A failed response can arrive after a partial server-side change. Read back, never retry the mutation automatically.
      if (reload && !submitted && live.current) { try { await refresh() } catch { /* The last confirmed snapshot is marked stale. */ } }
      if (live.current) setActionError(`${submitted && reload ? '操作已提交，最新状态尚未确认：' : ''}${message(error)}`)
      return false
    } finally { acting.current = false; if (live.current) setPending(undefined) }
  }
  const open = (id: string) => act(`session:${id}`, () => openSession(id), '', false)
  const control = (action: ControlAction) => act(`control:${action}`, () => request('control', { action }, life.current?.signal), action === 'recover' ? '已请求重试未决思考。' : '运行状态已同步。')
  const decide = (memory: Memory, action: 'accept' | 'reject' | 'forget') => act(`memory:${memory.id}`, () => request('memory', { id: memory.id, action }, life.current?.signal), '记忆已更新。')
  const exportData = () => act('export', async () => {
    const value = await request<unknown>('export', undefined, life.current?.signal)
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = '精神记录.json'
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, '已准备记录文件。', false)
  const changeTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex(item => item.id === tab)
    const indices: Record<string, number> = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }
    const next = indices[event.key]
    if (next === undefined) return
    event.preventDefault(); setTab(tabs[next]!.id)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  const task = state?.tasks.find(item => item.id === selected) ?? state?.tasks[0]
  const taskStatus = (item: Task) => item.ended?.outcome ?? item.assignments.at(-1)?.report?.state ?? item.assignments.at(-1)?.state ?? 'pending'
  const permission = state?.permissions, chosenPermission = permissionDraft ?? permission?.mode
  const permissionChanged = !!permission && chosenPermission !== permission.mode
  const busy = !!pending
  const healthErrors = Object.entries(state?.health ?? {}).filter(([, value]) => value?.state === 'error')
  const decisions = state?.intentions?.filter(item => item.question) ?? []
  const shownSessions = embedded ? state?.sessions?.filter(item => item.id !== state.mainId) : state?.sessions
  const count: Partial<Record<Tab, number>> = state ? { sessions: shownSessions?.length, tasks: state.tasks.length,
    memory: state.memories.filter(item => ['accepted', 'active'].includes(item.state)).length, changes: state.changes?.length } : {}

  return <div className="spirit"><style>{css}</style><div className="spirit-content">
    <header className="spirit-header">{!embedded && <div><h1>精神</h1><p className="spirit-muted">会话、正在做的事，以及留下的经验。</p></div>}
      <div className="spirit-actions"><button disabled={!state || busy} onClick={() => void exportData()}>导出记录</button>
        {!embedded && <button className="spirit-primary" disabled={!state || busy} onClick={() => state && void open(state.mainId)}>与精神对话 <SessionArrow /></button>}</div>
    </header>
    {readError && <div role="alert" className="spirit-error"><div><strong>{state ? '最新状态读取失败' : '暂时无法读取精神'}</strong><p>{readError}</p>
      {state && <p>下方保留上次读取的记录，运行和权限状态可能已变化。</p>}</div><button disabled={reloading || busy} onClick={() => void retry()}>{reloading ? '正在重试…' : '重试'}</button></div>}
    {actionError && <div role="alert" className="spirit-error"><p>{actionError}</p><button onClick={() => setActionError('')}>关闭提示</button></div>}
    <div className="spirit-live" role="status" aria-live="polite">{pending ? '正在处理…' : notice}</div>
    {!state ? !readError && <div className="spirit-empty" role="status">正在读取精神的状态与记录…</div> : <>
      <div className="spirit-overview">
        <section className="spirit-card spirit-runtime" aria-labelledby={`${panelId}-runtime`}>
          <h2 id={`${panelId}-runtime`}>运行状态</h2>
          <p className="spirit-runtime-title"><span className="spirit-dot" data-state={state.autonomy?.state ?? 'unknown'} aria-hidden="true" />
            {state.autonomy ? ({ running: state.busy ? '正在推进' : '已就绪', paused: '已暂停', stopped: '已停止' }[state.autonomy.state]) : '尚未同步运行状态'}</p>
          {state.autonomy?.reason && <p className="spirit-prose">{state.autonomy.reason}</p>}
          <p className="spirit-muted">{state.busy ? `${state.busy} 个执行会话正在运行。` : '当前没有运行中的执行会话。'}</p>
          {!!decisions.length && <p className="spirit-attention-text">有 {decisions.length} 项主动意图等待你的回应。</p>}
          <div className="spirit-actions">
            {state.autonomy?.state === 'running' ? <button disabled={busy} onClick={() => void control('pause')}>暂停活动</button>
              : state.autonomy && <button disabled={busy} onClick={() => void control('resume')}>恢复活动</button>}
            <button className="spirit-danger" disabled={busy || !state.autonomy || state.autonomy.state === 'stopped'} onClick={() => void control('stop')}>停止所有活动</button>
          </div>
          {state.autonomy?.recoverable && <div className="spirit-recovery"><p>有尚未形成判断或需要重试的思考机会。重试会重新提交这些机会，让精神继续判断。</p>
            {state.autonomy.state !== 'running' && <p className="spirit-muted">先恢复活动，再重试未决思考。</p>}
            {permission?.status !== 'applied' && <p className="spirit-muted">权限生效后可以重试。</p>}
            <div className="spirit-actions"><button onClick={() => setTab('activity')}>查看活动</button><button disabled={busy || state.autonomy.state !== 'running' || permission?.status !== 'applied'} onClick={() => void control('recover')}>重试未决思考</button></div></div>}
        </section>
        <section className="spirit-card spirit-permissions" aria-labelledby={`${panelId}-permission`}>
          <h2 id={`${panelId}-permission`}>访问权限</h2>
          <p className="spirit-permission-status" role={permission?.status === 'error' ? 'alert' : undefined}>
            {permission ? `${permissionLabels[permission.mode]} · ${{ applied: '已生效', pending: '正在应用', error: '应用未完成' }[permission.status]}` : '当前权限尚未同步'}
          </p>
          <form onSubmit={event => { event.preventDefault(); if (!chosenPermission || !permission || busy) return
            void act('permissions', () => request('permissions', { mode: chosenPermission }, life.current?.signal), '权限状态已同步。').then(ok => { if (ok && live.current) setPermissionDraft(undefined) }) }}>
            <fieldset disabled={!permission || busy}><legend className="spirit-sr-only">选择精神的访问权限</legend>
              <label className="spirit-permission-option"><input type="radio" name={`${panelId}-mode`} value="ask" checked={chosenPermission === 'ask'} onChange={() => setPermissionDraft('ask')} />
                <span><strong>敏感操作询问</strong><small>敏感操作由 Harness 请求确认。</small></span></label>
              <label className="spirit-permission-option"><input type="radio" name={`${panelId}-mode`} value="full" checked={chosenPermission === 'full'} onChange={() => setPermissionDraft('full')} />
                <span><strong>完全访问</strong><small>在管理的会话中直接使用宿主提供的工具。</small></span></label>
            </fieldset>
            <p className="spirit-muted spirit-scope">{permission?.scope || '作用于精神管理的 Harness 会话；可用能力仍由宿主和系统决定。'}</p>
            {permission?.detail && <p className="spirit-prose spirit-muted">{permission.detail}</p>}
            <div className="spirit-actions"><button type="submit" disabled={busy || !permission || permission.status === 'pending' || !permissionChanged && permission.status === 'applied'}>{pending === 'permissions' ? '正在应用…' : '应用权限'}</button>
              {permissionChanged && <small>尚未应用所选权限</small>}</div>
          </form>
        </section>
      </div>
      {!!healthErrors.length && <div role="alert" className="spirit-error"><div><strong>有运行问题需要查看</strong>{healthErrors.map(([name, value]) => <p key={name}>{name}：{value.detail}</p>)}</div></div>}
      <div className="spirit-tabs" role="tablist" aria-label="精神记录" onKeyDown={changeTab}>
        {tabs.map(item => <button key={item.id} role="tab" id={`${panelId}-tab-${item.id}`} aria-controls={`${panelId}-panel-${item.id}`}
          aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>{item.label}{count[item.id] !== undefined && <span>{count[item.id]}</span>}</button>)}
      </div>
      <div className="spirit-tabpanel" role="tabpanel" id={`${panelId}-panel-${tab}`} aria-labelledby={`${panelId}-tab-${tab}`} tabIndex={0}>
        {tab === 'activity' && <>
          <section className="spirit-section"><h2>主动意图</h2><p className="spirit-muted">查看精神想推进什么、为什么，以及哪些事正在等你决定。</p>
            {!state.intentions?.length && <p className="spirit-empty-inline">{state.intentions ? '目前没有记录中的主动意图。' : '主动意图尚未同步。'}</p>}
            {state.intentions?.map(item => <article className="spirit-record" key={item.id}><div className="spirit-record-heading"><h3>{item.title}</h3><span className="spirit-tag">{labels[item.state] ?? item.state}</span></div>
              <p className="spirit-prose">{item.reason || '尚未记录行动理由。'}</p>{item.question && <div className="spirit-attention"><strong>等待你的决定</strong><p className="spirit-prose">{item.question}</p></div>}
              {(item.sessionId || item.question) && <button disabled={busy} onClick={() => void open(item.sessionId ?? state.mainId)}>进入相关会话 <SessionArrow /></button>}
            </article>)}
          </section>
          <section className="spirit-section"><h2>最近活动</h2>
            {!state.activity?.length && <p className="spirit-empty-inline">{state.activity ? '尚无活动记录。可以从与精神对话开始。' : '活动记录尚未同步。'}</p>}
            <ol className="spirit-timeline">{state.activity?.map(item => <li key={item.id}><p className="spirit-prose">{item.summary}</p>
              {item.reason && <p className="spirit-muted spirit-prose">缘由：{item.reason}</p>}<div className="spirit-record-meta"><time dateTime={item.at}>{dateLabel(item.at)}</time>
                {item.sessionId && <button className="spirit-link" disabled={busy} onClick={() => void open(item.sessionId!)}>查看会话</button>}</div></li>)}</ol>
          </section>
        </>}
        {tab === 'sessions' && <section className="spirit-section"><h2>会话</h2><p className="spirit-muted">其他会话可从记录中的来源打开，主会话的待确认请求在通讯窗处理。</p>
          {!shownSessions?.length && <div className="spirit-empty-inline">{shownSessions ? '当前没有已登记的会话。' : '会话列表尚未同步。'}</div>}
          <div className="spirit-session-list">{shownSessions?.map(item => <article className="spirit-record" key={item.id}><div className="spirit-record-heading"><h3>{item.title || '未命名会话'}</h3>
            {item.status && <span className="spirit-tag">{labels[item.status] ?? item.status}</span>}</div>{item.reason && <p className="spirit-prose">{item.reason}</p>}
            <dl className="spirit-meta"><dt>模型</dt><dd>{item.model || '尚未选定'}</dd>{item.effort && <><dt>推理强度</dt><dd>{item.effort}</dd></>}</dl>
            <button disabled={busy} onClick={() => void open(item.id)}>打开会话 <SessionArrow /></button></article>)}</div>
        </section>}
        {tab === 'tasks' && (!task ? <div className="spirit-empty"><h2>还没有记录中的事情</h2><p>与精神对话后，持续推进的事情会在这里留下进展和相关会话。</p></div>
          : <div className="spirit-columns"><aside aria-label="事情列表">{state.tasks.map(item => <button key={item.id} aria-pressed={task.id === item.id} onClick={() => setSelected(item.id)}>
            <strong>{item.title}</strong><small>{labels[taskStatus(item)] ?? taskStatus(item)}</small></button>)}</aside>
            <div className="spirit-task"><div className="spirit-record-heading"><div><span className="spirit-tag">{labels[taskStatus(task)] ?? taskStatus(task)}</span><h2>{task.title}</h2></div>
              <div className="spirit-actions"><button disabled={busy} onClick={() => void open(task.sessionId)}>查看执行会话 <SessionArrow /></button>
                {!task.ended && <button disabled={busy} className="spirit-danger" onClick={() => void act(`stop:${task.id}`, () => request('stop', { id: task.id }, life.current?.signal), '这件事的状态已同步。')}>停止这件事</button>}</div></div>
              {task.attention && <section className="spirit-attention"><h3>等待你的决定</h3><p className="spirit-prose">{task.attention.question}</p><button disabled={busy} onClick={() => void open(state.mainId)}>回到对话</button></section>}
              {task.assignments.at(-1)?.report && <section className="spirit-section"><h3>最近进展</h3><p className="spirit-prose">{task.assignments.at(-1)!.report!.summary}</p></section>}
              <section className="spirit-section"><h3>这件事的来由</h3>
                {task.experience?.source && <p className="spirit-muted">{task.experience.source.kind === 'self' ? '精神主动发起' : '来自本人请求'}</p>}
                <p className="spirit-prose">{task.mandate?.scope || '尚未记录。'}</p>
                {task.experience?.source?.kind === 'self' && <p className="spirit-prose">发起原因：{task.experience.source.reason}</p>}
              </section>
              {task.experience?.result && <section className="spirit-section"><h3>留下的成果</h3><p className="spirit-prose">{task.experience.result.text}</p>{task.experience.result.limits && <p className="spirit-muted spirit-prose">尚有限制：{task.experience.result.limits}</p>}</section>}
              <History experience={task.experience} />
            </div></div>)}
        {tab === 'memory' && <section className="spirit-section"><h2>留下的记忆</h2><p className="spirit-muted">保留的记忆会参与后续会话，并可随经验修订。遗忘会清空这条记忆的内容与来源引用，不再作为长期记忆提供；原会话与事情记录保留。</p>
          {!state.memories.length && <div className="spirit-empty-inline">目前没有长期记忆。</div>}
          {state.memories.map(memory => <article className="spirit-record" key={memory.id}><div className="spirit-record-meta"><span>{memoryStates[memory.state] ?? memory.state}</span><span>{memoryKinds[memory.kind] ?? memory.kind}</span></div>
            <p className="spirit-memory-text spirit-prose">{memory.statement}</p>
            {memory.provenance?.reason && <p className="spirit-muted spirit-prose">保留原因：{memory.provenance.reason}</p>}
            {memory.limits && <p className="spirit-muted spirit-prose">适用限度：{memory.limits}</p>}
            {memory.provenance?.reference && <p className="spirit-muted spirit-prose">来源记录：{memory.provenance.reference}</p>}
            <div className="spirit-actions">
              {memory.ticketId && state.tasks.some(item => item.id === memory.ticketId) && <button onClick={() => { setSelected(memory.ticketId); setTab('tasks') }}>查看来源</button>}
              {memory.provenance?.sessionId && <button disabled={busy} onClick={() => void open(memory.provenance.sessionId!)}>查看来源会话</button>}
              {['proposed', 'active'].includes(memory.state) && <><button disabled={busy} onClick={() => void decide(memory, 'reject')}>不接纳</button><button disabled={busy} onClick={() => void decide(memory, 'accept')}>接纳</button></>}
              <button disabled={busy} onClick={() => void decide(memory, 'forget')}>遗忘此条</button></div></article>)}
        </section>}
        {tab === 'changes' && <section className="spirit-section"><h2>自身改动</h2><p className="spirit-muted">查看对自身或宿主所作改动的理由、结果与相关会话。</p>
          {!state.changes?.length && <div className="spirit-empty-inline">{state.changes ? '尚无自身改动记录。' : '自身改动记录尚未同步。'}</div>}
          {state.changes?.map(item => <article className="spirit-record" key={item.id}><div className="spirit-record-heading"><h3>{item.summary}</h3>{item.status && <span className="spirit-tag">{changeStates[item.status] ?? labels[item.status] ?? item.status}</span>}</div>
            {item.reason && <p className="spirit-prose">改动原因：{item.reason}</p>}<Activation change={item} receipts={state.activation?.receipts} />
            <div className="spirit-record-meta"><time dateTime={item.at}>{dateLabel(item.at)}</time>
              {item.sessionId && <button className="spirit-link" disabled={busy} onClick={() => void open(item.sessionId!)}>查看相关会话</button>}</div></article>)}
        </section>}
      </div>
      <footer className="spirit-footer"><small>{updatedAt ? `最近读取：${dateLabel(updatedAt)}` : ''}</small><button disabled={reloading || busy} onClick={() => void retry()}>{reloading ? '正在刷新…' : '刷新状态'}</button></footer>
    </>}
  </div></div>
}

type ClientContext = Context & { sessions: ISessions }
function modelCatalog(ctx: ClientContext): Promise<RemoteResult<ModelCatalog>> {
  // The official Web profile supplies this composition-dependent namespace.
  return (ctx.remote as unknown as { session: { modelCatalog(): Promise<RemoteResult<ModelCatalog>> } }).session.modelCatalog()
}

const modelKey = (provider: string, model: string) => JSON.stringify([provider, model])
function SpiritModels({ ctx }: { ctx: ClientContext }) {
  const [catalog, setCatalog] = useState<ModelCatalog>()
  const [current, setCurrent] = useState<ModelSelection>()
  const [draft, setDraft] = useState<ModelSelection>()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)
  const selection = draft ?? current ?? catalog?.default
  const option = catalog?.groups.find(group => group.id === selection?.provider)?.models.find(model => model.id === selection?.model)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    void Promise.all([
      Promise.resolve().then(() => modelCatalog(ctx)),
      spiritRequest<{ selected: ModelSelection | null }>('model', undefined, controller.signal),
    ]).then(([catalogResult, selectionResult]) => {
      if (controller.signal.aborted) return
      if (!catalogResult.ok) throw new Error(catalogResult.error.message)
      setCatalog(catalogResult.value)
      setCurrent(selectionResult.selected ?? undefined)
    }).catch(reason => { if (!controller.signal.aborted) setError(message(reason)) })
    return () => controller.abort()
  }, [ctx, reload])
  const apply = async () => {
    if (!draft || saving) return
    setSaving(true); setSaved(''); setError('')
    try {
      const result = await spiritRequest<{ selected: ModelSelection }>('model', draft)
      if (!result.selected) throw new Error('宿主尚未确认模型选择。')
      setCurrent(result.selected)
      setDraft(undefined)
      setSaved('已更新主会话模型。')
    } catch (reason) { setError(message(reason)) }
    finally { setSaving(false) }
  }
  return <form className="jingshen-model-form" onSubmit={event => { event.preventDefault(); void apply() }}>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">{saved}</p>}
    {!catalog ? <>
      {!error && <p role="status">正在读取 Harness 的模型目录…</p>}
      {error && <button type="button" onClick={() => setReload(value => value + 1)}>重新读取模型</button>}
    </> : catalog.groups.length === 0 ? <>
      <p>当前没有可用模型。请先在 Harness 的模型或账户设置中配置。</p>
      <button type="button" onClick={() => setReload(value => value + 1)}>重新读取模型</button>
    </> : <>
      <label>模型
        <select aria-label="模型" value={selection ? modelKey(selection.provider, selection.model) : ''} disabled={saving}
          onChange={event => {
            const [provider, model] = JSON.parse(event.target.value) as [string, string]
            setDraft({ provider, model }); setSaved('')
          }}>
          {selection && !option && <option value={modelKey(selection.provider, selection.model)} disabled>{selection.model}（当前不可用）</option>}
          {catalog.groups.map(group => <optgroup key={group.id} label={group.name}>{group.models.map(model =>
            <option key={model.id} value={modelKey(group.id, model.id)}>{model.name}</option>)}</optgroup>)}
        </select>
      </label>
      {selection && !!option?.reasoning?.efforts.length && <label>推理等级
        <select aria-label="推理等级" value={selection.reasoningEffort ?? ''} disabled={saving}
          onChange={event => {
            setDraft({ provider: selection.provider, model: selection.model,
              ...(event.target.value ? { reasoningEffort: event.target.value } : {}) })
            setSaved('')
          }}>
          <option value="">模型默认</option>
          {option.reasoning.efforts.map(effort => <option value={effort.id} key={effort.id}>{effort.name}</option>)}
        </select>
      </label>}
      <button type="submit" disabled={saving || !draft || !option}>{saving ? '正在应用…' : '应用模型'}</button>
    </>}
  </form>
}

type MediationReceipt = { sessionId: string; messageId?: string; source: string; disposition: string }
type AssistantSourceProps = PropsRuntime<'conversation.chat.assistant-actions'> & { messageId: MessageId; sessionId?: SessionId }

function AssistantSource({ sessionId, messageId }: AssistantSourceProps) {
  const [published, setPublished] = useState<{ sessionId: SessionId; messageId: MessageId }>()
  useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    const query = new URLSearchParams({ sessionId, messageId })
    void spiritRequest<{ records: MediationReceipt[] }>(`mediation?${query}`, undefined, controller.signal).then(result => {
      if (controller.signal.aborted || !Array.isArray(result.records)) return
      if (result.records.some(row => row.sessionId === sessionId && row.messageId === messageId
        && row.source === 'spirit' && (row.disposition === 'speak' || row.disposition === 'continue'))) setPublished({ sessionId, messageId })
    }).catch(() => { /* Rows with no verified receipt keep their native presentation. */ })
    return () => controller.abort()
  }, [sessionId, messageId])
  return published?.sessionId === sessionId && published?.messageId === messageId
    ? <span className="jingshen-mediation-badge" data-message-id={messageId} title="来自这个会话中精神的实际发布">精神</span> : null
}

const privateMainPanel = 'dsh-jingshen.private-main' as MainPanelId
const privateIdentityStorage = 'dsh-jingshen.main-session'
function cachedMainId(): string | undefined {
  try { return sessionStorage.getItem(privateIdentityStorage) ?? undefined } catch { return undefined }
}

type WorkspaceRows = { items: readonly { workspaceId: string; path: string; sessionIds: readonly string[] }[] }
type SpiritOverlayProps = PropsRuntime<'shell.overlay'> & {
  ctx: ClientContext
  useWorkspaces: SnapshotSelectorHook<WorkspaceRows>
}
function SpiritOverlay({ ctx, useWorkspaces }: SpiritOverlayProps) {
  const [mainId, setMainId] = useState(cachedMainId)
  const acceptMainId = useCallback((id: string) => {
    try { sessionStorage.setItem(privateIdentityStorage, id) } catch { /* The current connection still knows its identity. */ }
    setMainId(id)
  }, [])
  const [openSignal, setOpenSignal] = useState(0)
  const workspaces: WorkspaceRows['items'] = useWorkspaces((snapshot: WorkspaceRows) => snapshot.items)
  const subscribeSessions = useCallback((listener: () => void) => ctx.sessions.list.subscribe(listener), [ctx])
  const mainPath = useCallback(() => mainId ? ctx.sessions.list.getSnapshot().byId[mainId as SessionId]?.cwd as string | undefined : undefined,
    [ctx, mainId])
  const privatePath = useSyncExternalStore(subscribeSessions, mainPath, mainPath)
  const hasUngrouped = useCallback(() => ctx.sessions.list.getSnapshot().ids.some((id: SessionId) =>
    id !== mainId && !workspaces.some(workspace => workspace.sessionIds.includes(id))), [ctx, mainId, workspaces])
  const showUngrouped = useSyncExternalStore(subscribeSessions, hasUngrouped, hasUngrouped)
  const hiddenWorkspaces = privatePath ? workspaces.filter(item =>
    item.path === privatePath && item.sessionIds.every(sessionId => sessionId === mainId)) : []

  useLayoutEffect(() => {
    if (!mainId) return
    const references = ctx.sessions.retainInfo(mainId as SessionId)
    const panels = ctx.layout.panelInfo
    let stopped = false
    let queued = false
    const reconcile = () => {
      queued = false
      if (stopped) return
      const active = panels.getSnapshot().activePanelId
      const nativeView = !!(references.getSnapshot().retainedBy as Readonly<Record<string, number | undefined>>).mainView
      if (nativeView && active === null) {
        // The private session has no native Workspace membership for default
        // startup. This covers explicit opens and the old persisted selection.
        ctx.layout.selectPanel(privateMainPanel)
        setOpenSignal(value => value + 1)
      } else if (!nativeView && active === privateMainPanel) ctx.layout.selectPanel(null)
    }
    const schedule = () => {
      if (!queued) { queued = true; queueMicrotask(reconcile) }
    }
    const disposeReferences = references.subscribe(schedule)
    const disposePanels = panels.subscribe(schedule)
    schedule()
    return () => { stopped = true; disposeReferences(); disposePanels() }
  }, [ctx, mainId])

  const openSession = async (id: string) => {
    const target = id as SessionId
    if (ctx.sessions.list.getSnapshot().phase !== 'ready' || !ctx.sessions.list.getSnapshot().byId[target]) await ctx.sessions.refresh()
    const list = ctx.sessions.list.getSnapshot()
    if (list.phase !== 'ready') throw new Error('会话列表尚未就绪，请稍后重试。')
    if (!list.byId[target]) throw new Error('未在 Harness 中找到这个会话，请刷新后重试。')
    ctx.uiWorkspace.openSession(target)
  }
  // RC.5 exports a public overlay/nav seat but no filtered Workspace-tree
  // adapter. These exact native row keys also cover search and flat rows.
  const hidden = mainId && [
    `[data-row-key="${CSS.escape(`session:${mainId}`)}"]`,
    ...(!showUngrouped ? ['[data-row-key="workspace:"]'] : []),
    ...hiddenWorkspaces.map(item => `[data-row-key="${CSS.escape(`workspace:${item.workspaceId}`)}"]`),
    `[data-phase]:has(> [data-conversation-session="${CSS.escape(mainId)}"])`,
  ].join(',')
  return <>
    {hidden && <style>{`${hidden}{display:none!important}`}</style>}
    <SpiritWindow
      renderManagement={openNative => <Panel embedded openSession={openNative} />}
      renderModels={() => <SpiritModels ctx={ctx} />}
      renderNativeInteractions={(sessionId, onPendingChange) =>
        <NativeInteractions ctx={ctx} sessionId={sessionId as SessionId} onPendingChange={onPendingChange} />}
      openSource={openSession} onMainId={acceptMainId} openSignal={openSignal} />
  </>
}

export const inject = ['slots', 'sessions', 'layout', 'uiWorkspace', 'uiSession', 'remote', 'remote.session']
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: privateMainPanel }, () => null))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-jingshen' },
    props => <SpiritOverlay {...props} ctx={ctx} />))
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'dsh-jingshen.source', order: -100,
  }, AssistantSource))
}
