/** An explicitly paired Chromium tab exposes only its current media transport. */
export interface CapturedVideoControls {
  control(action: 'play' | 'stop' | 'status'): Promise<{ time: number; playing: boolean }>
}

type CaptureTrack = MediaStreamTrack & { getCaptureHandle?: () => { handle: string } | null }
const channel = 'dsh-jingshen/video-tab/v1'
const handlePattern = /^spirit-video-[0-9a-f-]{36}$/

export async function bindCapturedVideo(track: MediaStreamTrack, signal: AbortSignal): Promise<CapturedVideoControls | undefined> {
  const selected = track as CaptureTrack
  const handle = selected.getCaptureHandle?.()?.handle
  if (!handle || !handlePattern.test(handle) || signal.aborted) return
  const control: CapturedVideoControls['control'] = async action => {
    signal.throwIfAborted()
    if (track.readyState === 'ended' || selected.getCaptureHandle?.()?.handle !== handle) throw new Error('视频标签页的共享已结束。')
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const clear = () => {
        window.clearTimeout(timer)
        window.removeEventListener('message', receive)
        signal.removeEventListener('abort', abort)
        track.removeEventListener('ended', abort)
        track.removeEventListener('capturehandlechange', changed)
      }
      const abort = () => { clear(); reject(new Error('视频标签页的授权已结束。')) }
      const changed = () => { if (selected.getCaptureHandle?.()?.handle !== handle) abort() }
      const receive = (event: MessageEvent) => {
        if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel
          || event.data.kind !== 'reply' || event.data.id !== id) return
        clear()
        const result = event.data.result
        if (selected.getCaptureHandle?.()?.handle !== handle || !result || typeof result.playing !== 'boolean'
          || typeof result.time !== 'number' || !Number.isFinite(result.time) || result.time < 0) {
          reject(new Error('视频标签页无法执行此操作，请检查标签页授权和播放器。'))
        } else resolve({ time: result.time, playing: result.playing })
      }
      const timer = window.setTimeout(() => { clear(); reject(new Error('视频标签页控制已超时。')) }, 1500)
      window.addEventListener('message', receive)
      signal.addEventListener('abort', abort, { once: true })
      track.addEventListener('ended', abort, { once: true })
      track.addEventListener('capturehandlechange', changed)
      window.postMessage({ channel, kind: 'command', id, action, handle }, location.origin)
    })
  }
  try { await control('status'); return { control } } catch { return undefined }
}
