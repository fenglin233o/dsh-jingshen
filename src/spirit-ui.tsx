import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react'
import { SpiritFish, fishCss, type FishActivity, type FishMood } from './fish.tsx'
import { VisionControls } from './vision-client.tsx'
import { VoiceCall, type VoiceCallState } from './voice-client.tsx'
import css from './spirit-ui.css?raw'

type ActivityKind = 'idle' | 'thinking' | 'working' | 'observing' | 'phone' | 'sleep' | 'paused' | 'stopped'
type ExpressionKind = 'smile' | 'wave' | 'thoughtful' | 'excited' | 'sad' | 'neutral'
type Presence = {
  activity: { kind: ActivityKind; sessionId?: string; label?: string; until?: string; media?: { kind: 'audio' | 'video' | 'camera' | 'image'; state: 'playing' | 'observing' } }
  expression?: { kind: ExpressionKind; until: string }
}
export type SpiritMessage = {
  cursor: number
  id: string
  author: 'owner' | 'spirit'
  text: string
  at: string
  source: { kind: 'native' | 'say'; sessionId: string; title?: string; messageId?: string }
}
type ChatPage = {
  mainId: string
  messages: SpiritMessage[]
  cursor: number
  nextBefore: number | null
  hasMore: boolean
  presence: Presence
}
type WindowMode = 'closed' | 'chat' | 'manage' | 'model'
type ChatFailure = { status?: number; message: string }
type PublicationGesture = { duration: number; mood?: FishMood }

const activityLabels: Record<ActivityKind, string> = {
  idle: '在线', thinking: '在思考', working: '工作中', observing: '在看画面', phone: '通话中', sleep: '休息中', paused: '已暂停', stopped: '已停止',
}
const expressionMoods: Partial<Record<ExpressionKind, FishMood>> = {
  smile: 'smile', wave: 'warm', thoughtful: 'curious', excited: 'surprise', sad: 'sad',
}
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' })
const timeFormatter = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
const localReadKey = (id: string) => `dsh-jingshen-read:${id}`
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

class SpiritHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export async function spiritRequest<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(15000)
  const response = await fetch(`/personal-spirit/api/${path}`, {
    credentials: 'same-origin',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      'x-personal-spirit': '1',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { method: 'POST', body: JSON.stringify(payload) }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
      ? value.error : `HTTP ${response.status}`
    throw new SpiritHttpError(response.status, message)
  }
  if (value === undefined) throw new Error('宿主返回了无法读取的数据。')
  return value as T
}

const failureOf = (error: unknown): ChatFailure => ({
  ...(error instanceof SpiritHttpError ? { status: error.status } : {}), message: messageOf(error),
})
const isAuthorized = (error: ChatFailure | undefined) => error?.status !== 403 && error?.status !== 401

function parseChat(value: ChatPage): ChatPage {
  if (!value || typeof value.mainId !== 'string' || !Number.isSafeInteger(value.cursor)
    || !Array.isArray(value.messages) || value.messages.some(row => !row || !Number.isSafeInteger(row.cursor)
      || typeof row.id !== 'string' || !['owner', 'spirit'].includes(row.author)
      || typeof row.text !== 'string' || typeof row.at !== 'string' || !row.source
      || typeof row.source.sessionId !== 'string')
    || !value.presence || !Object.hasOwn(activityLabels, value.presence.activity?.kind)) {
    throw new Error('通讯记录格式无法读取。')
  }
  return value
}

function mergeMessages(previous: SpiritMessage[], incoming: SpiritMessage[]): SpiritMessage[] {
  if (!incoming.length) return previous
  const byId = new Map(previous.map(row => [row.id, row]))
  for (const row of incoming) byId.set(row.id, row)
  return [...byId.values()].sort((left, right) => left.cursor - right.cursor)
}

function readCursor(sessionId: string): number | undefined {
  try {
    const raw = localStorage.getItem(localReadKey(sessionId))
    const cursor = raw === null ? undefined : Number(raw)
    return Number.isSafeInteger(cursor) && cursor! >= 0 ? cursor : undefined
  } catch { return undefined }
}

function rememberCursor(sessionId: string, cursor: number) {
  try { localStorage.setItem(localReadKey(sessionId), String(cursor)) } catch { /* The current tab still retains its read state. */ }
}

