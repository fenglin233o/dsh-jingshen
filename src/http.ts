import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { PersonalService } from './service.ts'
import type { AccessMode } from './control.ts'
import { ChatInput, type ChatSubmission } from './conversation.ts'
import { handleVoiceHttp } from './voice-http.ts'
import type { VoiceService } from './voice-service.ts'

export interface SpiritHttpRuntime {
  snapshot(): Promise<unknown> | unknown
  permissions(mode: AccessMode): Promise<unknown>
  control(action: 'pause' | 'resume' | 'stop' | 'recover'): Promise<unknown>
  chat(input: { after?: number; before?: number; limit: number }): Promise<unknown> | unknown
  postChat(input: ChatSubmission): Promise<unknown>
  currentModel(): Promise<unknown> | unknown
  selectModel(input: z.infer<typeof modelSelectionInput>): Promise<unknown>
  mediation(sessionId: string, messageId: string): unknown
  voice?: VoiceService
}

const cursor = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative())
const identifier = z.string().trim().min(1).max(300)
export const modelSelectionInput = z.object({ provider: identifier, model: identifier, reasoningEffort: identifier.optional() }).strict()

export function sameOrigin(req: Pick<IncomingMessage, 'headers'>, port: number | undefined, protocol = 'http:'): boolean {
  const host = req.headers.host
  return port !== undefined && (host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`)
    && req.headers['x-personal-spirit'] === '1'
    && (req.headers.origin === undefined || req.headers.origin === `${protocol}//${host}`)
}
async function body(req: IncomingMessage, limit = 32_768): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > limit) throw new Error('请求过大')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(data))
}
export function registerHttp(ctx: Context, service: PersonalService, mainId: string, runtime: SpiritHttpRuntime): () => void {
  if (!['127.0.0.1', 'localhost', '::1'].includes(ctx.webServer.host)) throw new Error('个人助手面板须运行在本机回环地址')
  return ctx.webServer.register({ kind: 'prefix', path: '/personal-spirit/api', handler: async (req, res) => {
    if (!sameOrigin(req, ctx.webServer.port, ctx.webServer.protocol)) { json(res, 403, { error: '需要本机同源请求' }); return }
    const url = new URL(req.url ?? '/', 'http://localhost'), path = url.pathname
    try {
      if (runtime.voice && await handleVoiceHttp(runtime.voice, req, res, path)) return
      if (path === '/personal-spirit/api/chat' && req.method === 'GET') {
        const after = url.searchParams.get('after'), before = url.searchParams.get('before')
        if (after !== null && before !== null) throw new Error('同一次读取只能指定一个聊天游标')
        const limit = cursor.pipe(z.number().min(1).max(100)).parse(url.searchParams.get('limit') ?? '40')
        json(res, 200, await runtime.chat({ limit, ...(after !== null ? { after: cursor.parse(after) } : {}), ...(before !== null ? { before: cursor.parse(before) } : {}) })); return
      }
      if (path === '/personal-spirit/api/chat' && req.method === 'POST') {
        json(res, 202, await runtime.postChat(ChatInput.parse(await body(req, 65_536)))); return
      }
      if (path === '/personal-spirit/api/model' && req.method === 'POST') {
        json(res, 200, { selected: await runtime.selectModel(modelSelectionInput.parse(await body(req))) }); return
      }
      if (path === '/personal-spirit/api/model' && req.method === 'GET') {
        json(res, 200, { selected: await runtime.currentModel() }); return
      }
      if (path === '/personal-spirit/api/mediation' && req.method === 'GET') {
        const id = identifier.parse(url.searchParams.get('sessionId')), messageId = identifier.parse(url.searchParams.get('messageId'))
        json(res, 200, runtime.mediation(id, messageId)); return
      }
      if (req.method === 'GET' && path === '/personal-spirit/api/state') {
        json(res, 200, await runtime.snapshot()); return
      }
      if (req.method === 'POST' && path === '/personal-spirit/api/permissions') {
        const input = z.object({ mode: z.enum(['ask', 'full']) }).strict().parse(await body(req))
        json(res, 200, await runtime.permissions(input.mode)); return
      }
      if (req.method === 'POST' && path === '/personal-spirit/api/control') {
        const input = z.object({ action: z.enum(['pause', 'resume', 'stop', 'recover']) }).strict().parse(await body(req))
        json(res, 200, await runtime.control(input.action)); return
      }
      if (req.method === 'POST' && path === '/personal-spirit/api/memory') {
        const input = z.object({ id: z.string(), action: z.enum(['accept', 'reject', 'forget', 'correct']),
          correction: z.object({ statement: z.string().trim().min(1).max(8000), reason: z.string().max(8000).optional() }).strict().optional(),
        }).strict().parse(await body(req))
        json(res, 200, service.book.decideMemory(input.id, input.action, input.correction)); return
      }
      if (req.method === 'POST' && path === '/personal-spirit/api/stop') {
        const input = z.object({ id: z.string() }).strict().parse(await body(req))
        json(res, 200, service.engine.stopTicket(input.id, '本人在面板停止')); return
      }
      if (req.method === 'GET' && path === '/personal-spirit/api/export') {
        res.setHeader('content-disposition', 'attachment; filename="spirit.json"')
        json(res, 200, { format: 'spirit-export-v2', at: new Date().toISOString(), mainId, state: await runtime.snapshot() }); return
      }
      json(res, 404, { error: '接口不存在' })
    } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }) }
  } })
}
