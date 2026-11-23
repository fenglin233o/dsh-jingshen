// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { VoiceCall } from '../src/voice-client.tsx'
import { localMandarinVoice } from '../src/voice-device.ts'
import { PLAY_RATE, type VoiceAvailability, type VoiceEvent } from '../src/voice-protocol.ts'

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
const breeze = { provider: 'breezeblue', name: '大肥鱼（迷糊版）', model: 'breeze-tts-2',
  voice: 'v8yud7hz7c9q2', location: 'cloud' } as const
const setup = { kind: 'breeze-key' } as const
const input = { name: '本机转写', location: 'host-local' } as const

class Utterance {
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  voice?: SpeechSynthesisVoice
  constructor(readonly text: string) {}
}

async function mount(output: VoiceAvailability['output'] = null, detectedVoices: SpeechSynthesisVoice[] = [], options: {
  setup?: VoiceAvailability['setup']
  input?: VoiceAvailability['input']
  openedOutput?: VoiceAvailability['output']
  openedSetup?: VoiceAvailability['setup']
  status?: () => Pick<VoiceAvailability, 'output' | 'setup'>
  saveBreezeKey?: (key: string) => Promise<void>
  speech?: (signal?: AbortSignal | null) => Response
  microphone?: () => Promise<MediaStream>
  addWorklet?: () => Promise<void>
} = {}) {
  const spoken: Utterance[] = [], calls: string[] = []
  let list = detectedVoices
  const synth = Object.assign(new EventTarget(), {
    getVoices: () => list,
    speak: (utterance: Utterance) => spoken.push(utterance),
    cancel: vi.fn(() => spoken.at(-1)?.onerror?.()),
  })
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  const micPort = { onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null, close: vi.fn() }
  if (options.microphone) {
    const navigatorWithMic = Object.create(navigator, { mediaDevices: { value: { getUserMedia: options.microphone } } })
    vi.stubGlobal('navigator', navigatorWithMic)
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL() { return 'blob:mic-worklet' }
      static revokeObjectURL() {}
    })
    vi.stubGlobal('AudioWorkletNode', class {
      port = micPort
      connect() {}
      disconnect() {}
    })
  }
  const stopAudio = vi.fn()
  vi.stubGlobal('AudioContext', class {
    sampleRate = PLAY_RATE
    currentTime = 0
    destination = {}
    audioWorklet = options.microphone ? { addModule: options.addWorklet ?? (async () => {}) } : undefined
    async resume() {}
    async close() {}
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} } }
    createBuffer(_channels: number, samples: number) { return { getChannelData: () => new Float32Array(samples) } }
    createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop: stopAudio } }
  })
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  let sequence = 0
  const emit = (event: VoiceEvent) => stream?.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'))
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    const action = new URL(path, 'http://localhost').pathname.split('/').at(-1)!
    calls.push(action)
    if (action === 'status') return Response.json({
      active: true, input: options.input ?? null, output, setup: options.setup, ...options.status?.(),
    })
    if (action === 'call') {
      const opened = options.openedOutput === undefined ? output : options.openedOutput
      return Response.json({ id: 'call-1', input: !!options.input, neural: !!opened, output: opened, setup: options.openedSetup })
    }
    if (action === 'events') return new Response(new ReadableStream({ start(controller) {
      stream = controller
      emit({ type: 'ready' })
      init?.signal?.addEventListener('abort', () => {
        if (stream === controller) { stream = undefined; controller.close() }
      }, { once: true })
    } }))
    if (action === 'speech') return options.speech?.(init?.signal) ?? Response.json({ error: '宿主语音不可用' }, { status: 503 })
    return Response.json({ ok: true })
  })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  roots.push(root)
  await act(async () => root.render(<VoiceCall optionsOpen saveBreezeKey={options.saveBreezeKey} />))
  function find(label: string) {
    const button = [...element.querySelectorAll('button')].find(item => item.textContent === label)
    if (!button) throw new Error(`Missing button: ${label}`)
    return button
  }
  return {
    element, calls, spoken, synth, find, stopAudio, micPort,
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
    speak: (text: string) => act(async () => emit({ type: 'speech', message: { id: text, text, sequence: ++sequence } })),
    disconnect: () => act(async () => { const controller = stream; stream = undefined; controller?.close() }),
  }
}