function useSpiritChat(open: boolean) {
  const [data, setData] = useState<ChatPage>()
  const [error, setError] = useState<ChatFailure>()
  const [olderError, setOlderError] = useState<string>()
  const [olderBusy, setOlderBusy] = useState(false)
  const [cycle, setCycle] = useState(0)
  const [unread, setUnread] = useState(0)
  const [publication, setPublication] = useState<PublicationGesture>()
  const seen = useRef<{ sessionId: string; cursor: number }>()
  const live = useRef<ChatPage>()
  const older = useRef<AbortController>()
  const acknowledge = useCallback(() => {
    if (!live.current) return
    const { mainId, cursor } = live.current
    seen.current = { sessionId: mainId, cursor }
    rememberCursor(mainId, cursor)
    setUnread(0)
  }, [])
  const refresh = useCallback(() => setCycle(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const read = async () => {
      try {
        const before = live.current
        const query = before ? `?after=${before.cursor}&limit=50` : '?limit=40'
        const value = parseChat(await spiritRequest<ChatPage>(`chat${query}`, undefined, controller.signal))
        if (controller.signal.aborted) return
        const current = live.current
        const sameSession = current?.mainId === value.mainId
        const next = sameSession ? { ...value, messages: mergeMessages(current.messages, value.messages),
          hasMore: current.hasMore, nextBefore: current.nextBefore } : value
        live.current = next
        setData(next)
        setError(undefined)
        const published = sameSession && value.messages.findLast(row => row.author === 'spirit' && row.cursor > current.cursor)
        if (published) {
          const expression = value.presence.expression
          setPublication({ duration: Math.max(700, Math.min(2400, published.text.length * 30)),
            mood: expression && Date.parse(expression.until) > Date.now() ? expressionMoods[expression.kind] : undefined })
        }
        if (seen.current?.sessionId !== value.mainId) {
          // The first mount on a device starts from the existing transcript. Subsequent
          // visits after a recorded read still show messages received while away.
          seen.current = { sessionId: value.mainId, cursor: readCursor(value.mainId) ?? value.cursor }
        }
        const unreadCursor = seen.current.cursor
        setUnread(next.messages.filter(row => row.author === 'spirit' && row.cursor > unreadCursor).length)
        if (sameSession && value.hasMore && value.messages.length && value.cursor > (before?.cursor ?? 0)) {
          timer = window.setTimeout(() => void read(), 50)
          return
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          const next = failureOf(reason)
          setError(next)
          if (!isAuthorized(next)) {
            live.current = undefined
            setData(undefined)
            setUnread(0)
            setPublication(undefined)
          }
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void read(), open ? 1600 : 6000)
    }
    void read()
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer) }
  }, [open, cycle])

  useEffect(() => () => older.current?.abort(), [])
  const loadOlder = async () => {
    const start = live.current
    if (!start?.hasMore || start.nextBefore === null || older.current) return false
    const controller = new AbortController()
    older.current = controller
    setOlderError(undefined)
    setOlderBusy(true)
    try {
      const page = parseChat(await spiritRequest<ChatPage>(`chat?before=${start.nextBefore}&limit=40`, undefined, controller.signal))
      const current = live.current
      if (controller.signal.aborted || current?.mainId !== page.mainId) return false
      const next = { ...current, messages: mergeMessages(current.messages, page.messages), hasMore: page.hasMore, nextBefore: page.nextBefore }
      live.current = next
      setData(next)
      return true
    } catch (reason) {
      if (!controller.signal.aborted) setOlderError(messageOf(reason))
      return false
    } finally {
      if (older.current === controller) older.current = undefined
      if (!controller.signal.aborted) setOlderBusy(false)
    }
  }
  return { data, error, unread, refresh, acknowledge, loadOlder, olderBusy, olderError, publication }
}

