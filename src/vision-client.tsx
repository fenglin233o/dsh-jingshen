import { useCallback, useEffect, useRef, useState } from 'react'
import { MediaIcon } from './media-icons.tsx'
import { bindCapturedVideo, type CapturedVideoControls } from './vision-tab.ts'
import { permittedVideoUrl, videoHost } from './vision-url.ts'

const apiPath = '/personal-spirit/api/vision'
const cadence = 850
const maxVideoBytes = 25 * 1024 * 1024
type Source = 'camera' | 'screen' | 'video-tab' | 'tab-video' | 'video' | 'video-library'
type Detection = { label: string; confidence: number; box: [number, number, number, number] }
type WatchCommand = { id: string; action: 'play' | 'stop'; expires: number; url?: string }
type Capture = {
  token: string; source: Source; stream?: MediaStream; media?: string; objectUrl?: string
  tab?: CapturedVideoControls
  allowedHost?: string; download?: AbortController; downloadedUrl?: string
  worker: Worker; timer?: number; controller: AbortController; ready: boolean; seq: number
  command?: WatchCommand; lastMediaTime?: number; lastCapturedAt?: number
  pendingFrame?: { capturedAt: number; mediaTime?: number; commandId?: string }
  polling?: boolean; sending?: boolean; lastPollAt?: number
}
type Props = {
  paused?: boolean
  inPhone: boolean
  callInProgress: boolean
  open: boolean
  panelId: string
  onToggle: () => void
  onWatchingChange?: (watching: boolean) => void
}

const isAuthorizedVideo = (source: Source) => source === 'video' || source === 'video-library'

async function post<T>(route: string, data: unknown, options: { signal?: AbortSignal; keepalive?: boolean } = {}): Promise<T> {
  const response = await fetch(apiPath + route, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-personal-spirit': '1' },
    body: JSON.stringify(data), keepalive: options.keepalive,
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000),
  })
  const decoded = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(decoded.error ?? '视觉连接失败。')
  return decoded
}

function remoteVideo(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw new Error('请输入不包含登录信息的 HTTPS 直链视频。')
  }
  return url.href
}

async function downloadVideo(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) })
  const type = response.headers.get('content-type')?.split(';', 1)[0]
  if (!response.ok || !response.body || !type?.startsWith('video/')) {
    await response.body?.cancel()
    throw new Error('无法取得可直接播放的 HTTPS 视频。')
  }
  if (Number(response.headers.get('content-length')) > maxVideoBytes) {
    await response.body.cancel()
    throw new Error('所选视频超过 25 MiB。')
  }
  const reader = response.body.getReader(), chunks: BlobPart[] = []
  let bytes = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > maxVideoBytes) throw new Error('所选视频超过 25 MiB。')
      chunks.push(part.value as Uint8Array<ArrayBuffer>)
    }
    return new Blob(chunks, { type })
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
}

function clearPlayer(value: Capture, element: HTMLVideoElement): void {
  value.download?.abort()
  value.download = undefined
  element.pause()
  element.removeAttribute('src')
  element.load()
  if (value.downloadedUrl) URL.revokeObjectURL(value.downloadedUrl)
  value.downloadedUrl = undefined
}

