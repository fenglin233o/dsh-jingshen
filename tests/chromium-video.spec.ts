import { runInNewContext, runInContext, type Context } from 'node:vm'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const worker = readFileSync(new URL('../media/chromium-video/worker.js', import.meta.url), 'utf8')
type Tab = { id: number; url: string; documentId: string }
type Pairing = { controller?: { id: number; origin: string }; target?: { id: number; documentId: string; handle: string } }
type CaptureConfig = { handle: string; exposeOrigin: boolean; permittedOrigins: string[] }
type VideoStatus = { time: number; playing: boolean }
type Sender = { id: string; frameId: number; tab: { id: number }; url: string }
type Command = { action: string; handle: string }
type Receive = (command: Command, sender: Sender, reply: (result: VideoStatus | null) => void) => boolean | undefined
const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close() })

function fixture() {
  const dom = new JSDOM('<video id="front"></video><video id="hidden"></video><video id="offscreen"></video>')
  cleanup.push(() => dom.window.close())
  const { window } = dom
  const controller: Tab = { id: 1, url: 'http://127.0.0.1:3000/', documentId: 'main' }
  const videoTab: Tab = { id: 2, url: 'https://video.example.test/', documentId: 'video-original' }
  const unrelated: Tab = { id: 3, url: 'http://127.0.0.1:4000/', documentId: 'other-main' }
  const tabs = new Map([controller, videoTab, unrelated].map(tab => [tab.id, tab]))
  const pairing: Pairing = {}
  const config = vi.fn<(value: CaptureConfig) => void>()
  let onClick!: (tab: Tab) => void, onMessage!: Receive
  let scope!: Context
  const executeScript = vi.fn(async ({ target, func, args = [] }: {
    target: { tabId: number; documentIds?: string[] }; func: (...values: never[]) => unknown; args?: unknown[]
  }) => {
    const tab = tabs.get(target.tabId)!
    if (target.documentIds && !target.documentIds.includes(tab.documentId)) throw new Error('Chromium rejects a stale target document')
    scope.fetch = vi.fn(async () => ({ ok: tab.id === controller.id, headers: { get: () => 'image/png' } }))
    scope.scriptArgs = args
    const result = await runInContext(`(${func.toString()})(...scriptArgs)`, scope)
    return [{ result, documentId: tab.documentId }]
  })
  const chrome = {
    action: {
      onClicked: { addListener: (callback: typeof onClick) => { onClick = callback } },
      setBadgeText: vi.fn(async () => {}), setTitle: vi.fn(async () => {}),
    },
    runtime: { id: 'test-extension', onMessage: { addListener: (callback: Receive) => { onMessage = callback } } },
    storage: { session: {
      get: async () => ({ ...pairing }),
      set: async (value: Pairing) => { Object.assign(pairing, value) },
      remove: async (names: keyof Pairing | (keyof Pairing)[]) => {
        for (const name of typeof names === 'string' ? [names] : names) delete pairing[name]
      },
    } },
    scripting: { executeScript }, tabs: { onRemoved: { addListener: () => {} } },
  }
  scope = { chrome, URL, crypto: { randomUUID }, navigator: { mediaDevices: { setCaptureHandleConfig: config } },
    document: window.document, getComputedStyle: window.getComputedStyle.bind(window), innerWidth: 1024, innerHeight: 768 }
  runInNewContext(worker, scope)

  const click = async (tab: Tab) => { onClick(tab); await runInContext('order', scope) }
  const command = (action: string, handle: string, sender: Partial<Sender> = {}) => new Promise<VideoStatus | null | undefined>(resolve => {
    if (!onMessage({ action, handle }, { id: chrome.runtime.id, frameId: 0, tab: { id: controller.id }, url: controller.url, ...sender }, resolve)) resolve(undefined)
  })
  const video = (id: string, x: number, width: number, visibility = 'visible') => {
    const element = window.document.querySelector<HTMLVideoElement>(`#${id}`)!
    Object.assign(element.style, { visibility, opacity: '1' })
    const rect = new window.DOMRect(x, 0, width, 300)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(element, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
    let paused = true
    Object.defineProperties(element, { paused: { get: () => paused }, readyState: { get: () => 4 } })
    const play = vi.spyOn(element, 'play').mockImplementation(async () => { paused = false })
    const pause = vi.spyOn(element, 'pause').mockImplementation(() => { paused = true })
    return { play, pause, element }
  }
  return { controller, videoTab, unrelated, pairing, config, executeScript, click, command, video }
}

describe('optional Chromium video extension', () => {
  it('plays only visible, in-viewport video and exposes the fixed playback status', async () => {
    const f = fixture()
    const visible = f.video('front', 20, 320)
    const hidden = f.video('hidden', 0, 850, 'hidden')
    const offscreen = f.video('offscreen', 1600, 900)
    await f.click(f.controller)
    await f.click(f.videoTab)
    const { handle } = f.pairing.target!

    expect(await f.command('status', handle)).toEqual({ time: 0, playing: false })
    expect(await f.command('play', handle)).toEqual({ time: 0, playing: true })
    expect(visible.play).toHaveBeenCalledOnce()
    expect(hidden.play).not.toHaveBeenCalled()
    expect(offscreen.play).not.toHaveBeenCalled()
    visible.element.currentTime = 0.75
    expect(await f.command('status', handle)).toEqual({ time: 0.75, playing: true })
    expect(await f.command('stop', handle)).toEqual({ time: 0.75, playing: false })
    expect(visible.pause).toHaveBeenCalledOnce()
  })

  it('binds the opt-in to one Harness tab and one document, and rejects stale handle replay', async () => {
    const f = fixture()
    const visible = f.video('front', 20, 320)
    await f.click(f.videoTab)
    await f.click(f.unrelated)
    expect(f.pairing).toEqual({})
    expect(f.config).not.toHaveBeenCalled()
    await f.click(f.controller)
    await f.click(f.videoTab)
    const old = f.pairing.target!
    expect(f.config).toHaveBeenLastCalledWith({ handle: old.handle, exposeOrigin: false, permittedOrigins: [new URL(f.controller.url).origin] })

    expect(await f.command('play', old.handle, { tab: { id: 99 } })).toBeNull()
    expect(await f.command('play', old.handle, { url: f.unrelated.url })).toBeNull()
    expect(await f.command('play', `spirit-video-${randomUUID()}`)).toBeNull()
    expect(await f.command('seek', old.handle)).toBeUndefined()
    expect(await f.command('play', old.handle, { frameId: 1 })).toBeUndefined()
    f.videoTab.documentId = 'navigated-document'
    expect(await f.command('play', old.handle)).toBeNull()
    expect(f.executeScript).toHaveBeenLastCalledWith(expect.objectContaining({ target: { tabId: f.videoTab.id, documentIds: ['video-original'] } }))
    expect(visible.play).not.toHaveBeenCalled()

    await f.click(f.videoTab)
    expect(f.pairing.target).toBeUndefined()
    expect(f.config).toHaveBeenLastCalledWith({ handle: '', exposeOrigin: false, permittedOrigins: [] })
    await f.click(f.videoTab)
    const fresh = f.pairing.target!
    expect(fresh.handle).not.toBe(old.handle)
    expect(await f.command('play', old.handle)).toBeNull()
    expect(await f.command('status', fresh.handle)).toEqual({ time: 0, playing: false })
    await f.click(f.controller)
    expect(f.pairing).toEqual({})
    expect(await f.command('play', fresh.handle)).toBeNull()
    expect(visible.play).not.toHaveBeenCalled()
  })
})
