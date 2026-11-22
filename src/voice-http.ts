import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_WAV_BYTES, PLAY_RATE, VOICE_PATH, type VoiceEvent } from './voice-protocol.ts'
import type { VoiceService } from './voice-service.ts'

// The browser loads this as an AudioWorklet after an explicit microphone
// action. Forward mono blocks without copying them on the main thread.
const worklet = `class SpiritMic extends AudioWorkletProcessor {
  constructor() {
    super()
    this.window = new Float32Array(Math.round(sampleRate * 0.02))
    this.offset = 0
  }
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    let start = 0
    while (start < channel.length) {
      const count = Math.min(channel.length - start, this.window.length - this.offset)
      this.window.set(channel.subarray(start, start + count), this.offset)
      this.offset += count
      start += count
      if (this.offset === this.window.length) {
        this.port.postMessage(this.window, [this.window.buffer])
        this.window = new Float32Array(Math.round(sampleRate * 0.02))
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('spirit-mic', SpiritMic)`

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(data))
}

function events(voice: VoiceService, res: ServerResponse, id: string): void {
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  const write = (event: VoiceEvent): void => {
    if (res.writableEnded || res.destroyed) return
    if (!res.write(JSON.stringify(event) + '\n') && res.writableLength > 256_000) res.destroy()
    if (event.type === 'closed') res.end()
  }
  const detach = voice.attach(id, write)
  const heartbeat = setInterval(() => write({ type: 'heartbeat' }), 8_000)
  heartbeat.unref()
  res.once('close', () => { clearInterval(heartbeat); detach() })
}

async function readAudio(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer>> {
  if (req.headers['content-type'] !== 'audio/wav') throw new Error('只接受 PCM WAV 麦克风录音')
  const pieces: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_WAV_BYTES) throw new Error('这段录音过长')
    pieces.push(bytes)
  }
  return new Uint8Array(Buffer.concat(pieces))
}

function key(url: URL, name: string, limit = 128): string {
  const value = url.searchParams.get(name)
  if (!value || value.length > limit || /[\x00-\x1f\x7f]/u.test(value)) throw new Error('语音请求参数无效')
  return value
}

/** Mounted under the existing Spirit owner's same-origin authenticated HTTP handler. */
export async function handleVoiceHttp(voice: VoiceService, req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith(VOICE_PATH + '/')) return false
  const action = `${req.method} ${path.slice(VOICE_PATH.length + 1)}`
  const url = new URL(req.url ?? '/', 'http://localhost')
  const caller = new AbortController()
  const close = () => caller.abort()
  res.once('close', close)
  try {
    if (action === 'GET status') json(res, 200, await voice.availability())
    else if (action === 'POST call') json(res, 201, await voice.open())
    else if (action === 'GET worklet.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      res.end(worklet)
    } else if (action === 'GET events') events(voice, res, key(url, 'call'))
    else if (action === 'POST audio') {
      const id = key(url, 'call'), requestId = key(url, 'request')
      json(res, 200, await voice.input(id, requestId, await readAudio(req), caller.signal))
    } else if (action === 'GET speech') {
      const stream = voice.speech(key(url, 'call'), key(url, 'message'), caller.signal)
      for await (const chunk of stream) {
        if (!res.headersSent) {
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-spirit-pcm-rate': String(PLAY_RATE), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        }
        if (!res.write(chunk)) await once(res, 'drain', { signal: caller.signal })
      }
      if (!res.headersSent) throw new Error('语音合成服务没有返回声音')
      res.end()
    } else if (action === 'POST playing') {
      const state = key(url, 'state')
      if (state !== 'start' && state !== 'end') throw new Error('播放状态无效')
      voice.playing(key(url, 'call'), key(url, 'message'), state === 'start')
      json(res, 200, { ok: true })
    } else if (action === 'POST interrupt') {
      const through = Number(key(url, 'through'))
      if (!Number.isSafeInteger(through) || through < 0) throw new Error('语音位置无效')
      voice.interrupt(key(url, 'call'), through, url.searchParams.has('input') ? key(url, 'input') : undefined,
        url.searchParams.has('reading') ? key(url, 'reading') : undefined)
      json(res, 200, { ok: true })
    } else if (action === 'POST hangup') {
      voice.hangup(key(url, 'call'))
      json(res, 200, { ok: true })
    } else json(res, 404, { error: '语音接口不存在' })
  } catch (error) {
    if (caller.signal.aborted || res.destroyed) return true
    if (res.headersSent) res.destroy()
    else json(res, 400, { error: error instanceof Error ? error.message : '语音请求失败' })
  } finally {
    if (action !== 'GET events' || res.writableEnded) res.removeListener('close', close)
  }
  return true
}