export function VisionControls({ paused = false, inPhone, callInProgress, open, panelId, onToggle, onWatchingChange }: Props) {
  const [status, setStatus] = useState('')
  const [source, setSource] = useState<Source>()
  const [watching, setWatching] = useState(false)
  const [starting, setStarting] = useState(false)
  const [canSend, setCanSend] = useState(false)
  const [labels, setLabels] = useState<string[]>([])
  const [remote, setRemote] = useState('')
  const [libraryHost, setLibraryHost] = useState('upload.wikimedia.org')
  const video = useRef<HTMLVideoElement>(null)
  const capture = useRef<Capture>()
  const generation = useRef(0)
  const startingCapture = useRef<{ source: Source; controller: AbortController }>()
  const pausedRef = useRef(paused)
  const inPhoneRef = useRef(inPhone)
  const wasCalling = useRef(callInProgress)
  pausedRef.current = paused
  inPhoneRef.current = inPhone

  const end = useCallback((keepalive = false) => {
    generation.current++
    startingCapture.current?.controller.abort()
    const value = capture.current
    capture.current = undefined
    if (value) {
      window.clearInterval(value.timer)
      if (value.command?.action === 'play') void value.tab?.control('stop').catch(() => {})
      value.download?.abort()
      if (value.downloadedUrl) URL.revokeObjectURL(value.downloadedUrl)
      value.controller.abort()
      value.worker.terminate()
      for (const track of value.stream?.getTracks() ?? []) track.stop()
      if (value.objectUrl) URL.revokeObjectURL(value.objectUrl)
      void post('/stop', { token: value.token }, { keepalive }).catch(() => {})
    }
    const element = video.current
    if (value && element) {
      element.pause()
      element.srcObject = null
      element.removeAttribute('src')
      element.load()
    }
    setSource(undefined)
    setCanSend(false)
    setLabels([])
    setStarting(false)
    setWatching(false)
  }, [])

  useEffect(() => {
    const leave = () => end(true)
    window.addEventListener('pagehide', leave)
    return () => { window.removeEventListener('pagehide', leave); leave() }
  }, [end])
  useEffect(() => {
    if (paused) { end(); setStatus('') }
  }, [end, paused])
  useEffect(() => {
    const hungUp = wasCalling.current && !callInProgress
    wasCalling.current = callInProgress
    if (inPhone && !hungUp) return
    const source = capture.current?.source ?? startingCapture.current?.source
    if (source && !isAuthorizedVideo(source)) { end(); setStatus('视觉共享已结束。') }
  }, [end, inPhone, callInProgress])
  useEffect(() => { onWatchingChange?.(watching) }, [watching, onWatchingChange])

  const fail = (value: Capture, error: unknown) => {
    if (capture.current !== value || value.controller.signal.aborted) return
    end()
    setStatus(error instanceof Error ? error.message : String(error))
  }

  const playbackEnded = async (value: Capture, failed = false) => {
    const command = value.command
    if (!command || command.action !== 'play' || capture.current !== value) return
    value.command = undefined
    value.lastCapturedAt = undefined
    value.lastMediaTime = undefined
    setWatching(false)
    setCanSend(false)
    setLabels([])
    try {
      await post('/ended', { token: value.token, commandId: command.id, ...(failed ? { failed: true } : {}) },
        { signal: value.controller.signal })
    } catch (error) { fail(value, error) }
  }

  const playLocalOrRemote = async (value: Capture, element: HTMLVideoElement, command: WatchCommand) => {
    const download = new AbortController()
    value.download = download
    try {
      let url = value.objectUrl
      if (!url) {
        const source = value.allowedHost && command.url ? permittedVideoUrl(command.url, value.allowedHost) : value.media
        if (!source) throw new Error('没有已选择的视频。')
        const blob = await downloadVideo(source, AbortSignal.any([download.signal, value.controller.signal]))
        if (download.signal.aborted || value.command?.id !== command.id) return
        url = URL.createObjectURL(blob)
        value.downloadedUrl = url
      }
      element.removeAttribute('crossorigin')
      element.src = url
      await element.play()
    } catch (error) {
      if (download.signal.aborted || capture.current !== value) return
      clearPlayer(value, element)
      setStatus(error instanceof Error ? error.message : String(error))
      await playbackEnded(value, true)
    }
  }

  const sample = async (value: Capture, element: HTMLVideoElement, playerTime?: number) => {
    if (!value.ready || value.pendingFrame || value.sending || element.paused || element.readyState < 2
      || !element.videoWidth || !element.videoHeight) return
    const mediaTime = element.currentTime
    if (value.lastMediaTime === mediaTime) return
    value.lastMediaTime = mediaTime
    const capturedAt = Date.now(), timestamp = performance.now()
    const width = Math.min(480, element.videoWidth)
    const observedTime = isAuthorizedVideo(value.source) ? mediaTime : playerTime
    value.pendingFrame = { capturedAt,
      ...(observedTime !== undefined ? { mediaTime: observedTime, commandId: value.command?.id } : {}) }
    let bitmap: ImageBitmap | undefined
    try {
      bitmap = await createImageBitmap(element, { resizeWidth: width,
        resizeHeight: Math.max(1, Math.round(element.videoHeight * width / element.videoWidth)), resizeQuality: 'low' })
      if (capture.current !== value) return
      value.worker.postMessage({ type: 'detect', bitmap, timestamp }, [bitmap])
      bitmap = undefined
    } catch (error) { fail(value, error) }
    finally { bitmap?.close() }
  }

  const update = async (value: Capture, element: HTMLVideoElement) => {
    if (capture.current !== value || value.polling) return
    value.polling = true
    try {
      if (value.lastCapturedAt && Date.now() - value.lastCapturedAt > 3900) {
        value.lastCapturedAt = undefined
        setCanSend(false)
        setLabels([])
      }
      const controlsPlayer = isAuthorizedVideo(value.source) || value.tab
      let playerTime: number | undefined
      if (!controlsPlayer && Date.now() - (value.lastPollAt ?? 0) >= 2000) {
        value.lastPollAt = Date.now()
        await post('/poll', { token: value.token }, { signal: value.controller.signal })
        if (capture.current !== value) return
      }
      if (controlsPlayer) {
        const state = await post<{ command?: WatchCommand; watching: boolean }>('/poll', { token: value.token },
          { signal: value.controller.signal })
        if (capture.current !== value) return
        setWatching(state.watching)
        const next = state.command
        if (next?.id !== value.command?.id) {
          value.command = next
          value.lastMediaTime = undefined
          value.lastCapturedAt = undefined
          setCanSend(false)
          setLabels([])
          if (value.tab) {
            if (next) await value.tab.control(next.action)
          } else {
            clearPlayer(value, element)
            if (next?.action === 'play' && next.expires > Date.now()) void playLocalOrRemote(value, element, next)
          }
        }
        if (value.command?.action === 'play' && value.command.expires <= Date.now()) {
          if (value.tab) await value.tab.control('stop')
          else clearPlayer(value, element)
          await playbackEnded(value)
        }
        if (value.tab) {
          const target = await value.tab.control('status')
          if (target.playing && value.command?.action === 'play') playerTime = target.time
        } else if (value.command?.action !== 'play') return
      }
      await sample(value, element, playerTime)
    } catch (error) { fail(value, error) }
    finally { value.polling = false }
  }

  const start = async (requested: Source, media?: { url?: string; objectUrl?: string; allowedHost?: string }) => {
    if (pausedRef.current || !inPhoneRef.current || capture.current || startingCapture.current) {
      if (media?.objectUrl) URL.revokeObjectURL(media.objectUrl)
      return
    }
    const epoch = ++generation.current
    const controller = new AbortController()
    startingCapture.current = { source: requested, controller }
    setStarting(true)
    setStatus('')
    let stream: MediaStream | undefined, value: Capture | undefined, token: string | undefined
    const canceled = () => generation.current !== epoch || pausedRef.current || (!inPhoneRef.current && !isAuthorizedVideo(requested))
    const stopPendingTracks = () => { for (const track of stream?.getTracks() ?? []) track.stop() }
    controller.signal.addEventListener('abort', stopPendingTracks, { once: true })
    try {
      let selected = requested
      let tab: CapturedVideoControls | undefined
      if (requested === 'camera') {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 } } })
      } else if (!isAuthorizedVideo(requested)) {
        stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: requested === 'video-tab' ? { displaySurface: 'browser' } : true })
        const track = stream.getVideoTracks()[0]
        if (requested === 'video-tab') {
          if (track?.getSettings().displaySurface !== 'browser') selected = 'screen'
          else if (track) {
            tab = await bindCapturedVideo(track, controller.signal)
            if (tab) selected = 'tab-video'
          }
        }
      }
      if (canceled() || !video.current) return
      const element = video.current
      token = (await post<{ token: string }>('/start', { source: selected, allowedHost: media?.allowedHost })).token
      if (canceled()) return
      const worker = new Worker(apiPath + '/assets/detector.js')
      setStatus('正在加载本机视觉识别。')
      value = { token, source: selected, stream, media: media?.url, objectUrl: media?.objectUrl, allowedHost: media?.allowedHost, worker,
        tab, controller, ready: false, seq: 0 }
      capture.current = value
      const owned = value
      worker.onerror = () => fail(owned, new Error('无法启动本机视觉识别。'))
      worker.onmessage = event => {
        if (capture.current !== owned) return
        const result = event.data as { type: 'ready' | 'error' | 'result'; error?: string; detections?: Detection[] }
        if (result.type === 'ready') {
          owned.ready = true
          setStatus(isAuthorizedVideo(selected) || selected === 'tab-video'
            ? '视频已授权，由精神选择何时播放。' : '本机实时物体识别已开启。')
          return
        }
        if (result.type === 'error') return fail(owned, result.error ?? '本机识别失败。')
        const frame = owned.pendingFrame
        owned.pendingFrame = undefined
        if (!frame || Date.now() - frame.capturedAt > 3900) return
        owned.sending = true
        void post<{ accepted: boolean }>('/frame', { token: owned.token, seq: ++owned.seq, ...frame, detections: result.detections },
          { signal: owned.controller.signal }).then(({ accepted }) => {
          if (accepted && capture.current === owned) {
            owned.lastCapturedAt = frame.capturedAt
            setCanSend(true)
            setLabels([...new Set((result.detections ?? []).map(item => item.label))])
          }
        }).catch(error => fail(owned, error)).finally(() => { owned.sending = false })
      }
      worker.postMessage({ type: 'init' })
      for (const track of stream?.getVideoTracks() ?? []) {
        track.addEventListener('ended', () => { if (capture.current === owned) { end(); setStatus('视觉共享已结束。') } }, { once: true })
      }
      if (stream) {
        element.srcObject = stream
        await element.play()
      }
      if (capture.current !== owned) return
      setSource(selected)
      owned.timer = window.setInterval(() => { void update(owned, element) }, cadence)
      void update(owned, element)
    } catch (error) {
      if (value) fail(value, error)
      else if (generation.current === epoch) setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      controller.signal.removeEventListener('abort', stopPendingTracks)
      if (!value) {
        if (token) void post('/stop', { token }).catch(() => {})
        stopPendingTracks()
        if (media?.objectUrl) URL.revokeObjectURL(media.objectUrl)
      }
      if (startingCapture.current?.controller === controller) startingCapture.current = undefined
      if (generation.current === epoch) setStarting(false)
    }
  }

  const send = async () => {
    const value = capture.current, element = video.current
    if (!value || !element || !inPhoneRef.current || pausedRef.current || element.paused || !value.lastCapturedAt
      || Date.now() - value.lastCapturedAt > 3900 || element.readyState < 2) return setStatus('暂时没有新画面可发送。')
    const capturedAt = Date.now()
    try {
      const canvas = document.createElement('canvas')
      canvas.width = Math.min(800, element.videoWidth)
      canvas.height = Math.round(element.videoHeight * canvas.width / element.videoWidth)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器无法读取这帧画面。')
      context.drawImage(element, 0, 0, canvas.width, canvas.height)
      const jpeg = canvas.toDataURL('image/jpeg', 0.77)
      const data = jpeg.slice('data:image/jpeg;base64,'.length)
      if (!jpeg.startsWith('data:image/jpeg;base64,') || !data) throw new Error('浏览器无法编码当前画面。')
      await post('/image', { token: value.token, requestId: crypto.randomUUID(), capturedAt, data },
        { signal: value.controller.signal })
      if (capture.current === value) setStatus('当前画面已发送到精神主会话。')
    } catch (error) {
      if (capture.current === value) setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return <div className="spirit-vision" hidden={!inPhone}>
    {inPhone && <button type="button" className="jingshen-icon" data-capturing={!!source || undefined}
      title={source ? '视觉已开启' : '视觉'} aria-label={source ? '视觉已开启' : '视觉'}
      aria-controls={panelId} aria-expanded={open} onClick={onToggle}><MediaIcon name="camera" /></button>}
    <div id={panelId} hidden={!open} className="spirit-vision-controls">
      {inPhone && !source && <fieldset disabled={paused || starting}>
        <legend>本机视觉</legend>
        <p>开启后，浏览器在本机识别物体。精神可以读取识别标签和位置。单独发送画面会把该帧存入主会话，并交给当前模型。</p>
        <button type="button" onClick={() => void start('camera')}>开启摄像头</button>
        <button type="button" onClick={() => void start('screen')}>共享屏幕</button>
        <button type="button" onClick={() => void start('video-tab')}>共享正在用的浏览器标签页</button>
        <label>授权精神观看本地视频 <input aria-label="授权精神观看本地视频" type="file" accept="video/*" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) { const url = URL.createObjectURL(file); void start('video', { url, objectUrl: url }) }
        }} /></label>
        <label>HTTPS 视频直链<input type="url" value={remote} onChange={event => setRemote(event.target.value)} /></label>
        <button type="button" disabled={!remote.trim()} onClick={() => {
          try { void start('video', { url: remoteVideo(remote) }) }
          catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
        }}>授权精神观看网络视频</button>
        <label>允许自行选片的 HTTPS 域名<input value={libraryHost} onChange={event => setLibraryHost(event.target.value)} /></label>
        <button type="button" onClick={() => {
          try { void start('video-library', { allowedHost: videoHost(libraryHost) }) }
          catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
        }}>授权精神从此域名选片</button>
        <p>网页视频需允许跨域读取，网络短片上限 25 MiB。已登录的网页可共享画面。若要让精神控制网页播放器，先在 Harness 和该网页分别点击已安装的配套扩展图标，再共享该标签页。</p>
      </fieldset>}
      {inPhone && source && <div>
        <button type="button" onClick={() => { end(); setStatus('视觉共享已结束。') }}>停止视觉</button>
        <button type="button" disabled={!canSend || paused} onClick={() => void send()}>发送当前画面</button>
      </div>}
      <video ref={video} hidden={!source || isAuthorizedVideo(source) && !watching} muted playsInline aria-label="视觉预览"
        onEnded={() => { if (capture.current) void playbackEnded(capture.current) }}
        onError={() => {
          const value = capture.current
          if (value && isAuthorizedVideo(value.source) && value.command?.action === 'play') {
            if (video.current) clearPlayer(value, video.current)
            setStatus('浏览器无法播放此视频。可选择其他来源，或分享原浏览器标签页。')
            void playbackEnded(value, true)
          }
        }} />
      {inPhone && labels.length > 0 && <p>当前识别 {labels.join('、')}</p>}
      {inPhone && status && <p role="status">{status}</p>}
    </div>
  </div>
}
