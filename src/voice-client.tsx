import { useEffect, useRef, useState } from 'react'
import { encodeVoiceWav, PcmPlayer, SpeechGate } from './voice-audio.ts'
import { deviceVoice, speakOnDevice } from './voice-device.ts'
import { PLAY_RATE, VOICE_PATH, type VoiceAvailability, type VoiceDelivery, type VoiceEvent } from './voice-protocol.ts'

type Phase = 'checking' | 'idle' | 'connecting' | 'listening' | 'muted' | 'speaking' | 'transcribing' | 'disconnected'
type OutputPreference = 'auto' | 'host' | 'system'
type HostOutput = NonNullable<VoiceAvailability['output']>
type CallOutput = { kind: 'host'; info?: HostOutput } | { kind: 'system'; voice: SpeechSynthesisVoice }
export interface VoiceCallState {
  connected: boolean
  listening: boolean
  speaking: boolean
  phase: Phase
  label: string
  error?: string
  availability?: VoiceAvailability
  outputLabel?: string
  microphoneAvailable?: boolean
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
  micEpoch: number
}

const labels: Record<Phase, string> = {
  checking: '正在检查语音连接', idle: '语音未接通', connecting: '正在接通语音',
  listening: '正在聆听', muted: '已关闭麦克风', speaking: '精神正在说话', transcribing: '正在转写',
  disconnected: '语音连接已断开',
}
const initialState: VoiceCallState = { connected: false, listening: false, speaking: false, phase: 'checking', label: labels.checking }
const preferenceKey = 'personal-spirit:voice-output'

function loadOutputPreference(): OutputPreference {
  try {
    const value = window.localStorage.getItem(preferenceKey)
    if (value === 'host' || value === 'system') return value
  } catch { /* Browsers may block storage in embedded views. */ }
  return 'auto'
}

function chooseOutput(preference: OutputPreference, neural: boolean, info?: HostOutput, voice?: SpeechSynthesisVoice): CallOutput | undefined {
  if (preference !== 'system' && neural) return { kind: 'host', info }
  if (preference !== 'host' && voice) return { kind: 'system', voice }
}

function outputLabel(output?: CallOutput): string {
  if (!output) return '仅语音转写'
  if (output.kind === 'system') return `设备中文朗读 · ${output.voice.name}`
  const { info } = output
  return info ? `${info.name}（${info.location === 'host-local' ? '宿主本机' : '远端服务'}）` : '宿主语音合成'
}

export async function voiceFetch(action: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('x-personal-spirit', '1')
  const query = new URLSearchParams(params).toString()
  const response = await fetch(`${VOICE_PATH}/${action}${query ? '?' + query : ''}`, { credentials: 'same-origin', ...init, headers })
  if (response.ok) return response
  const error = await response.json().catch(() => ({})) as { error?: string }
  throw new Error(error.error ?? '语音连接失败')
}

export class VoiceTransport {
  private state = initialState
  private call?: LiveCall

  constructor(private readonly changed: (state: VoiceCallState) => void) {}

  private update(update: Partial<VoiceCallState>, phase?: Phase): void {
    this.state = { ...this.state, ...update, ...(phase ? { phase, label: labels[phase] } : {}) }
    this.changed(this.state)
  }

  async check(signal?: AbortSignal): Promise<void> {
    try {
      const availability = await (await voiceFetch('status', {}, { signal })).json() as VoiceAvailability
      if (!signal?.aborted && !this.call) this.update({ availability, error: undefined }, 'idle')
    } catch (error) {
      if (!signal?.aborted && !this.call) this.update({ availability: undefined,
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
    this.update({ error: undefined }, 'connecting')
    try {
      await context.resume()
      const response = await voiceFetch('call', {}, { method: 'POST', signal: call.abort.signal })
      const opened = await response.json() as { id: string; input: boolean; neural: boolean; output?: VoiceAvailability['output'] }
      call.id = opened.id
      call.input = opened.input
      if (this.call !== call) { this.sendHangup(call); return }
      const info = opened.output === undefined ? this.state.availability?.output : opened.output
      call.output = chooseOutput(preference, opened.neural, info ?? undefined, deviceVoice())
      if (!call.output && (preference !== 'auto' || !opened.input)) throw new Error('所选通话声线当前不可用，请检查语音')
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
      this.update({ connected: true, microphoneAvailable: call.input, outputLabel: outputLabel(call.output) }, 'muted')
      if (call.input) void this.unmute()
    } else if (event.type === 'closed') {
      this.hangup(event.reason)
    } else if (event.type === 'speech') {
      call.lastSequence = Math.max(event.message.sequence, call.lastSequence)
      if (!call.output || call.recording || call.pending.length >= 8) return
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
    const start = () => {
      if (signal.aborted || this.call !== call || started) return
      started = true
      this.update({ speaking: true }, 'speaking')
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
        const voice = call.preference === 'auto' && call.output?.kind === 'host' ? deviceVoice() : undefined
        if (!started && voice) {
          call.output = { kind: 'system', voice }
          this.update({ outputLabel: outputLabel(call.output) })
          call.pending.unshift(message)
        } else this.update({ error: error instanceof Error ? error.message : '语音播放失败' })
      }
    } finally {
      if (started) this.media(call, message, 'end')
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
    const reading = call.playback?.message.id
    call.recording = true
    call.pending = []
    this.stopPlayback(call)
    this.update({ speaking: false }, 'listening')
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
      if (this.call === call) this.update({}, this.restingPhase(call))
    })
  }

  async unmute(): Promise<void> {
    const call = this.call
    if (!call?.input || call.microphone) return
    const epoch = ++call.micEpoch
    let stream: MediaStream | undefined
    try {
      if (!navigator.mediaDevices?.getUserMedia || !call.context.audioWorklet) throw new Error('当前浏览器不支持此页面的麦克风录音')
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (this.call !== call || call.micEpoch !== epoch) { stream.getTracks().forEach(track => track.stop()); return }
      if (!workletLoaded.has(call.context)) {
        const script = await (await voiceFetch('worklet.js', {}, { signal: call.abort.signal })).blob()
        const url = URL.createObjectURL(script)
        try { await call.context.audioWorklet.addModule(url); workletLoaded.add(call.context) }
        finally { URL.revokeObjectURL(url) }
      }
      if (this.call !== call || call.micEpoch !== epoch) { stream.getTracks().forEach(track => track.stop()); return }
      const source = call.context.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(call.context, 'spirit-mic'), sink = call.context.createGain()
      sink.gain.value = 0
      const gate = new SpeechGate(() => this.bargeIn(call), frames => this.sendFrames(call, frames))
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (this.call === call && call.micEpoch === epoch) gate.frame(event.data, this.state.speaking)
      }
      source.connect(node); node.connect(sink); sink.connect(call.context.destination)
      call.microphone = { stream, source, node, sink }
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (this.call === call && call.micEpoch === epoch) { this.mute(); this.update({ error: '麦克风已断开' }) }
      }, { once: true })
      this.update({ listening: true, error: undefined }, this.restingPhase(call))
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop())
      if (this.call === call && call.micEpoch === epoch) this.update({ listening: false, error: error instanceof DOMException && error.name === 'NotAllowedError'
        ? '未获得麦克风权限，仍可听语音' : '无法打开麦克风，仍可听语音' }, this.restingPhase(call))
    }
  }

  private releaseMic(call: LiveCall): void {
    call.micEpoch++
    call.recording = false
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
    this.update({ listening: false }, this.restingPhase(call))
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
    this.update({ connected: false, listening: false, speaking: false, error: reason, outputLabel: undefined,
      microphoneAvailable: undefined }, reason ? 'disconnected' : 'idle')
  }
}