it('只选浏览器标记为本机的普通话声线，优先中国大陆普通话', () => {
  expect(localMandarinVoice([online, voice('广东话', 'zh-HK', true), voice('粤语', 'zh-yue', true)])).toBeUndefined()
  expect(localMandarinVoice([online, taiwan, mainland])).toBe(mainland)
  expect(localMandarinVoice([voice('普通话 macrolanguage', 'zh', true), voice('系统默认', 'cmn-CN', true, true)])?.name).toBe('系统默认')
})

it('关麦立即停止正在初始化的采集，随后重新开麦只安装一次采集处理器', async () => {
  const worklet = Promise.withResolvers<void>()
  const addWorklet = vi.fn(() => worklet.promise)
  const track = () => Object.assign(new EventTarget(), { stop: vi.fn() })
  const first = track(), second = track()
  const microphone = vi.fn().mockResolvedValueOnce({ getTracks: () => [first], getAudioTracks: () => [first] })
    .mockResolvedValueOnce({ getTracks: () => [second], getAudioTracks: () => [second] })
  const view = await mount(host, [], { input, microphone, addWorklet })
  await view.click('接通并开麦')
  await view.click('关麦')
  expect(first.stop).toHaveBeenCalledTimes(1)
  expect(view.micPort.onmessage).toBeNull()
  await view.click('开麦')
  await act(async () => worklet.resolve())
  expect(addWorklet).toHaveBeenCalledTimes(1)
  expect(view.micPort.onmessage).toBeTypeOf('function')
  await view.click('关麦')
  expect(second.stop).toHaveBeenCalledTimes(1)
  expect(view.micPort.onmessage).toBeNull()
  expect(view.calls).not.toContain('audio')
})

it('麦克风关闭时仍可打断朗读且保持关闭', async () => {
  const view = await mount(null, [mainland])
  await view.click('接通语音')
  await view.speak('需要打断的文字')
  await act(async () => view.spoken[0]?.onstart?.())
  await view.click('打断朗读')
  expect(view.synth.cancel).toHaveBeenCalledTimes(1)
  expect(view.calls).toContain('interrupt')
  expect(view.find('打断朗读').disabled).toBe(true)
  expect(view.element.querySelector('.spirit-voice-status')?.textContent).toBe('已关闭麦克风')
})

