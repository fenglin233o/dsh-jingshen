import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_VOICE_MODEL, MAX_WAV_BYTES, RECORD_RATE, type VoiceAvailability, type VoiceDelivery, type VoiceEvent, type VoiceMessage } from './voice-protocol.ts'
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
type CallDelivery = VoiceDelivery & { source?: VoiceSource; breezeRequested?: boolean }
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

function speechChunks(text: string, limit: number): string[] {
  const chunks: string[] = []
  let pending = ''
  for (const sentence of text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*|[。！？!?；;\n]+/gu) ?? []) {
    if (pending.length + sentence.length > limit && pending) { chunks.push(pending); pending = '' }
    if (sentence.length <= limit) {
      pending += sentence
      // Keep a brief interjection with the thought that follows. Start playback after the first spoken phrase.
      if (!chunks.length && pending.length <= 110 && pending.replace(/[^\p{L}\p{N}]/gu, '').length >= 3) {
        chunks.push(pending)
        pending = ''
      }
      continue
    }
    const letters = [...sentence]
    const stride = Math.min(750, limit)
    for (let index = 0; index < letters.length;) {
      let end = Math.min(index + stride, letters.length)
      if (end < letters.length) {
        for (let cut = end; cut > index + stride / 2; cut--) {
          if (/[，,、\s]/u.test(letters[cut - 1]!)) { end = cut; break }
        }
      }
      chunks.push(letters.slice(index, end).join(''))
      index = end
    }
  }
  if (pending) chunks.push(pending)
  return chunks
}

function* breezeChunks(text: string): Iterable<string> {
  const characters = Array.from(text)
  const limit = 1000
  for (let start = 0; start < characters.length;) {
    let end = Math.min(characters.length, start + limit)
    if (end < characters.length) {
      // Prefer a whole sentence near the limit. The provider streams even a single request.
      let sentenceEnd: number | undefined
      let clauseEnd: number | undefined
      for (let position = end; position > start + limit / 2; position--) {
        const previous = characters[position - 1]!
        if (/[。！？!?；;\r\n]/u.test(previous) || (previous === '.' && /\s/u.test(characters[position]!))) {
          sentenceEnd = position
          break
        }
        if (clauseEnd === undefined && /[，,、\s]/u.test(previous)) clauseEnd = position
      }
      end = sentenceEnd ?? clauseEnd ?? end
    }
    const chunk = characters.slice(start, end).join('')
    if (chunk.trim()) yield chunk
    start = end
  }
}