type IconName = 'arrow' | 'chevron' | 'settings' | 'minus' | 'send' | 'model' | 'chat' | 'history'
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    arrow: 'm14 6-6 6 6 6 M8 12h12', chevron: 'm8 10 4 4 4-4',
    settings: 'M4 7h16M4 17h16M8 4v6m8 4v6', minus: 'M5 12h14',
    send: 'm21 3-7 18-3.5-7.5L3 10l18-7ZM10.5 13.5 21 3',
    model: 'M8 3h8v4h4v10h-4v4H8v-4H4V7h4V3Zm1 7h6v4H9v-4Z',
    chat: 'M20 11.5a7.8 7.8 0 0 1-8 7.5H5l1.8-2.6A7.14 7.14 0 0 1 4 11.5 7.8 7.8 0 0 1 12 4a7.8 7.8 0 0 1 8 7.5ZM9 12h.01m3 0h.01m3 0h.01',
    history: 'M3 12a9 9 0 1 1 2.7 6.4M3 12V6m0 6h6m3-4v4l2.5 1.5',
  }
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

function stamp(value: string, formatter: Intl.DateTimeFormat) {
  const date = new Date(value)
  return Number.isFinite(+date) ? formatter.format(date) : ''
}

function fishActivity(presence: Presence | undefined): FishActivity {
  const activity = presence?.activity
  if (activity?.media?.kind === 'video' && activity.media.state === 'playing') return 'video'
  if (activity?.media?.state === 'observing') return 'observing'
  switch (activity?.kind) {
    case 'thinking':
    case 'working': return 'working'
    case 'observing': return 'observing'
    case 'sleep': return 'sleep'
    default: return 'idle'
  }
}

