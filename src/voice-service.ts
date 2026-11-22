import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { MAX_WAV_BYTES, RECORD_RATE, type VoiceAvailability, type VoiceDelivery, type VoiceEvent, type VoiceMessage } from './voice-protocol.ts'
import { VoiceProviderDiscovery, type VoiceProviders } from './voice-providers.ts'
import type { VoiceCut, VoiceSource } from './voice-native.ts'

export interface VoiceOptions {
  ctx: Context
  checkActive(): void
  submit(input: { requestId: string; text: string }, signal: AbortSignal, accepted: (id: string) => void): Promise<unknown>
  onPlaying?(message: VoiceMessage): () => void
  cutGeneration?(cut: VoiceCut): void
}
type PublishedMessage = VoiceMessage & { source?: VoiceSource }
type CallDelivery = VoiceDelivery & { source?: VoiceSource }
type Call = {
  id: string
  providers: VoiceProviders
  abort: AbortController
  attachBy: ReturnType<typeof setTimeout>
  receive?: (event: VoiceEvent) => void
  messages: Map<string, CallDelivery>
  inputs: Map<string, string>
  sequence: number
  discardedThrough: number
  playback?: { sequence: number; abort: AbortController }
  media?: { id: string; finish: () => void }
  transcription?: AbortSignal
}
const MAX_MESSAGES = 32

export function validateVoiceWav(audio: Uint8Array<ArrayBuffer>): void {
  const wave = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength)
  if (wave.length <= 44 || wave.length > MAX_WAV_BYTES || (wave.length - 44) % 2 !== 0
    || wave.toString('ascii', 0, 4) !== 'RIFF' || wave.toString('ascii', 8, 16) !== 'WAVEfmt '
    || wave.toString('ascii', 36, 40) !== 'data' || wave.readUInt32LE(4) !== wave.length - 8
    || wave.readUInt32LE(16) !== 16 || wave.readUInt16LE(20) !== 1 || wave.readUInt16LE(22) !== 1
    || wave.readUInt32LE(24) !== RECORD_RATE || wave.readUInt32LE(28) !== RECORD_RATE * 2
    || wave.readUInt16LE(32) !== 2 || wave.readUInt16LE(34) !== 16 || wave.readUInt32LE(40) !== wave.length - 44) {
    throw new Error('无法读取这段麦克风录音')
  }
}

function speechChunks(text: string): string[] {
  const chunks: string[] = []
  let pending = ''
  for (const sentence of text.match(/[^。！？；\n]+[。！？；\n]*|[。！？；\n]+/gu) ?? []) {
    // Start a first utterance quickly on CPU providers that cannot return a
    // partial sentence. Longer paragraphs remain intact once audio is flowing.
    if (!chunks.length && !pending && sentence.length <= 110) { chunks.push(sentence); continue }
    if (pending.length + sentence.length > 1000 && pending) { chunks.push(pending); pending = '' }
    if (sentence.length <= 1000) { pending += sentence; continue }
    const letters = [...sentence]
    for (let index = 0; index < letters.length; index += 750) chunks.push(letters.slice(index, index + 750).join(''))
  }
  if (pending) chunks.push(pending)
  return chunks
}

/** Voice belongs to the currently joined call and only observes committed delivery. */
export class VoiceService {
  private readonly calls = new Map<string, Call>()
  private readonly providers: VoiceProviderDiscovery
  private closed = false

  constructor(private readonly options: VoiceOptions) { this.providers = new VoiceProviderDiscovery(options.ctx) }

  async availability(): Promise<VoiceAvailability> {
    const providers = await this.providers.detect()
    let active = !this.closed
    try { this.options.checkActive() } catch { active = false }
    return { input: providers.input?.info ?? null, output: providers.output?.info ?? null, active }
  }

  private requireActive(): void {
    if (this.closed) throw new Error('语音已关闭')
    this.options.checkActive()
  }

  async open(): Promise<{ id: string; input: boolean; neural: boolean }> {
    this.requireActive()
    const providers = await this.providers.detect()
    this.requireActive()
    if (this.calls.size >= 3) throw new Error('通话连接已满，请先挂断其他窗口')
    const id = randomUUID()
    const attachBy = setTimeout(() => this.hangup(id, '连接已过期'), 15_000)
    attachBy.unref()
    this.calls.set(id, { id, providers, attachBy, messages: new Map(), inputs: new Map(), sequence: 0, discardedThrough: 0, abort: new AbortController() })
    return { id, input: !!providers.input, neural: !!providers.output }
  }

  private requireCall(id: string): Call {
    this.requireActive()
    const call = this.calls.get(id)
    if (!call) throw new Error('通话已结束，请重新接通')
    return call
  }

  attach(id: string, receive: (event: VoiceEvent) => void): () => void {
    const call = this.requireCall(id)
    if (call.receive) throw new Error('通话已经在另一窗口接通')
    clearTimeout(call.attachBy)
    call.receive = receive
    receive({ type: 'ready' })
    return () => this.hangup(id, '连接已断开')
  }

