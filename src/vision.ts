import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { sameOrigin } from './http.ts'
import { detectorWorker } from './vision-worker.ts'
import { permittedVideoUrl, videoHost } from './vision-url.ts'

const path = '/personal-spirit/api/vision'
const freshMs = 4000
const leaseMs = 10_000
const watchLimitMs = 5 * 60_000
const maxImageBody = 1_400_000
const mediaPipe = createRequire(import.meta.url)
const sdkAssets = new Map([
  ['vision_bundle.mjs', 'text/javascript'],
  ['wasm/vision_wasm_internal.js', 'text/javascript'],
  ['wasm/vision_wasm_nosimd_internal.js', 'text/javascript'],
  ['wasm/vision_wasm_internal.wasm', 'application/wasm'],
  ['wasm/vision_wasm_nosimd_internal.wasm', 'application/wasm'],
])
const sourceInput = z.enum(['camera', 'screen', 'video-tab', 'tab-video', 'video', 'video-library'])
const uuid = z.uuid()
const startInput = z.object({ source: sourceInput, allowedHost: z.string().max(253).optional() }).strict()
const tokenInput = z.object({ token: uuid }).strict()
const frameInput = tokenInput.extend({
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  capturedAt: z.number().int().positive(),
  detections: z.array(z.object({
    label: z.string().regex(/^[a-zA-Z0-9_ -]{1,40}$/),
    confidence: z.number().min(0).max(1),
    box: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
  }).strict()).max(8),
  mediaTime: z.number().nonnegative().finite().optional(),
  commandId: uuid.optional(),
}).strict()
const imageInput = tokenInput.extend({ requestId: uuid, capturedAt: z.number().int(),
  data: z.string().min(32).max(1_350_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict()
const watchInput = z.object({ action: z.enum(['select', 'play', 'stop', 'status']), url: z.string().max(1800).optional() }).strict()
const readVisionInput = z.object({ afterSeq: z.number().int().nonnegative().optional(),
  waitMs: z.number().int().min(0).max(6500).optional() }).strict()
type Frame = Omit<z.infer<typeof frameInput>, 'token'>
type Source = z.infer<typeof sourceInput>
type WatchCommand = { id: string; action: 'play' | 'stop'; expires: number; url?: string }
type Capture = {
  token: string; source: Source; expires: number; frames: Frame[]; command?: WatchCommand; playingUntil?: number
  library?: { host: string; selected?: string }
  playbackError?: 'media-unavailable'
  sentImages: string[]
}
type VisionSnapshot = {
  active: boolean; source?: Source; watching: boolean; authorizedVideo: boolean; reading?: Frame; recent?: Frame[]
  library?: { host: string; selected?: string }
  playbackError?: 'media-unavailable'
}
const isPlayer = (source: Source) => source === 'video' || source === 'tab-video' || source === 'video-library'

/** Browser opt-in owns one expiring capture. Only a small set of derived facts crosses to the host. */
export class LiveVision {
  private capture?: Capture

  constructor(private readonly active: () => boolean, private readonly now = Date.now) {}

  private current(): Capture | undefined {
    if (!this.active() || (this.capture && this.capture.expires <= this.now())) this.stop()
    return this.capture
  }

  private require(token: string): Capture {
    const capture = this.current()
    if (!capture || capture.token !== token) throw new Error('视觉授权已结束，请重新开启。')
    return capture
  }

  start(source: Source, allowedHost?: string): string {
    if (!this.active()) throw new Error('精神已暂停，无法开始视觉共享。')
    if (this.current()) throw new Error('已有视觉共享，请先结束当前共享。')
    if ((source === 'video-library') !== (typeof allowedHost === 'string')) throw new Error('视频来源授权无效。')
    const library = allowedHost === undefined ? undefined : { host: videoHost(allowedHost) }
    const token = randomUUID()
    this.capture = { token, source, expires: this.now() + leaseMs, frames: [], sentImages: [], library }
    return token
  }

  stop(token?: string): void {
    if (!token || this.capture?.token === token) this.capture = undefined
  }

  poll(token: string) {
    const capture = this.require(token)
    if (isPlayer(capture.source)) capture.expires = this.now() + leaseMs
    return { command: capture.command, watching: this.snapshot().watching }
  }

  private recent(capturedAt: number): boolean {
    const age = this.now() - capturedAt
    return age >= -800 && age <= freshMs
  }

  assertFrame(token: string, capturedAt: number): void {
    this.require(token)
    if (!this.recent(capturedAt)) throw new Error('当前画面已经过时，请重新发送。')
  }

  sentImage(token: string, id: string): boolean {
    return this.require(token).sentImages.includes(id)
  }

  recordImage(token: string, id: string): void {
    const capture = this.require(token)
    capture.sentImages.push(id)
    if (capture.sentImages.length > 32) capture.sentImages.shift()
  }

  frame({ token, ...frame }: z.infer<typeof frameInput>): boolean {
    const capture = this.require(token)
    const previous = capture.frames.at(-1)
    if (!this.recent(frame.capturedAt) || previous && (frame.seq <= previous.seq || frame.capturedAt < previous.capturedAt)) return false
    if (isPlayer(capture.source) && (capture.source !== 'tab-video' || frame.mediaTime !== undefined)) {
      if (capture.command?.action !== 'play' || capture.command.id !== frame.commandId
        || capture.command.expires <= this.now() || frame.mediaTime === undefined) return false
      if (previous?.mediaTime !== undefined && frame.mediaTime > previous.mediaTime) capture.playingUntil = this.now() + freshMs
    }
    capture.expires = this.now() + leaseMs
    capture.frames.push(frame)
    capture.frames = capture.frames.filter(item => this.recent(item.capturedAt)).slice(-4)
    return true
  }

  watch(action: z.infer<typeof watchInput>['action'], url?: string) {
    if (url !== undefined && action !== 'select' && action !== 'play') throw new Error('只有选片和播放可以指定视频地址。')
    if (action === 'status') return this.snapshot()
    const capture = this.current()
    if (!capture || !isPlayer(capture.source)) throw new Error('请先在同一面板明确授权精神观看视频。')
    if (action === 'select' || url !== undefined) {
      if (!capture.library || !url) throw new Error('只可在本人授权的视频来源内选片。')
      capture.library.selected = permittedVideoUrl(url, capture.library.host)
    }
    if (action === 'play' && capture.library && !capture.library.selected) throw new Error('请先从授权域名选择视频。')
    capture.frames = []
    capture.playingUntil = undefined
    capture.playbackError = undefined
    capture.command = { id: randomUUID(), action: action === 'select' ? 'stop' : action, expires: this.now() + watchLimitMs,
      ...(action === 'play' && capture.library?.selected ? { url: capture.library.selected } : {}) }
    return { requested: action, watching: false }
  }

  playbackEnded(token: string, commandId: string, failed = false): void {
    const capture = this.require(token)
    if (!isPlayer(capture.source) || capture.command?.id !== commandId) return
    capture.command = undefined
    capture.playingUntil = undefined
    capture.frames = []
    capture.playbackError = failed ? 'media-unavailable' : undefined
  }

  snapshot(): VisionSnapshot {
    const capture = this.current()
    if (!capture) return { active: false, watching: false, authorizedVideo: false }
    const fresh = capture.frames.filter(frame => this.recent(frame.capturedAt))
    return { active: true, source: capture.source, authorizedVideo: isPlayer(capture.source),
      watching: !!capture.playingUntil && capture.playingUntil > this.now() && capture.command?.action === 'play'
        && capture.command.expires > this.now(),
      ...(capture.library ? { library: { ...capture.library } } : {}),
      ...(capture.playbackError ? { playbackError: capture.playbackError } : {}),
      ...(fresh.length ? { reading: fresh.at(-1), recent: fresh } : {}) }
  }
}

async function readInput(req: IncomingMessage, limit = 12_000): Promise<unknown> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) throw new Error('视觉请求过大。')
  const parts: Buffer[] = []
  let size = 0
  for await (const part of req) {
    const chunk = Buffer.from(part)
    size += chunk.length
    if (size > limit) throw new Error('视觉请求过大。')
    parts.push(chunk)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown
}

export function registerVision(ctx: Context, options: {
  mainId: string
  active: () => boolean
  available?: (agent: Agent) => boolean
  assertActive?: (agent?: Agent, signal?: AbortSignal) => void
  onWatchingChange?: (watching: boolean) => void
}) {
  const live = new LiveVision(options.active)
  let watching = false
  let admittingImage = false
  const publishWatching = () => {
    const next = live.snapshot().watching
    if (watching === next) return
    watching = next
    options.onWatchingChange?.(next)
  }
  const presence = setInterval(publishWatching, 500)
  presence.unref()
  const toolOutput = { schema: {}, render: (_input: unknown, value: unknown) => [
    { type: 'text' as const, text: JSON.stringify(value) },
  ] }
  const when = ({ agent }: { agent?: Agent }) => !!agent && agent.id === options.mainId && (options.available?.(agent) ?? true)
  const unbindRead = ctx.tools.register({
    name: 'jingshen_vision',
    description: '读取本人已开启的本机实时物体识别。可给 afterSeq 和最多 6500ms 的 waitMs，等待下一帧的检测结果。结果带时间、检测置信度和位置。无新结果时不要推断当前画面，也不要把检测当作完整图像或身份识别。',
    parameters: { type: 'object', ...z.toJSONSchema(readVisionInput) },
    output: toolOutput,
    execute: async (args, exec) => {
      const { afterSeq, waitMs = 0 } = readVisionInput.parse(args)
      const until = Date.now() + waitMs
      for (;;) {
        options.assertActive?.(exec.agent, exec.signal)
        const status = live.snapshot()
        const hasNewObservation = !!status.reading && status.reading.seq > (afterSeq ?? 0)
        if (!status.active || hasNewObservation || Date.now() >= until) return { ...status, hasNewObservation }
        await delay(Math.min(100, until - Date.now()), undefined, { signal: exec.signal })
      }
    },
  }, { when })
  const unbindWatch = ctx.tools.register({
    name: 'jingshen_watch',
    description: '自行播放、停止或检查本人授权的视频。若 status 显示 library.host，可根据检索结果在该 HTTPS 域名 select 或 play(url)。只有 watching 表示播放时间实际推进。用 jingshen_vision 读取更新的识别。未授权来源不可打开。',
    parameters: { type: 'object', ...z.toJSONSchema(watchInput) },
    output: toolOutput,
    execute: async (args, exec) => {
      options.assertActive?.(exec.agent, exec.signal)
      const { action, url } = watchInput.parse(args)
      const result = live.watch(action, url)
      publishWatching()
      return result
    },
  }, { when })
  const unbindHttp = ctx.webServer.register({ kind: 'prefix', path, handler: async (req, res) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      res.end(JSON.stringify(value))
    }
    const route = new URL(req.url ?? '/', 'http://localhost').pathname.slice(path.length)
    const asset = route.startsWith('/assets/') ? route.slice('/assets/'.length) : undefined
    if (req.method === 'GET' && asset && (asset === 'detector.js' || asset === 'efficientdet_lite0.tflite' || sdkAssets.has(asset))) {
      // Browser Worker imports and WASM fetches cannot set the application request header.
      if (!sameOrigin({ headers: { ...req.headers, 'x-personal-spirit': '1' } }, ctx.webServer.port, ctx.webServer.protocol)) {
        return reply(403, { error: '需要本机同源请求。' })
      }
      if (asset === 'detector.js') {
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin',
          'content-security-policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'" })
        res.end(detectorWorker)
        return
      }
      try {
        const wasmType = sdkAssets.get(asset)
        const file = wasmType ? join(dirname(mediaPipe.resolve('@mediapipe/tasks-vision')), asset)
          : new URL('../src/vision-assets/efficientdet_lite0.tflite', import.meta.url)
        const info = await stat(file)
        res.writeHead(200, { 'content-type': wasmType ?? 'application/octet-stream', 'content-length': info.size,
          'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff',
          'cross-origin-resource-policy': 'same-origin' })
        await pipeline(createReadStream(file), res)
      } catch (error) {
        if (!res.headersSent) return reply(404, { error: '本地视觉模型或运行库不可用。' })
      }
      return
    }
    if (!sameOrigin(req, ctx.webServer.port, ctx.webServer.protocol)) return reply(403, { error: '需要本机同源请求。' })
    try {
      if (req.method === 'GET' && !route) return reply(200, live.snapshot())
      if (req.method !== 'POST') return reply(404, { error: '接口不存在。' })
      const input = await readInput(req, route === '/image' ? maxImageBody : undefined)
      if (route === '/start') {
        const { source, allowedHost } = startInput.parse(input)
        return reply(201, { token: live.start(source, allowedHost) })
      }
      if (route === '/stop') { live.stop(tokenInput.parse(input).token); publishWatching(); return reply(200, { stopped: true }) }
      if (route === '/poll') return reply(200, live.poll(tokenInput.parse(input).token))
      if (route === '/ended') {
        const { token, commandId, failed } = tokenInput.extend({ commandId: uuid, failed: z.boolean().optional() }).strict().parse(input)
        live.playbackEnded(token, commandId, failed)
        publishWatching()
        return reply(200, { ended: true })
      }
      if (route === '/frame') {
        const accepted = live.frame(frameInput.parse(input))
        publishWatching()
        return reply(200, { accepted })
      }
      if (route === '/image') {
        const { token, capturedAt, requestId, data } = imageInput.parse(input)
        live.assertFrame(token, capturedAt)
        options.assertActive?.()
        if (live.sentImage(token, requestId)) return reply(202, { accepted: true })
        if (admittingImage) throw new Error('已有一帧正在发送，请稍后重试。')
        admittingImage = true
        try {
          const resolved = await ctx.sessionController.resolveAgent(options.mainId as SessionPromptRequest['sessionId'])
          if ('error' in resolved) throw new Error('精神主会话不可用。')
          const agent = resolved.agent
          const admit = () => {
            if (res.destroyed || ctx.agents.get(agent.id) !== agent || options.available?.(agent) === false) {
              throw new Error('当前画面已取消。')
            }
            live.assertFrame(token, capturedAt)
            options.assertActive?.()
          }
          admit()
          const selection = agent.model.current()
          if (!selection) throw new Error('请先在精神主会话选择支持图像的模型。')
          const model = await ctx.llm.resolveModelInfo(selection.provider, selection.model)
          if (model.inputModalities && !model.inputModalities.includes('image')) throw new Error('当前模型不支持图像输入。')
          admit()
          const content = await ctx.attachments.admitPromptContent([
            { type: 'text', text: '这是本人从当前视觉共享中明确发送的画面。' },
            { type: 'image', mediaType: 'image/jpeg', data, name: '当前画面.jpg' },
          ])
          admit()
          agent.followup(createUserMessage({ content, source: { kind: 'user', rpcId: requestId as SessionPromptRequest['requestId'] } }))
          live.recordImage(token, requestId)
        } finally { admittingImage = false }
        return reply(202, { accepted: true })
      }
      return reply(404, { error: '接口不存在。' })
    } catch (error) {
      if (!res.destroyed) return reply(400, { error: error instanceof Error ? error.message : String(error) })
    }
  } })
  return {
    snapshot: () => live.snapshot(),
    stop: () => { live.stop(); publishWatching() },
    dispose: () => { clearInterval(presence); live.stop(); publishWatching(); unbindHttp(); unbindWatch(); unbindRead() },
  }
}