function useWorkArea(launcher: React.RefObject<HTMLDivElement>) {
  const [edges, setEdges] = useState({ left: 0, right: 0 })
  useLayoutEffect(() => {
    const root = launcher.current
    const overlay = root?.closest('[data-shell-overlay]')
    const rightbar = overlay?.parentElement?.querySelector('[data-rightbar-col]')
    const center = rightbar?.previousElementSibling
    if (!root || !overlay || !rightbar || !center) return
    const update = () => {
      const frame = overlay.getBoundingClientRect(), work = center.getBoundingClientRect()
      const left = Math.max(0, Math.round(work.left - frame.left)), right = Math.max(0, Math.round(frame.right - work.right))
      setEdges(previous => previous.left === left && previous.right === right ? previous : { left, right })
    }
    const viewport = window.visualViewport
    const updateViewport = () => {
      if (!viewport || viewport.scale !== 1) return
      root.style.setProperty('--jingshen-visible-height', `${viewport.height}px`)
      root.style.setProperty('--jingshen-keyboard-inset', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`)
    }
    update()
    updateViewport()
    const observer = new ResizeObserver(update)
    observer.observe(overlay)
    observer.observe(center)
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    return () => {
      observer.disconnect()
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
    }
  }, [launcher])
  return edges
}

export interface SpiritWindowProps {
  renderManagement(openSession: (sessionId: string) => Promise<void>): ReactNode
  renderModels(sessionId: string): ReactNode
  renderNativeInteractions?(sessionId: string, onPendingChange: (pending: number) => void): ReactNode
  openSource(sessionId: string): Promise<void>
  onMainId?(sessionId: string): void
  openSignal?: number
}

export function SpiritWindow({ renderManagement, renderModels, renderNativeInteractions, openSource, onMainId, openSignal }: SpiritWindowProps) {
  const [mode, setMode] = useState<WindowMode>('closed')
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string>()
  const [sending, setSending] = useState(false)
  const [call, setCall] = useState<VoiceCallState>()
  const [follow, setFollow] = useState(true)
  const [watching, setWatching] = useState(false)
  const [nativePending, setNativePending] = useState(0)
  const [gesture, setGesture] = useState<PublicationGesture>()
  const usedGesture = useRef<PublicationGesture>()
  const [sourceError, setSourceError] = useState('')
  const dispatch = useRef<{ requestId: string; text: string }>()
  const pending = useRef(false)
  const lifetime = useRef<AbortController>()
  const root = useRef<HTMLDivElement>(null)
  const dialogTitle = useRef<HTMLHeadingElement>(null)
  const launcher = useRef<HTMLButtonElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const footer = useRef<HTMLElement>(null)
  const wasPhone = useRef(false)
  const receivedOpen = useRef(openSignal)
  const olderHeight = useRef<{ top: number; height: number }>()
  const id = useId()
  const showing = mode !== 'closed'
  const chat = useSpiritChat(showing)
  const { data, error, unread, acknowledge, refresh, publication } = chat
  const notifications = [
    ...(unread ? [`${unread} 条未读`] : []),
    ...(nativePending ? [`${nativePending} 项需要处理`] : []),
  ]
  const { left, right } = useWorkArea(root)
  const kind = data?.presence.activity.kind
  const paused = kind === 'paused' || kind === 'stopped'
  const canSend = !!data && !error && !paused && !call?.connected
  const media = data?.presence.activity.media
  const watchingVideo = watching || media?.kind === 'video' && media.state === 'playing'
  const status = error ? isAuthorized(error) ? '连接中断' : '需要授权'
    : watchingVideo && !paused ? '在看视频' : kind ? activityLabels[kind] : '正在连接'
  const detail = data?.presence.activity.label
  const activity = watchingVideo && !paused ? 'video' : fishActivity(data?.presence)
  const expression = data?.presence.expression
  const isPhone = call?.connected === true && showing && !paused
  const currentMood = expression && Date.parse(expression.until) > Date.now() ? expressionMoods[expression.kind] : undefined
  const mood = !isPhone && gesture ? gesture.mood : currentMood
  const showChat = mode === 'chat' && !isPhone
  const lastCursor = data?.cursor

  useEffect(() => {
    lifetime.current = new AbortController()
    return () => lifetime.current?.abort()
  }, [])
  useEffect(() => {
    if (!publication || usedGesture.current === publication || isPhone) {
      if (isPhone || !publication) {
        usedGesture.current = publication
        setGesture(undefined)
      }
      return
    }
    usedGesture.current = publication
    setGesture(publication)
    const timeout = window.setTimeout(() => setGesture(undefined), publication.duration)
    return () => window.clearTimeout(timeout)
  }, [publication, isPhone])
  useEffect(() => { if (data?.mainId) onMainId?.(data.mainId) }, [data?.mainId, onMainId])
  useEffect(() => {
    if (receivedOpen.current !== openSignal) {
      receivedOpen.current = openSignal
      setFollow(true); setMode('chat')
    }
  }, [openSignal])
  useEffect(() => {
    if (mode !== 'closed') dialogTitle.current?.focus({ preventScroll: true })
  }, [mode])
  useEffect(() => {
    if (isPhone) dialogTitle.current?.focus({ preventScroll: true })
    else if (wasPhone.current && showing) footer.current?.querySelector<HTMLElement>('.spirit-voice button:not(:disabled)')?.focus({ preventScroll: true })
    wasPhone.current = isPhone
  }, [isPhone, showing])
  useEffect(() => {
    if (showChat && follow && !document.hidden) acknowledge()
  }, [showChat, follow, lastCursor, acknowledge])
  useEffect(() => {
    const onVisible = () => { if (showChat && follow && !document.hidden) acknowledge() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [showChat, follow, acknowledge])
  useLayoutEffect(() => {
    const list = transcript.current
    if (!list) return
    if (olderHeight.current) {
      const { top, height } = olderHeight.current
      olderHeight.current = undefined
      list.scrollTop = list.scrollHeight - height + top
    } else if (showChat && follow) list.scrollTop = list.scrollHeight
  }, [showChat, follow, data?.messages])
  const close = () => {
    setMode('closed')
    setCall(undefined)
    launcher.current?.focus({ preventScroll: true })
  }
  const reveal = () => { setFollow(true); setMode('chat') }
  const leaveForSession = async (sessionId: string) => {
    if (sessionId === data?.mainId) { reveal(); return }
    await openSource(sessionId)
    close()
  }
  const visitSource = async (sessionId: string) => {
    setSourceError('')
    try { await leaveForSession(sessionId) }
    catch (reason) { setSourceError(messageOf(reason)) }
  }
  const attemptSend = async () => {
    const text = draft.trim()
    if (!text || !canSend || pending.current) return
    if (dispatch.current?.text !== text) dispatch.current = { requestId: crypto.randomUUID(), text }
    pending.current = true
    setSending(true)
    setSendError(undefined)
    try {
      const result = await spiritRequest<{ accepted: boolean }>('chat', dispatch.current, lifetime.current?.signal)
      if (!result.accepted) throw new Error('宿主尚未接收这条消息。')
      setDraft(current => current.trim() === text ? '' : current)
      dispatch.current = undefined
      setFollow(true)
      refresh()
    } catch (reason) {
      if (!lifetime.current?.signal.aborted) setSendError(messageOf(reason))
    } finally {
      pending.current = false
      if (!lifetime.current?.signal.aborted) setSending(false)
    }
  }
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (mode === 'manage' || mode === 'model') setMode('chat')
    else close()
  }
  const earlier = async () => {
    const list = transcript.current
    if (list) olderHeight.current = { top: list.scrollTop, height: list.scrollHeight }
    setFollow(false)
    if (!await chat.loadOlder()) olderHeight.current = undefined
  }

  return <div className="jingshen-dock" ref={root} data-active-call={isPhone || undefined}
    style={{ '--jingshen-work-left': `${left}px`, '--jingshen-work-right': `${right}px` } as CSSProperties}>
    <style>{css}{fishCss}</style>
    <button type="button" ref={launcher} className="jingshen-launcher"
      aria-label={showing ? '缩小精神通讯' : ['打开精神通讯', ...notifications].join('，')}
      title={detail || status} aria-expanded={showing} aria-controls={showing ? id : undefined} tabIndex={showing ? -1 : 0} onClick={showing ? close : reveal}>
      <SpiritFish activity={activity} mood={mood ?? null} speaking={isPhone ? call?.speaking : !!gesture} onCall={isPhone} />
      <span className="jingshen-launcher-marker" data-status={error ? 'error' : kind} aria-hidden="true">
        {unread && !showing ? Math.min(unread, 99) : <span />}
      </span>
      {!showing && nativePending > 0 && <span className="jingshen-approval-marker" aria-hidden="true">!</span>}
    </button>
    <section id={id} role="dialog" hidden={!showing} aria-labelledby={`${id}-title`} className="jingshen-window" data-view={mode}
      data-phone={isPhone || undefined} onKeyDown={key}>
      <header className="jingshen-header">
        {((mode === 'manage' || mode === 'model') && !isPhone) ? <button type="button" className="jingshen-icon"
          aria-label="返回通讯" title="返回通讯" onClick={() => setMode('chat')}><Icon name="arrow" /></button>
          : <div className="jingshen-header-avatar"><SpiritFish variant="portrait" activity={activity} mood={mood ?? null} /></div>}
        <div className="jingshen-header-text">
          <h1 ref={dialogTitle} id={`${id}-title`} tabIndex={-1}>
            {isPhone ? '精神' : mode === 'manage' ? '管理精神' : mode === 'model' ? '会话模型' : '精神'}
          </h1>
          <span className="jingshen-status" data-state={isPhone ? 'phone' : kind}>
            <span aria-hidden="true" />{isPhone ? call.label || '通话中' : status}
            {!isPhone && mode === 'chat' && detail && <small title={detail}>{detail}</small>}
          </span>
        </div>
        <div className="jingshen-header-actions">
          {nativePending > 0 && mode !== 'chat' && !isPhone && <button type="button" className="jingshen-pending-link"
            aria-label="返回通讯查看待处理请求" onClick={reveal}>{nativePending} 项待处理</button>}
          {mode === 'chat' && !isPhone && <>
            <button type="button" className="jingshen-icon" title="选择主会话模型" aria-label="选择主会话模型"
              disabled={!data || !!error} onClick={() => setMode('model')}><Icon name="model" /></button>
            <button type="button" className="jingshen-icon" title="管理精神"
              aria-label="管理精神" onClick={() => setMode('manage')}><Icon name="settings" /></button>
          </>}
          <button type="button" className="jingshen-icon" title="缩小窗口" aria-label="缩小窗口" onClick={close}><Icon name="minus" /></button>
        </div>
      </header>
      <div className="jingshen-window-main">
        {isPhone ? <div className="jingshen-call-scene">
          <div className="jingshen-call-orbit"><SpiritFish activity={watchingVideo ? 'video' : 'idle'} mood={mood ?? null}
            onCall speaking={call.speaking} /></div>
          <p role="status">{call.label || '通话中'}</p>
        </div> : mode === 'manage' ? <div className="jingshen-management">{renderManagement(leaveForSession)}</div>
          : mode === 'model' ? <div className="jingshen-model-view">
            {data ? renderModels(data.mainId) : <p>连接到主会话后可选择模型。</p>}
          </div> : <>
            <div className="jingshen-transcript" ref={transcript} role="region" aria-label="通讯记录" tabIndex={0}
              onScroll={event => {
                const node = event.currentTarget
                setFollow(node.scrollHeight - node.clientHeight - node.scrollTop < 44)
              }}>
              {data?.hasMore && <div className="jingshen-history">
                <button type="button" disabled={chat.olderBusy} onClick={() => void earlier()}><Icon name="history" />
                  {chat.olderBusy ? '正在读取' : '查看更早消息'}</button>
                {chat.olderError && <p role="alert">{chat.olderError}</p>}
              </div>}
              {!data?.messages.length && <div className="jingshen-empty">
                <div className="jingshen-empty-icon"><Icon name="chat" /></div>
                <p>{error ? isAuthorized(error) ? '无法读取通讯记录' : '此窗口尚未获得授权'
                  : data ? '这里是你和精神的主会话' : '正在连接精神'}</p>
                {data && !error && <small>发一条消息，继续今天的事。</small>}
              </div>}
              {data?.messages.map((row, index) => {
                const date = stamp(row.at, dateFormatter)
                const showDate = date && (index === 0 || date !== stamp(data.messages[index - 1]!.at, dateFormatter))
                const otherSession = row.source.sessionId !== data.mainId
                return <div key={row.id}>
                  {showDate && <div className="jingshen-date"><span>{date}</span></div>}
                  <article className="jingshen-message" data-author={row.author} data-message-id={row.id}>
                    <div className="jingshen-bubble">{row.text}</div>
                    <div className="jingshen-message-meta">
                      {otherSession && <button type="button" onClick={() => void visitSource(row.source.sessionId)}>
                        {row.source.title || '查看来源会话'} <span aria-hidden="true">↗</span></button>}
                      <time dateTime={row.at}>{stamp(row.at, timeFormatter)}</time>
                    </div>
                  </article>
                </div>
              })}
            </div>
            {!follow && unread > 0 && <button type="button" className="jingshen-jump" onClick={() => setFollow(true)}>
              {unread} 条新消息 <Icon name="chevron" />
            </button>}
          </>}
      </div>
      {data && renderNativeInteractions && <div className="jingshen-native-interactions" hidden={mode === 'manage' || mode === 'model'}>
        {renderNativeInteractions(data.mainId, setNativePending)}
      </div>}
      {sourceError && showChat && <div className="jingshen-notice" role="alert">{sourceError}</div>}
      {error && mode === 'chat' && !isPhone && <div className="jingshen-notice" role="alert">
        <span>{isAuthorized(error) ? error.message : '请在已连接的本机 Harness 中重新打开此窗口。'}</span>
        <button type="button" onClick={refresh}>重试</button>
      </div>}
      <footer className="jingshen-footer" ref={footer} hidden={mode !== 'chat' && !isPhone}>
        <div className="jingshen-media" data-call={isPhone || undefined}>
          {showing && <VoiceCall key="voice" active={!!data && !paused && !error} onCallChange={setCall} />}
          {data && <VisionControls key="vision" paused={paused || !isAuthorized(error)} minimized={!showing} onWatchingChange={setWatching} />}
        </div>
        {showChat && <form className="jingshen-compose" onSubmit={event => { event.preventDefault(); void attemptSend() }}>
          <div className="jingshen-compose-box">
            <textarea rows={1} aria-label="给精神发消息" value={draft} maxLength={8000}
              disabled={!canSend} placeholder={paused ? '恢复活动后发送消息' : '发消息给精神'}
              onChange={event => { setDraft(event.target.value); setSendError(undefined) }}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
                event.preventDefault()
                void attemptSend()
              }} />
            <button type="submit" className="jingshen-send" aria-label="发送消息" title="发送消息"
              disabled={!canSend || !draft.trim() || sending}><Icon name="send" /></button>
          </div>
          {sendError && <p role="alert">{sendError}</p>}
        </form>}
      </footer>
    </section>
  </div>
}