const mandarinWords = new Intl.Segmenter('zh', { granularity: 'word' })
const primeSpeech = /[\p{Script=Han}a-z0-9]/iu
const primeSpeechCharacters = /[\p{Script=Han}a-z0-9]/giu
const primeSentenceEnd = /[。！？!?；;….\r\n]/u
const primePunctuation = /[。！？!?；;….\r\n，、,:：]+[）】》」』”’"')\]]*[ \t]*/gu
const joinedLatinText = /https?:\/\/[a-z0-9][a-z0-9./_~%?#@!$&'()*+=:;-]*[a-z0-9/#]|(?:[a-z]\.){2,}(?![a-z0-9])|[a-z0-9]+(?:(?:[.@:/_+'’-]|(?<=\d),(?=\d{3}(?:\D|$)))[a-z0-9]+)*/giu
const mandarinNumber = /^[零〇一二两三四五六七八九十百千万亿]+$/u

function* primeChunks(text: string): Iterable<string> {
  // Keep email addresses, versions, numbers, and dotted abbreviations intact at a synthesis boundary.
  const joined = new Set<number>()
  for (const match of text.matchAll(joinedLatinText)) {
    for (let i = match.index + 1; i < match.index + match[0].length; i++) joined.add(i)
  }

  const boundaries = new Map<number, 'word' | 'clause' | 'sentence'>()
  for (const { segment, index, isWordLike } of mandarinWords.segment(text)) {
    const end = index + segment.length
    if (!isWordLike || joined.has(end)) continue
    // The dictionary may separate a numeral from its classifier (for example, 一小段).
    if (mandarinNumber.test(segment) && /^\p{Script=Han}/u.test(text.slice(end, end + 2))) continue
    boundaries.set(end, 'word')
  }
  for (const match of text.matchAll(primePunctuation)) {
    const end = match.index + match[0].length
    if (!joined.has(match.index) && !joined.has(end)) {
      boundaries.set(end, primeSentenceEnd.test(match[0]) ? 'sentence' : 'clause')
    }
  }
  const ordered = [...boundaries].sort(([a], [b]) => a - b)
  const maximum = 256 // LocalSpeech bounds each individual inference by UTF-16 length.
  let index = 0
  let spoken = 0
  let previousLength = 0
  for (let start = 0; start < text.length;) {
    while (ordered[index] && ordered[index]![0] <= start) index++
    const first = spoken === 0
    // Give synthesis time to get ahead of playback before sending longer spans.
    const budget = first ? 24 : spoken === 1 ? Math.min(21, Math.max(9, previousLength + 5))
      : spoken === 2 ? Math.min(32, Math.max(20, previousLength + 12)) : 52
    const limit = start + budget
    const naturalFloor = start + Math.ceil(budget * 0.6)
    let end = Math.min(limit, text.length)
    let cursor = index
    let word: number | undefined
    let natural: number | undefined
    for (; ordered[cursor] && ordered[cursor]![0] <= limit; cursor++) {
      const [position, kind] = ordered[cursor]!
      if (first) {
        // A brief interjection should travel with the words that follow it.
        const count = text.slice(start, position).normalize('NFKC').match(primeSpeechCharacters)?.length ?? 0
        if (count < 3) continue
        if (kind === 'sentence') {
          natural = position
          break
        }
        if (kind === 'clause' && position >= start + 8 && !natural) natural = position
        if (position <= start + 18 || word === undefined) word = position
      } else {
        if (kind !== 'word' && position >= naturalFloor) natural = position
        word = position
      }
    }
    if (first && natural !== undefined) end = natural
    else if (end < text.length) {
      const next = ordered[cursor]?.[0] ?? text.length
      end = natural ?? word ?? (next <= start + maximum ? next : end)
      // Pathological unbroken tokens still need a bounded request. Keep a surrogate pair together.
      if (/[\uDC00-\uDFFF]/u.test(text[end] ?? '')) end--
    }
    if (text.length <= start + maximum && !primeSpeech.test(text.slice(end).normalize('NFKC'))) end = text.length
    const phrase = text.slice(start, end)
    start = end
    const pronounceable = phrase.normalize('NFKC').match(primeSpeechCharacters)?.length ?? 0
    if (pronounceable) {
      yield phrase
      previousLength = pronounceable
      spoken++
    }
  }
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
    return { input: providers.input?.info ?? null, output: providers.output?.info ?? null, active,
      ...(providers.setup && { setup: providers.setup }) }
  }

  private requireActive(): void {
    if (this.closed) throw new Error('语音已关闭')
    this.options.checkActive()
  }

  async open(): Promise<{ id: string; input: boolean; neural: boolean; output: VoiceAvailability['output']; setup?: VoiceAvailability['setup'] }> {
    this.requireActive()
    const providers = await this.providers.detect()
    this.requireActive()
    if (this.calls.size >= 3) throw new Error('通话连接已满，请先挂断其他窗口')
    const id = randomUUID()
    const attachBy = setTimeout(() => this.hangup(id, '连接已过期'), 15_000)
    attachBy.unref()
    this.calls.set(id, { id, providers, attachBy, messages: new Map(), inputs: new Map(), sequence: 0, discardedThrough: 0, abort: new AbortController() })
    return { id, input: !!providers.input, neural: !!providers.output, output: providers.output?.info ?? null,
      ...(providers.setup && { setup: providers.setup }) }
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

  private message(call: Call, id: string): CallDelivery {
    const message = call.messages.get(id)
    if (!message || message.sequence <= call.discardedThrough) throw new Error('这条回复已离开通话播放队列')
    return message
  }

  async *speech(callId: string, messageId: string, caller: AbortSignal): AsyncIterable<Uint8Array> {
    const call = this.requireCall(callId)
    if (!call.receive || !call.providers.output) throw new Error('当前通话没有可用的神经语音')
    caller.throwIfAborted()
    const message = this.message(call, messageId)
    const { info } = call.providers.output
    if (info.provider === 'breezeblue') {
      // Claim before touching any existing playback. Concurrent reads must issue only one billable request.
      if (message.breezeRequested) throw new Error('本次通话已经请求过这条回复的语音')
      message.breezeRequested = true
    }
    call.playback?.abort.abort()
    const playback = { sequence: message.sequence, abort: new AbortController() }
    call.playback = playback
    const signal = AbortSignal.any([call.abort.signal, playback.abort.signal, caller])
    try {
      const chunks = info.provider === 'breezeblue' ? breezeChunks(message.text)
        : info.model === BUNDLED_VOICE_MODEL ? primeChunks(message.text)
          : speechChunks(message.text, info.model === 'jingshen-character' ? 80 : 1000)
      for (const text of chunks) {
        signal.throwIfAborted()
        this.requireActive()
        const stream = await call.providers.output.stream({ id: message.id, text, tone: message.tone }, signal)
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
    } finally {
      playback.abort.abort()
      if (call.playback === playback) call.playback = undefined
    }
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
