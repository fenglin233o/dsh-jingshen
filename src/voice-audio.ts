import { MAX_UTTERANCE_SECONDS, PLAY_RATE, RECORD_RATE } from './voice-protocol.ts'

/** Keep a short pre-roll so the onset detector does not clip the first word. */
export class SpeechGate {
  private head: Float32Array[] = []
  private utterance: Float32Array[] | null = null
  private consecutive = 0
  private quiet = 0
  private floor = 0.004

  constructor(private readonly begin: () => void, private readonly complete: (frames: Float32Array[]) => void) {}

  frame(frame: Float32Array, playback: boolean): void {
    let sum = 0
    for (const sample of frame) sum += sample * sample
    const energy = Math.sqrt(sum / frame.length)
    const audible = energy > Math.max(playback ? 0.018 : 0.011, this.floor * 3)
    if (!audible && !this.utterance) this.floor = this.floor * 0.96 + energy * 0.04
    if (!this.utterance) {
      this.head.push(frame)
      if (this.head.length > 8) this.head.shift()
      this.consecutive = audible ? this.consecutive + 1 : 0
      if (this.consecutive < 3) return
      this.utterance = this.head
      this.head = []
      this.quiet = 0
      this.begin()
      return
    }
    this.utterance.push(frame)
    this.quiet = audible ? 0 : this.quiet + 1
    if (this.quiet < 27 && this.utterance.length < MAX_UTTERANCE_SECONDS * 50) return
    const utterance = this.utterance
    this.utterance = null
    this.consecutive = 0
    this.complete(utterance)
  }
}

export function encodeVoiceWav(frames: Float32Array[], rate: number): ArrayBuffer {
  const total = frames.reduce((length, frame) => length + frame.length, 0)
  const source = new Float32Array(total)
  let index = 0
  for (const frame of frames) { source.set(frame, index); index += frame.length }
  const count = Math.min(RECORD_RATE * MAX_UTTERANCE_SECONDS, Math.floor(total * RECORD_RATE / rate))
  const wav = new ArrayBuffer(44 + count * 2), output = new DataView(wav)
  const fourcc = (at: number, value: string) => [...value].forEach((char, i) => output.setUint8(at + i, char.charCodeAt(0)))
  fourcc(0, 'RIFF'); output.setUint32(4, wav.byteLength - 8, true)
  fourcc(8, 'WAVE'); fourcc(12, 'fmt '); output.setUint32(16, 16, true)
  output.setUint16(20, 1, true); output.setUint16(22, 1, true)
  output.setUint32(24, RECORD_RATE, true); output.setUint32(28, RECORD_RATE * 2, true)
  output.setUint16(32, 2, true); output.setUint16(34, 16, true)
  fourcc(36, 'data'); output.setUint32(40, count * 2, true)
  const ratio = rate / RECORD_RATE
  for (let sample = 0; sample < count; sample++) {
    const start = Math.floor(sample * ratio), end = Math.max(start + 1, Math.floor((sample + 1) * ratio))
    let value = 0
    for (let i = start; i < end; i++) value += source[i] ?? 0
    output.setInt16(44 + sample * 2, Math.min(1, Math.max(-1, value / (end - start))) * 32767, true)
  }
  return wav
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Schedule small PCM blocks on the hardware clock and discard them on barge-in. */
export class PcmPlayer {
  private readonly sources = new Set<AudioBufferSourceNode>()
  private end = 0

  constructor(private readonly context: AudioContext) {}

  stop(): void {
    for (const source of this.sources) {
      source.onended = null
      source.stop()
      source.disconnect()
    }
    this.sources.clear()
    this.end = 0
  }

  private queue(bytes: Uint8Array, offsetBytes: number, playBytes: number): void {
    const block = this.context.createBuffer(1, bytes.byteLength / 2, PLAY_RATE)
    const samples = block.getChannelData(0), pcm = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let index = 0; index < samples.length; index++) samples[index] = pcm.getInt16(index * 2, true) / 32768
    const source = this.context.createBufferSource()
    source.buffer = block
    source.connect(this.context.destination)
    const at = Math.max(this.end, this.context.currentTime + 0.045)
    const duration = playBytes / (2 * PLAY_RATE)
    source.start(at, offsetBytes / (2 * PLAY_RATE), duration)
    this.end = at + duration
    this.sources.add(source)
    source.onended = () => { this.sources.delete(source); source.disconnect() }
  }

  async stream(body: ReadableStream<Uint8Array>, signal: AbortSignal, started: () => void): Promise<void> {
    const reader = body.getReader()
    const chunkBytes = PLAY_RATE / 10 * 2
    // Give the browser adjacent input samples when it resamples each block.
    // Play only the middle so the context never appears twice in the output.
    const contextBytes = this.context.sampleRate === PLAY_RATE ? 0 : 64
    const lookaheadBytes = contextBytes ? 2 : 0
    let carry = new Uint8Array(0), first = true
    let history: Uint8Array = new Uint8Array(0)
    const emit = (samples: Uint8Array, following?: Uint8Array): void => {
      if (contextBytes) {
        const block = new Uint8Array(history.length + samples.length + (following?.length ?? 0))
        block.set(history)
        block.set(samples, history.length)
        if (following?.length) block.set(following, history.length + samples.length)
        this.queue(block, history.length, samples.length)
        history = samples.slice(-contextBytes)
      } else this.queue(samples, 0, samples.length)
      if (first) { first = false; started() }
    }
    try {
      for (;;) {
        const next = await reader.read()
        signal.throwIfAborted()
        if (next.done) break
        const bytes = new Uint8Array(carry.length + next.value.length)
        bytes.set(carry); bytes.set(next.value, carry.length)
        let index = 0
        const pairedBytes = bytes.length - (bytes.length & 1)
        for (; index + chunkBytes + lookaheadBytes <= pairedBytes; index += chunkBytes) {
          while (this.end - this.context.currentTime > 1.5) await wait(55, signal)
          signal.throwIfAborted()
          const end = index + chunkBytes
          emit(bytes.subarray(index, end), bytes.subarray(end, Math.min(end + contextBytes, pairedBytes)))
        }
        carry = bytes.slice(index)
      }
      if (carry.byteLength & 1) throw new Error('语音片段不完整')
      if (carry.length) emit(carry)
      while (this.end > this.context.currentTime) await wait(35, signal)
    } finally { void reader.cancel().catch(() => {}) }
  }
}
