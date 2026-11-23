import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MediaIcon } from './media-icons.tsx'
import { encodeVoiceWav, PcmPlayer, SpeechGate } from './voice-audio.ts'
import { deviceVoice, speakOnDevice } from './voice-device.ts'
import { PLAY_RATE, VOICE_PATH, type VoiceAvailability, type VoiceDelivery, type VoiceEvent } from './voice-protocol.ts'

type Phase = 'checking' | 'idle' | 'connecting' | 'listening' | 'muted' | 'speaking' | 'transcribing' | 'disconnected'
type OutputPreference = 'auto' | 'host' | 'system' | 'input'
type HostOutput = NonNullable<VoiceAvailability['output']>
type CallOutput = { kind: 'host'; info?: HostOutput } | { kind: 'system'; voice: SpeechSynthesisVoice }
export interface VoiceCallState {
  connected: boolean
  listening: boolean
  speaking: boolean
  phase: Phase
  label: string
  error?: string
  outputError?: string
  availability?: VoiceAvailability
  outputLabel?: string
  microphoneAvailable?: boolean
  microphoneOpening?: boolean
}
interface LiveCall {
  id?: string
  abort: AbortController
  context: AudioContext
  player: PcmPlayer
  input: boolean
  preference: OutputPreference
  output?: CallOutput
  recording: boolean
  framesPending: number
  lastSequence: number
  lastInput?: string
  pending: VoiceDelivery[]
  utterances: Promise<unknown>
  playback?: { message: VoiceDelivery; abort: AbortController }
  microphone?: { stream: MediaStream; source: MediaStreamAudioSourceNode; node: AudioWorkletNode; sink: GainNode }
  openingStream?: MediaStream
  micEpoch: number
}

const labels: Record<Phase, string> = {
  checking: '正在检查语音连接', idle: '语音未接通', connecting: '正在接通语音',
  listening: '正在聆听', muted: '已关闭麦克风', speaking: '精神正在说话', transcribing: '正在转写',
  disconnected: '语音连接已断开',
}
const initialState: VoiceCallState = { connected: false, listening: false, speaking: false, phase: 'checking', label: labels.checking }
const preferenceKey = 'personal-spirit:voice-output'
const breezeKeys = 'https://breezeblue.ai/zh/app/developer/api-keys'
const breezePreview = 'https://breezeblue.ai/zh/voice-library/dafeiyu-dreamy-girl-voice-v8yud7hz7c9q2'
const breezeUnavailable = 'BreezeBlue 朗读不可用。请检查 Harness 凭据 BREEZE_API_KEY。'

function loadOutputPreference(): OutputPreference {
  try {
    const value = window.localStorage.getItem(preferenceKey)
    if (value === 'host' || value === 'system' || value === 'input') return value
  } catch { /* Browsers may block storage in embedded views. */ }
  return 'auto'
}

function expectsBreeze(availability?: VoiceAvailability): boolean {
  return availability?.setup?.kind === 'breeze-key' || availability?.output?.provider === 'breezeblue'
}

function chooseOutput(preference: OutputPreference, neural: boolean, info: HostOutput | undefined,
  voice: SpeechSynthesisVoice | undefined, breeze: boolean): CallOutput | undefined {
  if (preference === 'input') return
  if (preference !== 'system' && neural && (!breeze || info?.provider === 'breezeblue')) return { kind: 'host', info }
  if (voice && (preference === 'system' || preference === 'auto' && !breeze)) return { kind: 'system', voice }
}

function outputLabel(output?: CallOutput): string {
  if (!output) return '仅语音转写'
  if (output.kind === 'system') return `设备中文朗读 · ${output.voice.name}`
  const { info } = output
  return info ? `${info.name}（${info.location === 'host-local' ? '宿主本机' : '远端服务'}）` : '宿主语音合成'
}

class VoiceRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message) }
}