it('设备朗读按顺序播放快速送达的每条消息', async () => {
  const view = await mount(null, [mainland])
  await view.click('接通语音')
  const replies = Array.from({ length: 40 }, (_, index) => `消息 ${index}`)
  for (const reply of replies) await view.speak(reply)
  for (const [index, reply] of replies.entries()) {
    expect(view.spoken[index]?.text).toBe(reply)
    await act(async () => {
      view.spoken[index]?.onstart?.()
      view.spoken[index]?.onend?.()
    })
  }
  expect(view.spoken).toHaveLength(replies.length)
  expect(view.calls.filter(action => action === 'playing')).toHaveLength(replies.length * 2)
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

it('缺少 Breeze 凭据时只显示官方设置与试听链接，并要求手选设备朗读', async () => {
  const view = await mount(null, [mainland], { setup })
  expect(view.find('接通语音').disabled).toBe(true)
  expect(view.element.textContent).toContain('在 Harness 凭据中保存 BREEZE_API_KEY')
  expect(view.element.querySelectorAll('input, textarea, audio')).toHaveLength(0)
  const links = [...view.element.querySelectorAll('a')]
  expect(links.map(link => link.getAttribute('href'))).toEqual([
    'https://breezeblue.ai/zh/app/developer/api-keys',
    'https://breezeblue.ai/zh/voice-library/dafeiyu-dreamy-girl-voice-v8yud7hz7c9q2',
  ])
  expect(links.every(link => link.target === '_blank' && link.rel.includes('noreferrer'))).toBe(true)
  expect(view.calls).toEqual(['status'])
  await view.select('system')
  await view.click('接通语音')
  await view.speak('这是手选设备声线。')
  expect(view.spoken[0]?.voice).toBe(mainland)
  expect(view.calls).not.toContain('speech')
})

it('缺少 Breeze 凭据时可以接通仅语音转写，收到回复不发声', async () => {
  const view = await mount(null, [mainland], { input, setup })
  expect(view.find('仅转写并开麦').disabled).toBe(false)
  await view.click('仅转写并开麦')
  expect(view.element.querySelector('.spirit-voice-provider')?.textContent).toBe('仅语音转写')
  expect(view.element.textContent).not.toContain('仍可听语音')
  await view.speak('只阅读这条回复。')
  expect(view.calls).not.toContain('speech')
  expect(view.spoken).toHaveLength(0)
  await view.click('挂断')
  expect(view.calls).toContain('hangup')
})

it('已配置 Breeze 凭据时可以明确选择仅转写', async () => {
  const view = await mount(breeze, [mainland], { input })
  await view.select('input')
  await view.click('仅转写并开麦')
  await view.speak('不朗读。')
  expect(view.element.querySelector('.spirit-voice-provider')?.textContent).toBe('仅语音转写')
  expect(view.calls).not.toContain('speech')
  expect(view.spoken).toHaveLength(0)
})

function pcm(signal?: AbortSignal | null): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(PLAY_RATE / 5))
      signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true })
    },
  }), { headers: { 'x-spirit-pcm-rate': String(PLAY_RATE) } })
}

it('自动模式播放实际 Breeze 音频，挂断中止播放', async () => {
  const view = await mount(breeze, [mainland], { speech: pcm })
  expect(view.element.querySelector('audio')).toBeNull()
  expect(view.element.textContent).toContain('大肥鱼（迷糊版）')
  await view.click('接通语音')
  await view.speak('Breeze 朗读这一句。')
  expect(view.calls).toContain('speech')
  expect(view.calls).toContain('playing')
  expect(view.spoken).toHaveLength(0)
  expect(view.element.textContent).toContain('精神正在说话')
  await view.click('挂断')
  expect(view.stopAudio).toHaveBeenCalledOnce()
  expect(view.calls).toContain('hangup')
})

it.each([
  [401, undefined, '请检查 Harness 凭据 BREEZE_API_KEY'],
  [402, undefined, 'BreezeBlue 积分不足'],
  [400, 'breeze-auth', '请检查 Harness 凭据 BREEZE_API_KEY'],
])('Breeze 朗读错误 %s 不回退到设备，也不显示上游原始消息', async (status, code, message) => {
  const view = await mount(breeze, [mainland], {
    speech: () => Response.json({ error: '上游刻意插入的敏感内容', code }, { status }),
  })
  await view.click('接通语音')
  await view.speak('这句合成失败。')
  expect(view.spoken).toHaveLength(0)
  expect(view.element.textContent).toContain(message)
  expect(view.element.textContent).not.toContain('上游刻意插入的敏感内容')
  expect(view.calls).toContain('hangup')
})

it.each([429, 503])('Breeze 临时错误 %s 跳过失败的回复，下一条仍可用云声线', async status => {
  let requests = 0
  const view = await mount(breeze, [mainland], {
    speech: signal => ++requests === 1 ? Response.json({ error: '上游原始错误' }, { status }) : pcm(signal),
  })
  await view.click('接通语音')
  await view.speak('第一条失败。')
  expect(view.element.textContent).toContain('未能朗读这条回复')
  expect(view.calls).not.toContain('hangup')
  await view.speak('第二条继续用 Breeze。')
  expect(view.element.textContent).toContain('精神正在说话')
  expect(view.element.textContent).not.toContain('未能朗读这条回复')
  expect(view.spoken).toHaveLength(0)
  expect(requests).toBe(2)
  await view.click('挂断')
})