const workletLoaded = new WeakSet<AudioContext>()

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

export function VoiceCall({ active = true, onCallChange }: {
  active?: boolean
  onCallChange?: (state: VoiceCallState) => void
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
  useEffect(() => { onCallChange?.(state) }, [onCallChange, state])
  const { availability, connected } = state
  const hostOutput = availability?.output ?? undefined
  const selected = chooseOutput(preference, !!hostOutput, hostOutput, systemVoice)
  const canConnect = active && !!availability?.active && (!!selected || preference === 'auto' && !!availability.input)
  const sample = selected?.kind === 'host' && hostOutput?.voice === 'xiaoyu'
    ? hostOutput.model === 'jingshen-light' ? 'xiaoyu-light-preview.mp3'
      : hostOutput.model === 'jingshen-character' ? 'xiaoyu-preview.mp3' : undefined
    : undefined
  return <div className="spirit-voice">
    <div className="spirit-voice-controls">
      {connected || state.phase === 'connecting'
        ? <>
          {connected && <button type="button" onClick={() => state.listening ? transport.mute() : void transport.unmute()} disabled={!state.microphoneAvailable}
            aria-pressed={state.listening}>{state.listening ? '关麦' : '开麦'}</button>}
          <button type="button" onClick={() => transport.hangup()}>挂断</button>
        </>
        : <button type="button" disabled={!canConnect} onClick={() => void transport.connect(preference)}>{availability?.input ? '接通并开麦' : '接通语音'}</button>}
      {!connected && state.phase !== 'connecting' && active && <>
        <button type="button" onClick={() => { setSystemVoice(deviceVoice()); void transport.check() }}>检查语音</button>
        {sample && <VoiceSample key={sample} src={`/personal-spirit/assets/voice/${sample}`} />}
      </>}
    </div>
    <p className="spirit-voice-status" data-error={!!state.error || undefined} role="status">{state.error ?? state.label}</p>
    {!connected && state.phase !== 'connecting' && availability && active && <div className="spirit-voice-providers">
      <label>通话输出 <select value={preference} onChange={event => {
        const value = event.target.value as OutputPreference
        setPreference(value)
        try { window.localStorage.setItem(preferenceKey, value) } catch { /* Preferences still apply to the current view. */ }
      }}>
        <option value="auto">自动选择</option>
        <option value="host" disabled={!hostOutput && preference !== 'host'}>宿主语音合成</option>
        <option value="system" disabled={!systemVoice && preference !== 'system'}>设备中文朗读</option>
      </select></label>
      {selected ? <span>通话声线 · {outputLabel(selected)}</span>
        : <span>{preference === 'system' ? '设备没有本机普通话声线' : preference === 'host' ? '宿主语音合成未配置'
          : availability.input ? '通话可转写，当前没有朗读声线' : '当前没有可用的通话语音'}</span>}
      {!systemVoice && preference !== 'system' && <span>设备没有本机普通话声线</span>}
      {availability.input ? <span>转写 · {availability.input.name}（{availability.input.location === 'host-local' ? '宿主本机' : '远端服务'}）</span>
        : <span>未配置语音转写</span>}
    </div>}
    {connected && <span className="spirit-voice-provider" role="status">{state.outputLabel}</span>}
  </div>
}