function breezeError(error: unknown): { message: string; pause: boolean } {
  if (error instanceof VoiceRequestError) {
    if (error.status === 402 || error.code === 'breeze-credits' || /积分|余额|额度|credits?/i.test(error.message)) {
      return { message: 'BreezeBlue 积分不足。请到 BreezeBlue 检查余额后重新接通。', pause: true }
    }
    if (error.status === 401 || error.status === 403 || error.code === 'breeze-auth'
      || /认证|密钥|凭据|unauthorized|api key/i.test(error.message)) {
      return { message: 'BreezeBlue 认证失败。请检查 Harness 凭据 BREEZE_API_KEY 后重新接通。', pause: true }
    }
    if (error.status === 429 || /请求过多|HTTP 429/i.test(error.message)) {
      return { message: 'BreezeBlue 请求过多，未能朗读这条回复。', pause: false }
    }
  }
  return { message: 'BreezeBlue 未能朗读这条回复。', pause: false }
}

export async function voiceFetch(action: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('x-personal-spirit', '1')
  const query = new URLSearchParams(params).toString()
  const response = await fetch(`${VOICE_PATH}/${action}${query ? '?' + query : ''}`, { credentials: 'same-origin', ...init, headers })
  if (response.ok) return response
  const error = await response.json().catch(() => ({})) as { error?: string; code?: string }
  throw new VoiceRequestError(error.error ?? '语音连接失败', response.status, error.code)
}

export class VoiceTransport {
  private state = initialState
  private call?: LiveCall
  private checkEpoch = 0

  constructor(private readonly changed: (state: VoiceCallState) => void) {}

  private update(update: Partial<VoiceCallState>, phase?: Phase): void {
    const transcriptionOnly = this.call?.input && !this.call.output
      && (phase === 'listening' || phase === 'muted' || phase === 'transcribing')
    this.state = { ...this.state, ...update, ...(phase
      ? { phase, label: transcriptionOnly ? `仅语音转写 · ${labels[phase]}` : labels[phase] } : {}) }
    this.changed(this.state)
  }

  async check(signal?: AbortSignal): Promise<void> {
    const epoch = ++this.checkEpoch
    try {
      const availability = await (await voiceFetch('status', {}, { signal })).json() as VoiceAvailability
      if (epoch === this.checkEpoch && !signal?.aborted && !this.call) this.update({ availability, error: undefined }, 'idle')
    } catch (error) {
      if (epoch === this.checkEpoch && !signal?.aborted && !this.call) this.update({ availability: undefined,
        error: error instanceof Error ? error.message : '无法检查语音服务' }, 'disconnected')
    }
  }

  async connect(preference: OutputPreference): Promise<void> {
    if (this.call) return
    let context: AudioContext
    try { context = new AudioContext() }
    catch { this.update({ error: '浏览器不支持通话所需的 Web Audio' }, 'disconnected'); return }
    const call: LiveCall = {
      abort: new AbortController(), context, player: new PcmPlayer(context), input: false, preference, recording: false,
      framesPending: 0, lastSequence: 0, pending: [], utterances: Promise.resolve(), micEpoch: 0,
    }
    this.call = call
    this.update({ error: undefined, outputError: undefined }, 'connecting')
    try {
      await context.resume()
      const response = await voiceFetch('call', {}, { method: 'POST', signal: call.abort.signal })
      const opened = await response.json() as { id: string; input: boolean; neural: boolean;
        output?: VoiceAvailability['output']; setup?: VoiceAvailability['setup'] }
      call.id = opened.id
      call.input = opened.input
      if (this.call !== call) { this.sendHangup(call); return }
      const availability = this.state.availability
      const info = opened.setup?.kind === 'breeze-key' ? null : opened.output === undefined ? availability?.output : opened.output
      const breeze = expectsBreeze(availability) || opened.setup?.kind === 'breeze-key' || info?.provider === 'breezeblue'
      if (availability && (opened.setup?.kind === 'breeze-key' || info?.provider === 'breezeblue' && availability.setup)) {
        this.update({ availability: { ...availability, output: opened.setup ? null : info ?? null, setup: opened.setup } })
      }
      call.output = chooseOutput(preference, opened.neural, info ?? undefined, deviceVoice(), breeze)
      if (!call.output && (!opened.input || preference !== 'auto' && preference !== 'input')) {
        throw new Error(breeze && preference !== 'system' && preference !== 'input'
          ? breezeUnavailable
          : '所选语音方式当前不可用，请检查语音')
      }
      if (!call.output && preference === 'auto' && availability?.output?.provider === 'breezeblue') {
        this.update({ outputError: breezeUnavailable })
      }
      await this.events(call)
      if (this.call === call) this.hangup('语音连接已断开')
    } catch (error) {
      if (this.call === call) this.hangup(error instanceof Error ? error.message : '语音连接失败')
    }
  }

