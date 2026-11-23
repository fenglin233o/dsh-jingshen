// @vitest-environment jsdom
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SpiritWindow, type SpiritMessage, type SpiritWindowProps } from '../src/spirit-ui.tsx'

vi.mock('../src/vision-client.tsx', () => ({ VisionControls: () => null }))

const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
globals.IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()) })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
  document.body.replaceChildren()
})

const id = 'main-fixture'
const at = '2026-11-22T11:56:00.000Z'
const row = (cursor: number, author: SpiritMessage['author'], text: string): SpiritMessage =>
  ({ cursor, id: String(cursor), author, text, at, source: { kind: 'native', sessionId: id } })
const page = (messages: SpiritMessage[], cursor = messages.at(-1)?.cursor ?? 0) => ({
  mainId: id, messages, cursor, hasMore: false, nextBefore: null, presence: { activity: { kind: 'idle' } },
})
const response = (data: object, status = 200) => new Response(JSON.stringify(data), { status })
async function mount(props: Partial<SpiritWindowProps> = {}) {
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  roots.push(root)
  await act(async () => root.render(<SpiritWindow renderManagement={() => null} renderModels={() => null} openSource={async () => {}} {...props} />))
  const click = async (label: string) => {
    const button = [...element.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label)
    if (!button) throw new Error(`Missing action: ${label}`)
    await act(async () => button.click())
  }
  return { element, click }
}

it('显示每次实际发布的消息，保留段落，并把未读计数交给单一鱼入口', async () => {
  vi.useFakeTimers()
  let messages = [row(1, 'owner', '好了吗？')]
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    const after = Number(new URL(path, 'http://localhost').searchParams.get('after'))
    return response(page(messages.filter(message => message.cursor > after), messages.at(-1)?.cursor ?? 0))
  }))
  const view = await mount()
  await view.click('打开精神通讯')
  expect(view.element.querySelectorAll('.jingshen-message')).toHaveLength(1)
  expect(view.element.querySelector('.jingshen-launcher .spirit-fish')?.hasAttribute('data-speaking')).toBe(false)
  await view.click('缩小窗口')
  messages = [...messages, row(2, 'spirit', '需要先确认两项。\n\n这是实际发布的长段落。'), row(3, 'spirit', '第一项已经确认。')]
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  expect(view.element.querySelector('.jingshen-launcher .spirit-fish')?.hasAttribute('data-speaking')).toBe(true)
  await view.click('打开精神通讯，2 条未读')
  const replies = [...view.element.querySelectorAll('[data-author="spirit"] .jingshen-bubble')]
  expect(replies.map(node => node.textContent)).toEqual(['需要先确认两项。\n\n这是实际发布的长段落。', '第一项已经确认。'])
  expect(localStorage.getItem(`dsh-jingshen-read:${id}`)).toBe('3')
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(view.element.querySelector('.jingshen-launcher .spirit-fish')?.hasAttribute('data-speaking')).toBe(false)
  await view.click('缩小窗口')
  const launch = view.element.querySelector('.jingshen-launcher')
  expect(launch?.getAttribute('aria-label')).toBe('打开精神通讯')
  expect(document.activeElement).toBe(launch)
})

it('会话失去授权会清除已显示的记录，并停用输入', async () => {
  vi.useFakeTimers()
  let allowed = true
  vi.stubGlobal('fetch', vi.fn(async () => allowed ? response(page([row(1, 'spirit', '授权会话中的内容')]))
    : response({ error: '需要授权' }, 403)))
  const view = await mount()
  await view.click('打开精神通讯')
  expect(view.element.textContent).toContain('授权会话中的内容')
  allowed = false
  await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
  expect(view.element.textContent).not.toContain('授权会话中的内容')
  expect(view.element.textContent).toContain('此窗口尚未获得授权')
  expect(view.element.querySelector('textarea')?.disabled).toBe(true)
})

it('从通讯标题栏进入通话，在通话标题栏查看语音选项', async () => {
  const requests = vi.fn(async (path: string) => path.endsWith('/voice/status')
    ? response({ active: true, input: { name: '本机转写', location: 'host-local' }, output: null })
    : response(page([])))
  vi.stubGlobal('fetch', requests)
  const view = await mount()
  await view.click('打开精神通讯')
  const footer = view.element.querySelector('.jingshen-footer')
  expect(footer?.querySelector('textarea')).toBeTruthy()
  expect(footer?.querySelector('.spirit-voice')).toBeNull()
  expect(requests.mock.calls.some(([path]) => path.endsWith('/voice/status'))).toBe(false)
  await view.click('语音通话')
  expect(view.element.querySelector('.jingshen-window[data-phone] .jingshen-call-orbit .spirit-fish')).toBeTruthy()
  expect(view.element.querySelector('.jingshen-footer')).toBeNull()
  expect(view.element.querySelector('.spirit-voice-options')?.hasAttribute('hidden')).toBe(true)
  await view.click('语音选项')
  expect(view.element.querySelector('.spirit-voice-options')?.hasAttribute('hidden')).toBe(false)
  expect(view.element.querySelector('.spirit-voice-options select')).toBeTruthy()
  await view.click('返回通讯')
  expect(view.element.querySelector('.jingshen-footer textarea')).toBeTruthy()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('语音通话')
})

it('实际看画面使用观察姿态，实际播放视频不会显示成通话', async () => {
  vi.useFakeTimers()
  let activity: { kind: string; media?: { kind: string; state: string } } = {
    kind: 'observing', media: { kind: 'camera', state: 'observing' },
  }
  vi.stubGlobal('fetch', vi.fn(async () => response({ ...page([]), presence: { activity } })))
  const view = await mount()
  await view.click('打开精神通讯')
  const fish = view.element.querySelector('.jingshen-launcher .spirit-fish')
  expect(fish?.getAttribute('data-scene')).toBe('observing')
  expect(view.element.querySelector('.jingshen-status')?.textContent).toBe('在看画面')
  activity = { kind: 'phone', media: { kind: 'video', state: 'playing' } }
  await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
  expect(fish?.getAttribute('data-scene')).toBe('video')
  expect(view.element.querySelector('.jingshen-status')?.textContent).toBe('在看视频')
})

it('缩小窗口仍订阅原生待办，并且可从鱼入口进入同一待办', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response(page([]))))
  function Pending({ publish }: { publish: (count: number) => void }) {
    const [active, setActive] = useState(true)
    useEffect(() => { publish(active ? 1 : 0) }, [active, publish])
    return active ? <button type="button" aria-label="处理中止" onClick={() => setActive(false)}>中止</button> : null
  }
  const view = await mount({ renderNativeInteractions: (_sessionId, onPendingChange) => <Pending publish={onPendingChange} /> })
  expect(view.element.querySelector('[role=dialog]')?.hasAttribute('hidden')).toBe(true)
  await view.click('打开精神通讯，1 项需要处理')
  expect(view.element.querySelector('[role=dialog]')?.hasAttribute('hidden')).toBe(false)
  await view.click('处理中止')
  await view.click('缩小窗口')
  expect(view.element.querySelector('.jingshen-launcher')?.getAttribute('aria-label')).toBe('打开精神通讯')
})
