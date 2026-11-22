// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { VoiceCall } from '../src/voice-client.tsx'
import { localMandarinVoice } from '../src/voice-device.ts'
import type { VoiceAvailability, VoiceEvent } from '../src/voice-protocol.ts'

const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
globals.IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()) })
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.replaceChildren()
})

const voice = (name: string, lang: string, localService: boolean, preferred = false): SpeechSynthesisVoice =>
  ({ name, voiceURI: name, lang, localService, default: preferred })
const online = voice('在线中文', 'zh-CN', false, true)
const taiwan = voice('台湾普通话', 'zh-TW', true)
const mainland = voice('普通话设备声线', 'zh_CN', true)
const host = { name: '近端角色引擎', model: 'character', voice: 'xiaoyu', location: 'host-local' } as const

class Utterance {
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  voice?: SpeechSynthesisVoice
  constructor(readonly text: string) {}
}

async function mount(output: VoiceAvailability['output'] = null, detectedVoices: SpeechSynthesisVoice[] = []) {
  const spoken: Utterance[] = [], calls: string[] = []
  let list = detectedVoices
  const synth = Object.assign(new EventTarget(), {
    getVoices: () => list,
    speak: (utterance: Utterance) => spoken.push(utterance),
    cancel: vi.fn(() => spoken.at(-1)?.onerror?.()),
  })
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('AudioContext', class { async resume() {}; async close() {} })
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const emit = (event: VoiceEvent) => stream?.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'))
  vi.stubGlobal('fetch', async (path: string) => {
    const action = new URL(path, 'http://localhost').pathname.split('/').at(-1)!
    calls.push(action)
    if (action === 'status') return Response.json({ active: true, input: null, output })
    if (action === 'call') return Response.json({ id: 'call-1', input: false, neural: !!output, output })
    if (action === 'events') return new Response(new ReadableStream({ start(controller) {
      stream = controller
      emit({ type: 'ready' })
    } }))
    if (action === 'speech') return Response.json({ error: '宿主语音不可用' }, { status: 503 })
    return Response.json({ ok: true })
  })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  roots.push(root)
  await act(async () => root.render(<VoiceCall />))
  function find(label: string) {
    const button = [...element.querySelectorAll('button')].find(item => item.textContent === label)
    if (!button) throw new Error(`Missing button: ${label}`)
    return button
  }
  return {
    element, calls, spoken, synth, find,
    click: (label: string) => act(async () => find(label).click()),
    voices: (next: SpeechSynthesisVoice[]) => act(async () => {
      list = next
      synth.dispatchEvent(new Event('voiceschanged'))
    }),
    select: (value: string) => act(async () => {
      const select = element.querySelector('select')!
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }),
    speak: (text: string) => act(async () => emit({ type: 'speech', message: { id: text, text, sequence: 1 } })),
    disconnect: () => act(async () => stream?.close()),
  }
}

it('只选浏览器标记为本机的普通话声线，优先中国大陆普通话', () => {
  expect(localMandarinVoice([online, voice('广东话', 'zh-HK', true), voice('粤语', 'zh-yue', true)])).toBeUndefined()
  expect(localMandarinVoice([online, taiwan, mainland])).toBe(mainland)
  expect(localMandarinVoice([voice('普通话 macrolanguage', 'zh', true), voice('系统默认', 'cmn-CN', true, true)])?.name).toBe('系统默认')
})

it('浏览器晚到的本机普通话声线可自动接通，不向宿主发送合成请求，断开清除播放', async () => {
  const view = await mount(null, [online])
  expect(view.find('接通语音').disabled).toBe(true)
  expect(view.element.textContent).toContain('设备没有本机普通话声线')
  await view.voices([online, mainland])
  expect(view.find('接通语音').disabled).toBe(false)
  await view.click('接通语音')
  expect(view.element.querySelector('.spirit-voice-provider')?.textContent).toContain(mainland.name)
  await view.speak('听见了吗？')
  expect(view.spoken[0]).toMatchObject({ text: '听见了吗？', voice: mainland })
  await act(async () => view.spoken[0]?.onstart?.())
  expect(view.element.textContent).toContain('精神正在说话')
  expect(view.calls).not.toContain('speech')
  await view.disconnect()
  expect(view.synth.cancel).toHaveBeenCalledOnce()
  expect(view.spoken[0]?.onend).toBeNull()
  expect(view.element.textContent).toContain('语音连接已断开')
})

it('宿主合成故障且尚未播出时，自动模式换为设备朗读，挂断能取消', async () => {
  const view = await mount(host, [mainland])
  expect(view.element.querySelector('audio')).toBeNull()
  await view.click('接通语音')
  expect(view.element.querySelector('.spirit-voice-provider')?.textContent).toContain(host.name)
  await view.speak('可以继续听。')
  expect(view.calls.filter(action => action === 'speech')).toHaveLength(1)
  expect(view.spoken[0]?.voice).toBe(mainland)
  expect(view.element.querySelector('.spirit-voice-provider')?.textContent).toContain(mainland.name)
  await view.click('挂断')
  expect(view.synth.cancel).toHaveBeenCalledOnce()
})

it('保留用户手选的设备或宿主偏好；设备声线消失时不切到其他服务', async () => {
  const view = await mount(host, [mainland])
  await view.select('system')
  expect(localStorage.getItem('personal-spirit:voice-output')).toBe('system')
  await view.voices([online])
  expect(view.find('接通语音').disabled).toBe(true)
  expect(view.element.querySelector('select')?.value).toBe('system')
  await view.select('host')
  await view.voices([mainland])
  await view.click('接通语音')
  await view.speak('宿主仍被明确选中。')
  expect(view.spoken).toHaveLength(0)
  expect(view.element.textContent).toContain('宿主语音不可用')
  expect(localStorage.getItem('personal-spirit:voice-output')).toBe('host')
})

it('试听只显示当前选用的对应内置样音', async () => {
  const view = await mount({ ...host, model: 'jingshen-light' }, [mainland])
  expect(view.element.querySelector('audio')?.getAttribute('src')).toBe('/personal-spirit/assets/voice/xiaoyu-light-preview.mp3')
  await view.select('system')
  expect(view.element.querySelector('audio')).toBeNull()
  await view.select('auto')
  expect(view.element.querySelector('audio')?.getAttribute('src')).toBe('/personal-spirit/assets/voice/xiaoyu-light-preview.mp3')
})