  private async events(call: LiveCall): Promise<void> {
    const response = await voiceFetch('events', { call: call.id! }, { signal: call.abort.signal })
    if (!response.body) throw new Error('无法读取语音连接')
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let queue = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      for (;;) {
        clearTimeout(timer)
        timer = setTimeout(() => { if (this.call === call) this.hangup('语音连接超时') }, 24_000)
        const read = await reader.read()
        if (read.done || this.call !== call) return
        queue += decoder.decode(read.value, { stream: true })
        const data = queue.split('\n')
        queue = data.pop() ?? ''
        if (queue.length > 1_000_000) throw new Error('语音连接数据无效')
        for (const line of data) if (line) this.receive(call, JSON.parse(line) as VoiceEvent)
      }
    } finally { clearTimeout(timer); void reader.cancel().catch(() => {}) }
  }

  private receive(call: LiveCall, event: VoiceEvent): void {
    if (this.call !== call) return
    if (event.type === 'ready') {
      if (this.state.connected) return
      this.update({ connected: true, microphoneAvailable: call.input, outputLabel: outputLabel(call.output) }, 'muted')
      if (call.input) void this.unmute()
    } else if (event.type === 'closed') {
      this.hangup(event.reason)
    } else if (event.type === 'speech') {
      call.lastSequence = Math.max(event.message.sequence, call.lastSequence)
      if (!call.output) { this.media(call, event.message, 'end'); return }
      call.pending.push(event.message)
      void this.speakNext(call)
    }
  }

  private media(call: LiveCall, message: VoiceDelivery, state: 'start' | 'end'): void {
    void voiceFetch('playing', { call: call.id!, message: message.id, state }, { method: 'POST', signal: call.abort.signal }).catch(() => {})
  }

  private async speakNext(call: LiveCall): Promise<void> {
    if (this.call !== call || call.playback || call.recording) return
    const message = call.pending.shift()
    if (!message) return
    const playback = { message, abort: new AbortController() }
    call.playback = playback
    const signal = AbortSignal.any([call.abort.signal, playback.abort.signal])
    let started = false
    let retryOnDevice = false
    const start = () => {
      if (signal.aborted || this.call !== call || started) return
      started = true
      this.update({ speaking: true, outputError: undefined }, 'speaking')
      this.media(call, message, 'start')
    }
    try {
      if (call.output?.kind === 'system') await speakOnDevice(message, call.output.voice, signal, start)
      else if (call.output?.kind === 'host') {
        const response = await voiceFetch('speech', { call: call.id!, message: message.id }, { signal })
        if (!response.body || response.headers.get('x-spirit-pcm-rate') !== String(PLAY_RATE)) throw new Error('无效的语音播放数据')
        await call.player.stream(response.body, signal, start)
      }
    } catch (error) {
      if (call.playback === playback) call.player.stop()
      if (!signal.aborted && this.call === call) {
        const host = call.output?.kind === 'host' ? call.output.info : undefined
        const voice = !started && host?.provider !== 'breezeblue' && call.preference === 'auto'
          && call.output?.kind === 'host' ? deviceVoice() : undefined
        if (host?.provider === 'breezeblue') {
          const failure = breezeError(error)
          if (failure.pause) {
            call.output = undefined
            for (const waiting of call.pending) this.media(call, waiting, 'end')
            call.pending = []
            if (call.input) this.update({ outputLabel: outputLabel(), outputError: failure.message })
            else this.hangup(failure.message)
          } else this.update({ outputError: failure.message })
        } else if (voice) {
          call.output = { kind: 'system', voice }
          this.update({ outputLabel: outputLabel(call.output) })
          retryOnDevice = true
          call.pending.unshift(message)
        } else this.update({ error: error instanceof Error ? error.message : '语音播放失败' })
      }
    } finally {
      if (!retryOnDevice && this.call === call) this.media(call, message, 'end')
      if (call.playback === playback) {
        call.playback = undefined
        if (this.call === call) {
          this.update({ speaking: false }, this.restingPhase(call))
          void this.speakNext(call)
        }
      }
    }
  }

  private restingPhase(call: LiveCall): Phase {
    if (this.state.speaking && call.playback) return 'speaking'
    if (call.framesPending) return 'transcribing'
    return call.microphone ? 'listening' : 'muted'
  }

  private bargeIn(call: LiveCall): void {
    if (this.call !== call) return
    call.recording = true
    this.interruptPlayback(call)
  }

  interrupt(): void {
    const call = this.call
    if (call && this.state.speaking) this.interruptPlayback(call)
  }

  private interruptPlayback(call: LiveCall): void {
    const reading = call.playback?.message.id
    call.pending = []
    this.stopPlayback(call)
    this.update({ speaking: false }, this.restingPhase(call))
    void voiceFetch('interrupt', { call: call.id!, through: String(call.lastSequence),
      ...(call.lastInput ? { input: call.lastInput } : {}), ...(reading ? { reading } : {}),
    }, { method: 'POST', signal: call.abort.signal }).catch(() => {})
  }

  private stopPlayback(call: LiveCall): void {
    const current = call.playback
    call.playback = undefined
    current?.abort.abort()
    call.player.stop()
  }

  private sendFrames(call: LiveCall, frames: Float32Array[]): void {
    if (this.call !== call) return
    call.recording = false
    const id = crypto.randomUUID()
    const audio = encodeVoiceWav(frames, call.context.sampleRate)
    call.framesPending++
    this.update({ error: undefined }, 'transcribing')
    call.utterances = call.utterances.then(async () => {
      if (call.abort.signal.aborted) return
      call.lastInput = id
      await voiceFetch('audio', { call: call.id!, request: id }, {
        method: 'POST', signal: call.abort.signal, headers: { 'content-type': 'audio/wav' }, body: audio,
      })
    }).catch(error => {
      if (this.call === call) this.update({ error: error instanceof Error ? error.message : '语音转写失败' })
    }).finally(() => {
      call.framesPending--
      if (this.call === call) {
        this.update({}, this.restingPhase(call))
        void this.speakNext(call)
      }
    })
  }

  async unmute(): Promise<void> {
    const call = this.call
    if (!call?.input || call.microphone || this.state.microphoneOpening) return
    const epoch = ++call.micEpoch
    this.update({ microphoneOpening: true, error: undefined })
    let stream: MediaStream | undefined
    try {
      if (!navigator.mediaDevices?.getUserMedia || !call.context.audioWorklet) throw new Error('当前浏览器不支持此页面的麦克风录音')
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (this.call !== call || call.micEpoch !== epoch) { stream.getTracks().forEach(track => track.stop()); return }
      call.openingStream = stream
      await loadMicWorklet(call)
      if (this.call !== call || call.micEpoch !== epoch) return
      const source = call.context.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(call.context, 'spirit-mic'), sink = call.context.createGain()
      sink.gain.value = 0
      const gate = new SpeechGate(() => this.bargeIn(call), frames => this.sendFrames(call, frames))
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (this.call === call && call.micEpoch === epoch) gate.frame(event.data, this.state.speaking)
      }
      source.connect(node); node.connect(sink); sink.connect(call.context.destination)
      call.microphone = { stream, source, node, sink }
      call.openingStream = undefined
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (this.call === call && call.micEpoch === epoch) { this.mute(); this.update({ error: '麦克风已断开' }) }
      }, { once: true })
      this.update({ listening: true, microphoneOpening: false, error: undefined }, this.restingPhase(call))
    } catch (error) {
      if (this.call === call && call.micEpoch === epoch) {
        call.openingStream = undefined
        stream?.getTracks().forEach(track => track.stop())
        const reason = error instanceof DOMException && error.name === 'NotAllowedError' ? '未获得麦克风权限' : '无法打开麦克风'
        this.update({ listening: false, microphoneOpening: false, error: reason }, this.restingPhase(call))
      }
    }
  }

  private releaseMic(call: LiveCall): void {
    call.micEpoch++
    call.recording = false
    call.openingStream?.getTracks().forEach(track => track.stop())
    call.openingStream = undefined
    const mic = call.microphone
    call.microphone = undefined
    if (!mic) return
    mic.node.port.onmessage = null
    mic.node.port.close()
    mic.source.disconnect(); mic.node.disconnect(); mic.sink.disconnect()
    mic.stream.getTracks().forEach(track => track.stop())
  }

  mute(): void {
    const call = this.call
    if (!call) return
    this.releaseMic(call)
    this.update({ listening: false, microphoneOpening: false, error: undefined }, this.restingPhase(call))
    void this.speakNext(call)
  }

  private sendHangup(call: LiveCall): void {
    if (call.id) void voiceFetch('hangup', { call: call.id }, { method: 'POST', keepalive: true }).catch(() => {})
  }

  hangup(reason?: string): void {
    const call = this.call
    if (!call) return
    this.call = undefined
    call.abort.abort()
    call.pending = []
    this.stopPlayback(call)
    this.releaseMic(call)
    this.sendHangup(call)
    void call.context.close().catch(() => {})
    this.update({ connected: false, listening: false, speaking: false, error: reason, outputError: undefined, outputLabel: undefined,
      microphoneAvailable: undefined, microphoneOpening: undefined }, reason ? 'disconnected' : 'idle')
  }
}