it('Breeze 失败后保留通话输入，并停止请求后续朗读', async () => {
  const view = await mount(breeze, [mainland], {
    input, speech: () => Response.json({ error: '积分不足' }, { status: 400 }),
  })
  await view.click('接通并开麦')
  await view.speak('第一次云朗读失败。')
  expect(view.element.textContent).toContain('BreezeBlue 积分不足')
  expect(view.element.querySelector('.spirit-voice-provider')?.textContent).toBe('仅语音转写')
  expect(view.find('开麦').disabled).toBe(false)
  await view.click('开麦')
  expect(view.element.textContent).toContain('BreezeBlue 积分不足')
  await view.speak('后续只保留文字。')
  expect(view.calls.filter(action => action === 'speech')).toHaveLength(1)
  expect(view.spoken).toHaveLength(0)
  expect(view.calls).not.toContain('hangup')
})

it('状态为 Breeze 时接通响应若换成旧声线，自动模式拒绝该声线', async () => {
  const view = await mount(breeze, [mainland], { openedOutput: { ...host, model: 'jingshen-light' } })
  await view.click('接通语音')
  expect(view.element.textContent).toContain('BreezeBlue 朗读不可用')
  expect(view.element.querySelector('audio')).toBeNull()
  expect(view.calls).toContain('hangup')
  expect(view.calls).not.toContain('events')
})

it('接通时返回待配置标志会阻止回落，并显示新的设置状态', async () => {
  const view = await mount(null, [mainland], { openedSetup: setup })
  expect(view.find('接通语音').disabled).toBe(false)
  await view.click('接通语音')
  expect(view.element.textContent).toContain('在 Harness 凭据中保存 BREEZE_API_KEY')
  expect(view.find('接通语音').disabled).toBe(true)
  expect(view.calls).toContain('hangup')
  expect(view.calls).not.toContain('events')
})

it('显式打开密码输入，通过原生凭据回调保存后重新检查状态', async () => {
  let configured = false
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const saveBreezeKey = vi.fn(async () => { await pending; configured = true })
  const view = await mount(null, [mainland], {
    setup, saveBreezeKey, status: () => configured ? { output: breeze, setup: undefined } : { output: null, setup },
  })
  expect(view.element.querySelector('input')).toBeNull()
  await view.click('配置 Breeze 密钥')
  const field = view.element.querySelector('input')!
  expect(field.type).toBe('password')
  expect(field.autocomplete).toBe('off')
  expect(field.name).toBe('')
  expect(document.activeElement).toBe(field)
  field.value = 'fixture-breeze-key'
  await view.click('保存至 Harness')
  expect(saveBreezeKey).toHaveBeenCalledExactlyOnceWith('fixture-breeze-key')
  expect(field.value).toBe('')
  expect(view.calls).toEqual(['status'])
  expect(localStorage.length).toBe(0)
  await act(async () => finish())
  expect(view.element.querySelector('input')).toBeNull()
  expect(view.calls).toEqual(['status', 'status'])
  expect(view.find('更新 Breeze 密钥').disabled).toBe(false)
  expect(view.find('接通语音').disabled).toBe(false)
})

it('更新密钥失败时清空输入并隐藏回调错误内容', async () => {
  const saveBreezeKey = vi.fn(async (key: string) => { throw new Error(key) })
  const view = await mount(breeze, [mainland], { saveBreezeKey })
  await view.click('更新 Breeze 密钥')
  const field = view.element.querySelector('input')!
  field.value = 'fixture-rejected-key'
  await view.click('保存至 Harness')
  expect(field.value).toBe('')
  expect(view.element.querySelector('[role=alert]')?.textContent).toBe('无法保存 Breeze 密钥，请重试。')
  expect(view.element.textContent).not.toContain('fixture-rejected-key')
  expect(view.calls).toEqual(['status'])
  expect(localStorage.length).toBe(0)
})