  delivered(message: PublishedMessage): void {
    if (!message.id || !message.text.trim()) return
    try { this.requireActive() } catch { return }
    for (const call of this.calls.values()) {
      if (!call.receive || call.messages.has(message.id)) continue
      const delivery = { id: message.id, text: message.text, tone: message.tone, sequence: ++call.sequence }
      call.messages.set(message.id, { ...delivery, source: message.source })
      const oldest = call.messages.keys().next()
      if (call.messages.size > MAX_MESSAGES && !oldest.done) call.messages.delete(oldest.value)
      try { call.receive({ type: 'speech', message: delivery }) }
      catch { this.hangup(call.id, '连接已断开') }
    }
  }

  async input(id: string, requestId: string, audio: Uint8Array<ArrayBuffer>, caller: AbortSignal): Promise<{ text: string }> {
    const call = this.requireCall(id)
    if (!call.receive || !call.providers.input) throw new Error('当前通话没有可用的语音转写')
    if (call.transcription) throw new Error('上一段语音仍在转写中')
    validateVoiceWav(audio)
    const signal = AbortSignal.any([call.abort.signal, caller])
    call.transcription = signal
    try {
      signal.throwIfAborted()
      const text = (await call.providers.input.transcribe(audio, signal)).trim()
      signal.throwIfAborted()
      this.requireActive()
      const transcript = text.slice(0, 8_000)
      if (transcript) await this.options.submit({ requestId: `voice:${requestId}`, text: transcript }, signal, messageId => {
        if (signal.aborted) return
        call.inputs.set(requestId, messageId)
        const oldest = call.inputs.keys().next()
        if (call.inputs.size > MAX_MESSAGES && !oldest.done) call.inputs.delete(oldest.value)
      })
      return { text: transcript }
    } finally { if (call.transcription === signal) call.transcription = undefined }
  }

  private message(call: Call, id: string): VoiceDelivery {
    const message = call.messages.get(id)
    if (!message || message.sequence <= call.discardedThrough) throw new Error('这条回复已离开通话播放队列')
    return message
  }

  async *speech(callId: string, messageId: string, caller: AbortSignal): AsyncIterable<Uint8Array> {
    const call = this.requireCall(callId)
    if (!call.receive || !call.providers.output) throw new Error('当前通话没有可用的神经语音')
    const message = this.message(call, messageId)
    call.playback?.abort.abort()
    const playback = { sequence: message.sequence, abort: new AbortController() }
    call.playback = playback
    const signal = AbortSignal.any([call.abort.signal, playback.abort.signal, caller])
    try {
      for (const text of speechChunks(message.text)) {
        signal.throwIfAborted()
        this.requireActive()
        const stream = await call.providers.output.stream({ ...message, text }, signal)
        const reader = stream.getReader()
        try {
          for (;;) {
            const chunk = await reader.read()
            signal.throwIfAborted()
            if (chunk.done) break
            yield chunk.value
          }
        } finally { void reader.cancel().catch(() => {}) }
      }
    } finally { if (call.playback === playback) call.playback = undefined }
  }

  playing(callId: string, messageId: string, playing: boolean): void {
    const call = this.requireCall(callId)
    if (!playing) {
      if (call.media?.id === messageId) this.finishMedia(call)
      return
    }
    const message = this.message(call, messageId)
    if (call.media?.id === messageId) return
    this.finishMedia(call)
    if (this.options.onPlaying) call.media = { id: messageId, finish: this.options.onPlaying(message) }
  }

  private finishMedia(call: Call): void {
    const media = call.media
    call.media = undefined
    media?.finish()
  }

  interrupt(id: string, through: number, lastInput?: string, reading?: string): void {
    const call = this.requireCall(id)
    call.discardedThrough = Math.max(call.discardedThrough, Math.min(through, call.sequence))
    if (call.playback && call.playback.sequence <= call.discardedThrough) call.playback.abort.abort()
    if (call.media && (call.messages.get(call.media.id)?.sequence ?? 0) <= call.discardedThrough) this.finishMedia(call)
    const ownerMessageId = lastInput === undefined ? undefined : call.inputs.get(lastInput)
    const spoken = reading === undefined ? undefined : call.messages.get(reading)
    const source = spoken && spoken.sequence <= through ? spoken.source : undefined
    if (ownerMessageId || source) this.options.cutGeneration?.({ ownerMessageId, reading: source })
  }

  hangup(id: string, reason = '通话已结束'): void {
    const call = this.calls.get(id)
    if (!call) return
    this.calls.delete(id)
    clearTimeout(call.attachBy)
    call.abort.abort()
    try { this.finishMedia(call) } finally { call.receive?.({ type: 'closed', reason }) }
  }

  pause(reason = '精神已暂停，通话已挂断'): void {
    for (const id of this.calls.keys()) this.hangup(id, reason)
  }

  close(): void {
    this.closed = true
    this.providers.close()
    this.pause('精神语音服务已关闭')
  }
}