const micWorklets = new WeakMap<AudioContext, Promise<void>>()

async function registerMicWorklet(call: LiveCall): Promise<void> {
  const script = await (await voiceFetch('worklet.js', {}, { signal: call.abort.signal })).blob()
  const url = URL.createObjectURL(script)
  try { await call.context.audioWorklet.addModule(url) }
  finally { URL.revokeObjectURL(url) }
}

function loadMicWorklet(call: LiveCall): Promise<void> {
  let worklet = micWorklets.get(call.context)
  if (!worklet) {
    worklet = registerMicWorklet(call).catch(error => {
      micWorklets.delete(call.context)
      throw error
    })
    micWorklets.set(call.context, worklet)
  }
  return worklet
}

function VoiceSample({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    const element = audio.current
    return () => { if (element && !element.paused) element.pause() }
  }, [])
  const toggle = () => {
    const element = audio.current
    if (!element) return
    setError(false)
    if (element.paused) {
      element.currentTime = 0
      void element.play().catch(reason => { if (reason?.name !== 'AbortError') setError(true) })
    } else element.pause()
  }
  return <>
    <button type="button" onClick={toggle} aria-pressed={playing}>{playing ? '停止试听' : '试听小肥鱼声线'}</button>
    <audio ref={audio} preload="none" src={src}
      onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    {error && <span role="status">样音播放失败</span>}
  </>
}

