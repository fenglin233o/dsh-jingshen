import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { SpiritControl, type AccessMode } from '../src/control.ts'
import { registerHttp, sameOrigin, type SpiritHttpRuntime } from '../src/http.ts'
import { PersonalService } from '../src/service.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'spirit-http-'))
  const service = new PersonalService(directory, { ensure: async () => {}, send: async () => {}, stop: async () => {} })
  const control = new SpiritControl(service.store)
  const runtime: SpiritHttpRuntime = {
    snapshot: vi.fn(() => ({ control: control.current(), ...service.snapshot() })),
    permissions: vi.fn(async (mode: AccessMode) => control.select({ mode }, '本人通过面板选择权限')),
    control: vi.fn(async action => ({ receivedAction: action })),
    chat: vi.fn(input => ({ input, messages: [], cursor: input.after ?? 0 })),
    selectModel: vi.fn(async input => input),
    currentModel: vi.fn(() => null),
    postChat: vi.fn(async input => ({ accepted: true, requestId: input.requestId, messageId: `owner:${input.requestId}` })),
    mediation: vi.fn((sessionId, messageId) => ({ records: messageId === 'linked' ? [{ sessionId, messageId, disposition: 'speak' }] : [] })),
  }
  let handler!: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  const server = createServer((req, res) => { void handler(req, res).catch(error => { res.writeHead(500); res.end(String(error)) }) })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback server address')
  const port = address.port, disposer = vi.fn()
  const webServer = { host: '127.0.0.1', protocol: 'http:', port,
    register: (route: { kind: string; path: string; handler: typeof handler }) => {
      expect(route).toMatchObject({ kind: 'prefix', path: '/personal-spirit/api' }); handler = route.handler; return disposer
    } }
  const unregister = registerHttp({ webServer } as unknown as Context, service, 'spirit-main', runtime)
  cleanup.push(async () => {
    unregister()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await service.stop(); rmSync(directory, { recursive: true, force: true })
  })
  const send = (path: string, options: { method?: string; body?: unknown; rawBody?: string; headers?: Record<string, string | undefined> } = {}) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; json: any; text: string }>((resolve, reject) => {
      const headers: Record<string, string> = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`,
        'x-personal-spirit': '1', 'content-type': 'application/json' }
      for (const [key, value] of Object.entries(options.headers ?? {})) { if (value === undefined) delete headers[key]; else headers[key] = value }
      const outgoing = request({ host: '127.0.0.1', port, path: `/personal-spirit/api${path}`, method: options.method ?? 'GET', headers }, response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try { resolve({ status: response.statusCode!, headers: response.headers, json: JSON.parse(text), text }) } catch (error) { reject(error) }
        })
      })
      outgoing.on('error', reject)
      outgoing.end(options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)))
    })
  return { service, control, runtime, webServer, port, send }
}

describe('actual local HTTP owner controls', () => {
  it('serves persisted state and export, and sends a validated permission choice to the runtime callback', async () => {
    const f = await fixture(), current = await f.send('/state')
    expect(current.status).toBe(200); expect(current.json.control.mode).toBe('ask')
    expect(current.headers['cache-control']).toBe('no-store')
    expect(current.headers['x-content-type-options']).toBe('nosniff')
    expect((await f.send('/permissions', { method: 'POST', body: { mode: 'full' } })).status).toBe(200)
    expect(f.runtime.permissions).toHaveBeenCalledExactlyOnceWith('full')
    expect((await f.send('/state')).json.control).toMatchObject({ mode: 'full', revision: 2 })
    const exported = await f.send('/export')
    expect(exported.status).toBe(200)
    expect(exported.headers['content-disposition']).toContain('attachment; filename="spirit.json"')
    expect(exported.json).toMatchObject({ format: 'spirit-export-v2', mainId: 'spirit-main', state: { control: { mode: 'full' } } })
  })

  it('rejects wrong origins, ports, hostnames and missing custom headers before any owner mutation', async () => {
    const f = await fixture(), revision = f.control.current().revision
    const invalid = [
      { origin: 'https://attacker.example' }, { origin: `http://localhost:${f.port}` },
      { host: `127.0.0.1:${f.port + 1}` }, { host: `attacker.example:${f.port}` },
      { host: `127.0.0.1.evil.test:${f.port}` }, { origin: 'null' },
      { 'x-personal-spirit': undefined }, { 'x-personal-spirit': 'true' },
    ]
    for (const headers of invalid) {
      const response = await f.send('/permissions', { method: 'POST', body: { mode: 'full' }, headers })
      expect(response.status).toBe(403)
    }
    expect(f.runtime.permissions).not.toHaveBeenCalled()
    expect(f.control.current().revision).toBe(revision)
    expect((await f.send('/state', { headers: { origin: undefined } })).status).toBe(200)
  })

  it('requires the configured protocol and supports exact loopback IPv6 host authority', async () => {
    const f = await fixture()
    f.webServer.protocol = 'https:'
    expect((await f.send('/state')).status).toBe(403)
    expect((await f.send('/state', { headers: { origin: `https://127.0.0.1:${f.port}` } })).status).toBe(200)
    expect((await f.send('/state', { headers: { host: `[::1]:${f.port}`, origin: `https://[::1]:${f.port}` } })).status).toBe(200)
    expect(sameOrigin({ headers: { host: '127.0.0.1:1234', 'x-personal-spirit': '1' } }, undefined)).toBe(false)
  })

  it('rejects malformed, oversized and overprivileged permission bodies without calling the runtime', async () => {
    const f = await fixture()
    for (const body of [{ mode: 'full', state: 'running' }, { mode: 'custom' }, { mode: 'full', ownerConfirmed: true }, {}, null, ['full']]) {
      expect((await f.send('/permissions', { method: 'POST', body })).status).toBe(400)
    }
    expect((await f.send('/permissions', { method: 'POST', rawBody: '{"mode":' })).status).toBe(400)
    expect((await f.send('/permissions', { method: 'POST', rawBody: JSON.stringify({ mode: 'full', padding: 'x'.repeat(40_000) }) })).status).toBe(400)
    expect(f.runtime.permissions).not.toHaveBeenCalled()
    expect(f.control.current().mode).toBe('ask')
  })

  it('routes owner pause/resume/stop/recover exactly and exposes no generic property setter', async () => {
    const f = await fixture()
    for (const action of ['pause', 'resume', 'stop', 'recover']) {
      const response = await f.send('/control', { method: 'POST', body: { action } })
      expect(response.status).toBe(200); expect(response.json.receivedAction).toBe(action)
    }
    expect(vi.mocked(f.runtime.control).mock.calls.map(([action]) => action)).toEqual(['pause', 'resume', 'stop', 'recover'])
    expect((await f.send('/control', { method: 'POST', body: { action: 'resume', mode: 'full' } })).status).toBe(400)
    expect((await f.send('/control', { method: 'POST', body: { action: 'set', revision: 1 } })).status).toBe(400)
    expect((await f.send('/control', { method: 'GET' })).status).toBe(404)
    expect(vi.mocked(f.runtime.control).mock.calls).toHaveLength(4)
  })

  it('selects the main session model without accepting a different target or a global setting', async () => {
    const { send, runtime } = await fixture()
    const choice = { provider: 'local', model: 'chinese', reasoningEffort: 'low' }
    expect(await send('/model')).toMatchObject({ status: 200, json: { selected: null } })
    expect(await send('/model', { method: 'POST', body: choice })).toMatchObject({ status: 200, json: { selected: choice } })
    expect(await send('/model', { method: 'POST', body: { ...choice, sessionId: 'outside' } })).toMatchObject({ status: 400 })
    expect(runtime.selectModel).toHaveBeenCalledTimes(1)
  })

  it('routes only owner-authored public chat input and validates independent pagination and mediation identifiers', async () => {
    const f = await fixture()
    expect((await f.send('/chat?after=42&limit=15')).json).toMatchObject({ input: { after: 42, limit: 15 }, cursor: 42 })
    expect((await f.send('/chat?before=42&limit=15')).json).toMatchObject({ input: { before: 42, limit: 15 } })
    for (const query of ['?after=1&before=2', '?after=-1', '?limit=1000']) expect((await f.send(`/chat${query}`)).status).toBe(400)
    const input = { requestId: 'entry-1', text: ' 本人的文字 ' }
    expect(await f.send('/chat', { method: 'POST', body: input })).toMatchObject({ status: 202, json: { accepted: true, messageId: 'owner:entry-1' } })
    expect(f.runtime.postChat).toHaveBeenCalledExactlyOnceWith(input)
    expect((await f.send('/chat', { method: 'POST', body: { ...input, author: 'spirit' } })).status).toBe(400)
    expect((await f.send('/chat', { method: 'POST', body: input, headers: { origin: 'null' } })).status).toBe(403)
    expect((await f.send('/mediation?sessionId=spirit-main')).status).toBe(400)
    expect((await f.send('/mediation?sessionId=spirit-main&messageId=unknown')).json.records).toEqual([])
    expect((await f.send('/mediation?sessionId=spirit-main&messageId=linked')).json.records).toEqual([{ sessionId: 'spirit-main', messageId: 'linked', disposition: 'speak' }])
  })

  it('owner memory correction creates an explicit replacement while preserving the prior model provenance', async () => {
    const f = await fixture()
    const memory = f.service.book.rememberGlobal({ kind: 'preference', statement: '本人喜欢加糖的茶', reason: '从一条含糊的话推断', state: 'active' },
      { sessionId: 'spirit-main', id: 'conversation-1', text: '今天的茶比昨天好喝' })
    expect(memory.ownerConfirmed).toBe(false)
    const failed = await f.send('/memory', { method: 'POST', body: { id: memory.id, action: 'correct' } })
    expect(failed.status).toBe(400)
    expect(f.service.book.memories()).toHaveLength(1)
    const response = await f.send('/memory', { method: 'POST', body: { id: memory.id, action: 'correct',
      correction: { statement: '本人喜欢无糖的茶', reason: '昨天是茶叶不合口味，与糖无关' } } })
    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({ state: 'accepted', ownerConfirmed: true, replaces: memory.id,
      statement: '本人喜欢无糖的茶', provenance: { kind: 'owner', reference: memory.id } })
    expect(response.json.id).not.toBe(memory.id)
    const old = f.service.book.memories().find(item => item.id === memory.id)!
    expect(old.state).toBe('superseded'); expect(old.provenance).toEqual(memory.provenance)
    expect(old.history.at(-1)).toMatchObject({ action: 'supersede', replacementId: response.json.id })
    expect(f.service.book.usableMemories().map(item => item.statement)).toEqual(['本人喜欢无糖的茶'])
    expect((await f.send('/memory', { method: 'POST', body: { id: response.json.id, action: 'forget' } })).status).toBe(200)
    expect(f.service.book.usableMemories()).toEqual([])
  })

  it('stops a real task from the owner route, and stale task input cannot reopen it', async () => {
    const f = await fixture(), source = { sessionId: 'spirit-main', id: 'owner-request', text: '整理可修改的学习安排' }
    const task = f.service.open(source, { title: '学习安排' })
    await f.service.effects.idle()
    const response = await f.send('/stop', { method: 'POST', body: { id: task.id } })
    expect(response.status).toBe(200)
    expect(f.service.require(task.id).ended?.by).toBe('human')
    expect(() => f.service.followup(task.id, { ...source, id: 'late', text: '旧执行回合试图继续' })).toThrow(/已经停止/)
    expect((await f.send('/stop', { method: 'POST', body: { id: 'does-not-exist' } })).status).toBe(400)
  })

  it('returns a bounded route error when the runtime refuses a control instead of reporting success', async () => {
    const f = await fixture()
    vi.mocked(f.runtime.permissions).mockRejectedValueOnce(new Error('Native permission propagation failed'))
    const response = await f.send('/permissions', { method: 'POST', body: { mode: 'full' } })
    expect(response.status).toBe(400)
    expect(response.json.error).toBe('Native permission propagation failed')
    expect(f.control.current().mode).toBe('ask')
    expect((await f.send('/missing')).status).toBe(404)
  })
})