function BreezeKeySetup({ missing, save, refresh }: {
  missing: boolean
  save(key: string): Promise<void>
  refresh(): Promise<void>
}) {
  const field = useRef<HTMLInputElement>(null)
  const saving = useRef(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  useEffect(() => { if (editing) field.current?.focus() }, [editing])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (saving.current || !field.current) return
    const key = field.current.value.trim()
    field.current.value = ''
    if (!key) { setFailure('请输入 Breeze API 密钥。'); return }
    saving.current = true
    setBusy(true)
    setFailure('')
    try {
      await save(key)
      await refresh()
      setEditing(false)
    } catch {
      setFailure('无法保存 Breeze 密钥，请重试。')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  if (!editing) return <button type="button" onClick={() => setEditing(true)}>{missing ? '配置 Breeze 密钥' : '更新 Breeze 密钥'}</button>
  return <form onSubmit={event => void submit(event)} aria-busy={busy}>
    <label>Breeze API 密钥 <input ref={field} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={busy} /></label>
    <button type="submit" disabled={busy}>{busy ? '正在保存' : '保存至 Harness'}</button>
    <button type="button" disabled={busy} onClick={() => { setFailure(''); setEditing(false) }}>取消</button>
    {failure && <span role="alert">{failure}</span>}
  </form>
}

export function VoiceCall({ active = true, optionsOpen = false, optionsId, onCallChange, saveBreezeKey }: {
  active?: boolean
  optionsOpen?: boolean
  optionsId?: string
  onCallChange?: (state: VoiceCallState) => void
  saveBreezeKey?: (key: string) => Promise<void>
}): React.JSX.Element {
  const [state, setState] = useState(initialState)
  const [transport] = useState(() => new VoiceTransport(setState))
  const [preference, setPreference] = useState(loadOutputPreference)
  const [systemVoice, setSystemVoice] = useState<SpeechSynthesisVoice>()
  useEffect(() => {
    const update = () => setSystemVoice(deviceVoice())
    const synth = window.speechSynthesis
    synth?.addEventListener('voiceschanged', update)
    window.addEventListener('focus', update)
    update()
    return () => {
      synth?.removeEventListener('voiceschanged', update)
      window.removeEventListener('focus', update)
    }
  }, [])
  useEffect(() => {
    if (!active) { transport.hangup(); return }
    const controller = new AbortController()
    void transport.check(controller.signal)
    return () => { controller.abort(); transport.hangup() }
  }, [active, transport])
  useEffect(() => {
    const hangup = () => transport.hangup()
    window.addEventListener('pagehide', hangup)
    return () => window.removeEventListener('pagehide', hangup)
  }, [transport])
  useEffect(() => { onCallChange?.(state) }, [onCallChange, state])
  const { availability, connected } = state
  const hostOutput = availability?.output ?? undefined
  const breeze = expectsBreeze(availability)
  const missingKey = availability?.setup?.kind === 'breeze-key'
  const selected = chooseOutput(preference, !!hostOutput, hostOutput, systemVoice, breeze)
  const transcriptionOnly = !selected && (preference === 'auto' || preference === 'input') && !!availability?.input
  const canConnect = active && !!availability?.active && (!!selected || transcriptionOnly)
  const sample = selected?.kind === 'host' && hostOutput?.provider !== 'breezeblue'
    && hostOutput?.location === 'host-local' && hostOutput.voice === 'xiaoyu'
    ? hostOutput.model === 'jingshen-light' ? 'xiaoyu-light-preview.mp3'
      : hostOutput.model === 'jingshen-character' ? 'xiaoyu-preview.mp3' : undefined
    : undefined
  const error = [state.outputError, state.error].filter(Boolean).join(' ')
  const idle = !connected && state.phase !== 'connecting' && active
  const showBreezeSetup = breeze && (idle || connected && !!state.outputError)
  const micOn = state.listening || state.microphoneOpening
  return <div className="spirit-voice">
    <p className="spirit-voice-status" data-error={!!error || undefined} role="status">
      {error || (!active ? '当前无法通话' : state.microphoneOpening && !state.speaking ? '正在打开麦克风' : state.label)}
    </p>
    <div className="spirit-voice-controls">
      {connected || state.phase === 'connecting'
        ? <>
          {connected && <>
            <button type="button" onClick={() => micOn ? transport.mute() : void transport.unmute()} disabled={!state.microphoneAvailable}
              data-mic-on={micOn || undefined}><MediaIcon name={micOn ? 'mic' : 'muted'} />{micOn ? '关麦' : '开麦'}</button>
            <button type="button" disabled={!state.speaking} onClick={() => transport.interrupt()}>
              <MediaIcon name="stop" />打断朗读</button>
          </>}
          <button type="button" data-action="hangup" onClick={() => transport.hangup()}><MediaIcon name="hangup" />挂断</button>
        </>
        : <button type="button" data-action="connect" disabled={!canConnect} onClick={() => void transport.connect(preference)}>
          <MediaIcon name="phone" />
          {transcriptionOnly ? '仅转写并开麦' : availability?.input ? '接通并开麦' : '接通语音'}
        </button>}
    </div>
    <section id={optionsId} className="spirit-voice-options" aria-label="语音选项" hidden={!optionsOpen}>
      <h2>语音选项</h2>
      {optionsOpen && <>
        {idle && <div className="spirit-voice-option-actions">
          <button type="button" onClick={() => { setSystemVoice(deviceVoice()); void transport.check() }}>检查语音</button>
          {sample && <VoiceSample key={sample} src={`/personal-spirit/assets/voice/${sample}`} />}
        </div>}
        {(idle || connected) && availability && <div className="spirit-voice-providers">
          <label>通话输出 <select value={preference} disabled={connected} onChange={event => {
            const value = event.target.value as OutputPreference
            setPreference(value)
            try { window.localStorage.setItem(preferenceKey, value) } catch { /* Preferences still apply to the current view. */ }
          }}>
            <option value="auto">自动选择</option>
            <option value="host" disabled={!hostOutput && preference !== 'host'}>宿主语音合成</option>
            <option value="system" disabled={!systemVoice && preference !== 'system'}>设备中文朗读</option>
            <option value="input" disabled={!availability.input && preference !== 'input'}>仅语音转写</option>
          </select></label>
          {idle && (selected ? <span>通话声线 · {outputLabel(selected)}</span>
            : <span>{transcriptionOnly ? '仅语音转写' : preference === 'system' ? '设备没有本机普通话声线'
              : missingKey ? 'BreezeBlue 朗读未配置' : preference === 'host' ? '宿主语音合成未配置' : '当前没有可用的通话语音'}</span>)}
          {idle && !systemVoice && preference !== 'system' && !breeze && <span>设备没有本机普通话声线</span>}
          {availability.input ? <span>转写 · {availability.input.name}（{availability.input.location === 'host-local' ? '宿主本机' : '远端服务'}）</span>
            : <span>未配置语音转写</span>}
        </div>}
        {showBreezeSetup && <div className="spirit-voice-setup">
          {missingKey ? <p>在 Harness 凭据中保存 <code>BREEZE_API_KEY</code>，再点「检查语音」。请勿把密钥发到聊天中。</p>
            : idle && selected?.kind === 'host' ? <p>BreezeBlue 接收要朗读的回复文字，并按用量计费。</p> : null}
          <a href={breezeKeys} target="_blank" rel="noopener noreferrer">BreezeBlue API 密钥</a>
          <a href={breezePreview} target="_blank" rel="noopener noreferrer">官方试听 · 大肥鱼（迷糊版）</a>
          {idle && saveBreezeKey && <BreezeKeySetup missing={missingKey} save={saveBreezeKey} refresh={() => transport.check()} />}
        </div>}
        {connected && <p className="spirit-voice-provider" role="status">{state.outputLabel}</p>}
      </>}
    </section>
  </div>
}
