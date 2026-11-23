import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, test, vi } from 'vitest'
import { encodeVoiceWav, SpeechGate } from '../src/voice-audio.ts'
import type { VoiceEvent } from '../src/voice-protocol.ts'
import { VoiceService, validateVoiceWav } from '../src/voice-service.ts'
import { NativeVoiceTurns } from '../src/voice-native.ts'
import { VoiceProviderDiscovery } from '../src/voice-providers.ts'

const silence = () => new Float32Array(320)
const speech = () => new Float32Array(320).fill(0.1)
const recording = () => new Uint8Array(encodeVoiceWav([speech(), speech()], 16_000))
const signal = () => new AbortController().signal

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

test('explicit legacy character voice discovers its own loopback service without exposing a stale remote key', async () => {
  const provider = new VoiceProviderDiscovery({ get: () => undefined } as unknown as Context, {
    SPIRIT_TTS_MODEL: 'jingshen-character', SPIRIT_TTS_API_KEY: 'unused-remote-key',
  })
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (url === 'http://127.0.0.1:8891/v1/models') return Response.json({ data: [{ id: 'jingshen-character' }] })
    expect(url).toBe('http://127.0.0.1:8891/v1/audio/speech')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'jingshen-character', voice: 'xiaoyu', input: '你也看见了吗？', response_format: 'pcm', speed: 1.06,
    })
    return new Response(Uint8Array.of(3, 4), { headers: { 'content-type': 'audio/pcm' } })
  })
  const { output } = await provider.detect()
  expect(output?.info).toEqual({ name: '小肥鱼 · 中文动画少女声', model: 'jingshen-character', voice: 'xiaoyu', location: 'host-local' })
  const pcm = await output!.stream({ id: 'turn', text: '你也看见了吗？', tone: 'playful' }, signal())
  expect(await new Response(pcm).arrayBuffer()).toEqual(Uint8Array.of(3, 4).buffer)
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:8891/v1/models', 'http://127.0.0.1:8891/v1/audio/speech'])
  for (const [, init] of fetch.mock.calls) expect(new Headers(init?.headers).get('authorization')).toBeNull()
  provider.close()
})

test('default speech waits for its BreezeBlue key, while explicitly selected local engines remain available', async () => {
  const ctx = { get: () => undefined } as unknown as Context
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ data: [{ id: 'kokoro' }] }))
  const defaultPhone = new VoiceProviderDiscovery(ctx, { SPIRIT_TTS_API_KEY: 'unused-remote-key' })
  const { input, output, setup } = await defaultPhone.detect()
  expect(output).toBeNull()
  expect(setup).toEqual({ kind: 'breeze-key' })
  expect(input?.info).toEqual({ name: '随包中英语音识别', location: 'host-local' })
  const bundled = new VoiceProviderDiscovery(ctx, { SPIRIT_TTS_MODEL: 'jingshen-light' })
  expect((await bundled.detect()).output?.info).toMatchObject({ model: 'jingshen-light', voice: 'xiaoyu', location: 'host-local' })
  expect(fetch).not.toHaveBeenCalled()
  const configured = new VoiceProviderDiscovery(ctx, { SPIRIT_TTS_VOICE: 'zf_xiaobei' })
  expect((await configured.detect()).output?.info).toMatchObject({ model: 'kokoro', voice: 'zf_xiaobei' })
  expect(fetch.mock.lastCall?.[0]).toBe('http://127.0.0.1:8880/v1/models')
  defaultPhone.close()
  bundled.close()
  configured.close()
})

test('the current speech endpoint uses only credentials from its own configuration', async () => {
  const provider = new VoiceProviderDiscovery({ get: () => undefined } as unknown as Context, {
    SPIRIT_TTS_BASE_URL: 'https://old.example/v1', SPIRIT_TTS_API_KEY: 'previous-key',
    JINGSHEN_TTS_BASE_URL: 'https://new.example/v1', JINGSHEN_TTS_MODEL: 'new-model',
  })
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(Uint8Array.of(0, 0), { headers: { 'content-type': 'audio/pcm' } }))
  try {
    const { output } = await provider.detect()
    await (await output!.stream({ id: 'line', text: '你好' }, signal())).cancel()
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://new.example/v1/audio/speech')
    expect(new Headers(init?.headers).get('authorization')).toBeNull()
  } finally { provider.close() }
})

test('local recognition pins its chosen provider and keeps a cloud registry selection off the microphone path', async () => {
  const selection = { providerId: 'local', language: 'zh' }
  const registry = {
    snapshot: () => ({ selection, providers: [
      { id: 'local', name: 'Local ASR', languages: ['auto', 'zh', 'en'], location: 'host-local', preparation: { phase: 'ready' } },
      { id: 'remote', name: 'Remote ASR', location: 'cloud', preparation: { phase: 'ready' } },
    ] }),
    resolve: vi.fn((input: unknown) => input),
    transcribe: vi.fn(async () => ({ text: '你好' })),
  }
  const provider = new VoiceProviderDiscovery({ get: () => registry } as unknown as Context, {})
  const fetch = vi.spyOn(globalThis, 'fetch')
  try {
    const local = (await provider.detect()).input!
    selection.providerId = 'remote'
    const wav = recording()
    await expect(local.transcribe(wav, signal())).resolves.toBe('你好')
    expect(registry.resolve).toHaveBeenCalledWith({ audio: wav, providerId: 'local', language: 'auto' })
    expect((await provider.detect()).input?.info).toEqual({ name: '随包中英语音识别', location: 'host-local' })
    expect(fetch).not.toHaveBeenCalled()
  } finally { provider.close() }
})

test('an explicitly selected OpenAI synthesis URL still accepts its API key and default model', async () => {
  const provider = new VoiceProviderDiscovery({ get: () => undefined } as unknown as Context, {
    SPIRIT_TTS_BASE_URL: 'https://api.openai.com/v1', SPIRIT_TTS_API_KEY: 'test-key',
  })
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(Uint8Array.of(3, 4), { headers: { 'content-type': 'audio/pcm' } }))
  try {
    const { output } = await provider.detect()
    expect(output?.info).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'marin', location: 'cloud' })
    await (await output!.stream({ id: 'turn', text: '我在听。' }, signal())).cancel()
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key')
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'gpt-4o-mini-tts', input: '我在听。', voice: 'marin',
      response_format: 'pcm', instructions: expect.any(String) })
  } finally { provider.close() }
})

const breeze = { id: 'breeze', family: 'breeze_tts', task: 'tts', mode: 'streaming' }

test('explicit audio.cpp sends the line, the voice alias and Breeze direction separately and keeps raw playback cancellable', async () => {
  const ctx = { get: () => undefined } as unknown as Context
  const provider = new VoiceProviderDiscovery(ctx, {
    SPIRIT_TTS_PROTOCOL: 'audiocpp', SPIRIT_TTS_API_KEY: 'unused-remote-key',
  })
  const cancel = new AbortController()
  const text = '咦，你也看见了吗？'
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ data: [breeze] }))
    .mockImplementationOnce(async (url, init) => {
      expect(url).toBe('http://127.0.0.1:8080/v1/audio/speech')
      expect(JSON.parse(String(init?.body))).toEqual({
        model: 'breeze', voice: 'xiaoyu', input: text, response_format: 'pcm', stream_format: 'audio',
        options: { instruct: expect.stringContaining('重音灵巧') },
      })
      expect(new Headers(init?.headers).get('accept')).toBe('application/octet-stream')
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(3, 4))
          init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true })
        },
      }), { headers: { 'content-type': 'application/octet-stream' } })
    })
  try {
    const { output } = await provider.detect()
    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/v1/models')
    expect(output?.info).toEqual({ name: 'BreezeTTS 2 · xiaoyu', model: 'breeze', voice: 'xiaoyu', location: 'host-local' })
    const reader = (await output!.stream({ id: 'turn', text, tone: 'playful' }, cancel.signal)).getReader()
    expect(await reader.read()).toEqual({ done: false, value: Uint8Array.of(3, 4) })
    cancel.abort(new Error('本人打断'))
    await expect(reader.read()).rejects.toThrow('本人打断')
    for (const [, init] of fetch.mock.calls) expect(new Headers(init?.headers).get('authorization')).toBeNull()
  } finally { provider.close() }
})

test('audio.cpp honors an explicit endpoint and aliases, and rejects a non-PCM response', async () => {
  const ctx = { get: () => undefined } as unknown as Context
  const url = 'http://192.0.2.10:18945/v1', model = 'local-breeze', voice = 'my-reference'
  const cancelBody = vi.fn()
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ data: [{ ...breeze, id: model }] }))
    .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelBody }), { headers: { 'content-type': 'text/event-stream' } }))
    .mockResolvedValueOnce(new Response(Uint8Array.of(3, 4), { headers: { 'content-type': 'application/octet-stream' } }))
  const provider = new VoiceProviderDiscovery(ctx, {
    SPIRIT_TTS_PROTOCOL: 'audiocpp', SPIRIT_TTS_BASE_URL: url, SPIRIT_TTS_MODEL: model, SPIRIT_TTS_VOICE: voice,
    SPIRIT_TTS_API_KEY: 'explicit-key',
  })
  try {
    const { output } = await provider.detect()
    expect(output?.info).toMatchObject({ model, voice, location: 'cloud' })
    const text = '我在听！'
    await expect(output!.stream({ id: 'turn', text }, signal())).rejects.toThrow(/24000Hz PCM/)
    expect(cancelBody).toHaveBeenCalledOnce()
    await (await output!.stream({ id: 'next', text, tone: 'neutral' }, signal())).cancel()
    expect(fetch.mock.calls.map(([address]) => address)).toEqual([`${url}/models`, `${url}/audio/speech`, `${url}/audio/speech`])
    for (const [, init] of fetch.mock.calls) expect(new Headers(init?.headers).get('authorization')).toBe('Bearer explicit-key')
    for (const [, init] of fetch.mock.calls.slice(1)) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ model, voice, input: text,
        options: { instruct: '沿用参考声线，自然朗读原文。' } })
    }
  } finally { provider.close() }
})

test('audio.cpp has no fallback when the server is down or advertises an incompatible model', async () => {
  const ctx = { get: () => undefined } as unknown as Context
  const env = { SPIRIT_TTS_PROTOCOL: 'audiocpp', SPIRIT_TTS_API_KEY: 'local-key' }
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new Error('connection refused'))
    .mockResolvedValueOnce(Response.json({ data: [{ ...breeze, mode: 'offline' }, { ...breeze, family: 'kokoro' }] }))
  const unavailable = new VoiceProviderDiscovery(ctx, env)
  const incompatible = new VoiceProviderDiscovery(ctx, env)
  try {
    expect((await unavailable.detect()).output).toBeNull()
    expect((await incompatible.detect()).output).toBeNull()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:8080/v1/models', 'http://127.0.0.1:8080/v1/models'])
    for (const [, init] of fetch.mock.calls) expect(new Headers(init?.headers).get('authorization')).toBeNull()
  } finally {
    unavailable.close()
    incompatible.close()
  }
})

test('the character reads interjections with the next phrase and preserves every word of a long message', async () => {
  vi.stubEnv('SPIRIT_TTS_BASE_URL', 'http://127.0.0.1:8891/v1')
  vi.stubEnv('SPIRIT_TTS_MODEL', 'jingshen-character')
  const phrases: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    phrases.push(JSON.parse(String(init?.body)).input)
    return new Response(Uint8Array.of(2, 0), { headers: { 'content-type': 'audio/pcm' } })
  })
  const service = new VoiceService({ ctx: { get: () => undefined } as unknown as Context, checkActive() {}, submit: async () => {} })
  try {
    const call = await service.open()
    service.attach(call.id, () => {})
    const text = '咦？你看见了吗？' + '那颗小星星，'.repeat(80) + '眨了一下眼睛。'
    service.delivered({ id: 'long', text })
    for await (const _part of service.speech(call.id, 'long', signal())) { /* drain each synthesized phrase */ }
    expect(phrases[0]).toBe('咦？你看见了吗？')
    expect(phrases.join('')).toBe(text)
    expect(phrases.every(phrase => [...phrase].length <= 80)).toBe(true)
  } finally { service.close() }
})

test('microphone onset interrupts before a complete recording and keeps the leading speech', () => {
  const begin = vi.fn(), complete = vi.fn<(frames: Float32Array[]) => void>()
  const gate = new SpeechGate(begin, complete)
  for (let index = 0; index < 14; index++) gate.frame(silence(), true, false, -42)
  for (let index = 0; index < 9; index++) gate.frame(speech(), true, true, -42)
  expect(begin).toHaveBeenCalledTimes(1)
  expect(complete).not.toHaveBeenCalled()
  for (let index = 0; index < 38; index++) gate.frame(silence(), false, false, -42)
  const frames = complete.mock.calls[0]![0]
  const wav = new Uint8Array(encodeVoiceWav(frames, 16_000))
  expect(frames[14]?.[0]).toBeCloseTo(0.1)
  expect(() => validateVoiceWav(wav)).not.toThrow()
  expect(() => validateVoiceWav(wav.subarray(0, 45))).toThrow()
})

test('the opening threshold is adjustable and a brief pause keeps the same utterance', () => {
  const begin = vi.fn(), complete = vi.fn()
  const gate = new SpeechGate(begin, complete)
  for (let i = 0; i < 12; i++) gate.frame(silence(), false, false, -42)
  const quietSpeech = new Float32Array(320).fill(0.009)
  for (let i = 0; i < 40; i++) gate.frame(quietSpeech, false, true, -35)
  expect(begin).not.toHaveBeenCalled()
  for (let i = 0; i < 20; i++) gate.frame(quietSpeech, false, true, -48)
  for (let i = 0; i < 32; i++) gate.frame(silence(), false, false, -48)
  for (let i = 0; i < 20; i++) gate.frame(quietSpeech, false, true, -48)
  expect(begin).toHaveBeenCalledOnce()
  expect(complete).not.toHaveBeenCalled()
  for (let i = 0; i < 38; i++) gate.frame(silence(), false, false, -48)
  expect(complete).toHaveBeenCalledOnce()
})

test('only delivered text reaches synthesis and cutting the playback preserves the subsequent owner input', async () => {
  vi.stubEnv('SPIRIT_TTS_BASE_URL', 'https://speech.example.test/v1')
  vi.stubEnv('SPIRIT_TTS_API_KEY', 'server-only-key')
  vi.stubEnv('SPIRIT_TTS_MODEL', 'gpt-4o-mini-tts')
  vi.stubEnv('SPIRIT_ASR_BASE_URL', undefined)
  const ctx = { get: (name: string) => name === 'speechToText' ? {
    snapshot: () => ({ selection: { providerId: 'native' }, providers: [{ id: 'native', name: 'SenseVoice', languages: ['auto', 'en', 'zh'], location: 'host-local', preparation: { phase: 'standby' } }] }),
    resolve: (value: unknown) => value,
    transcribe: () => Promise.resolve({ text: '我想谈另一件事' }),
  } : undefined } as Context
  const synth = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2))
      init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true })
    },
  }), { headers: { 'content-type': 'audio/pcm' } })))
  const submit = vi.fn(async (input: { requestId: string; text: string }, _signal: AbortSignal, accepted: (id: string) => void) => {
    accepted(`host:${input.requestId}`)
    return { accepted: true }
  })
  const stopMedia = vi.fn()
  const cutGeneration = vi.fn()
  const voice = new VoiceService({ ctx, checkActive() {}, submit, onPlaying: () => stopMedia, cutGeneration })
  expect(JSON.stringify(await voice.availability())).not.toContain('server-only-key')
  const opened = await voice.open()
  const events: VoiceEvent[] = []
  voice.attach(opened.id, event => events.push(event))
  await expect(voice.speech(opened.id, 'unapproved', signal())[Symbol.asyncIterator]().next()).rejects.toThrow()
  expect(synth).not.toHaveBeenCalled()
  const delivered = { id: 'approved', text: '你好，我在听。', tone: 'gentle' } as const
  voice.delivered(delivered); voice.delivered(delivered)
  expect(events.filter(event => event.type === 'speech')).toHaveLength(1)
  const stream = voice.speech(opened.id, delivered.id, signal())[Symbol.asyncIterator]()
  await expect(stream.next()).resolves.toEqual({ done: false, value: Uint8Array.of(1, 2) })
  expect(JSON.parse(String(synth.mock.calls[0]![1]?.body))).toMatchObject({ input: delivered.text, response_format: 'pcm' })
  voice.playing(opened.id, delivered.id, true)
  voice.interrupt(opened.id, 1)
  await expect(stream.next()).rejects.toThrow()
  expect(stopMedia).toHaveBeenCalledTimes(1)
  expect(cutGeneration).not.toHaveBeenCalled()
  await expect(voice.input(opened.id, 'later', recording(), signal())).resolves.toEqual({ text: '我想谈另一件事' })
  expect(submit).toHaveBeenCalledWith({ requestId: 'voice:later', text: '我想谈另一件事' }, expect.any(AbortSignal), expect.any(Function))
  voice.interrupt(opened.id, 1, 'not-accepted')
  expect(cutGeneration).not.toHaveBeenCalled()
  voice.interrupt(opened.id, 1, 'later')
  expect(cutGeneration).toHaveBeenCalledWith({ ownerMessageId: 'host:voice:later', reading: undefined })
  voice.pause()
  expect(events.at(-1)?.type).toBe('closed')
  await expect(voice.input(opened.id, 'still-later', recording(), signal())).rejects.toThrow()
  voice.close()
})

test('a voice cut aborts matching main inference, drops its continuation, and wakes queued owner input intact', async () => {
  let currentGeneration = new AbortController()
  let boundary = { openTurnStartSeq: 10, lastTurn: 1 }
  const owner = (id: string): UserMessage => ({ role: 'user', source: { kind: 'user' }, id: MessageId(id), content: [] })
  const later = owner('later owner input')
  const inbox = {
    nextTurn: [later], nextStep: [{ ...owner('old continuation'), source: { kind: 'spirit-mediation', turn: 1, form: 'notice', summary: 'old' } }],
    remove(id: MessageId) { this.nextStep = this.nextStep.filter(message => message.id !== id); return true },
    splice(_target: string, offset: number, count: number) { return this.nextTurn.splice(offset, count) },
  }
  const idle = Promise.withResolvers<void>()
  const followup = vi.fn(message => inbox.nextTurn.push(message))
  const cancel = vi.fn((reason, options) => {
    if (!options.keepInbox) inbox.nextTurn.splice(0)
    currentGeneration.abort(reason)
  })
  const native = { id: 'main', status: 'running', session: { seq: 40 }, cancel, inbox, followup, whenIdle: () => idle.promise }
  const agent = native as unknown as Agent
  const project = { ...agent, id: 'project', cancel: vi.fn() } as unknown as Agent
  const voiceTurns = new NativeVoiceTurns(() => agent, () => boundary)
  const start = (turn: number, id: string) => ({ type: 'start', turn, step: 1, revision: 1, attemptId: id } as AssistantStreamFrame)
  const end = (id: string) => ({ type: 'end', index: 0, revision: 1, attemptId: id, outcome: { kind: 'abandoned' } } as AssistantStreamFrame)

  voiceTurns.claimed(project, owner('project-input'), 1)
  voiceTurns.stream(project, start(1, 'project-stream'))
  voiceTurns.claimed(agent, owner('first-voice'), 1)
  voiceTurns.stream(agent, start(1, 'voice-stream'))
  voiceTurns.cut({ ownerMessageId: 'project-input' })
  expect(currentGeneration.signal.aborted).toBe(false)
  voiceTurns.cut({ ownerMessageId: 'first-voice' })
  expect(currentGeneration.signal.aborted).toBe(true)
  expect(inbox.nextTurn).toEqual([later])
  expect(inbox.nextStep).toEqual([])
  expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ kind: 'hook' }), { keepInbox: true })
  expect(project.cancel).not.toHaveBeenCalled()
  native.status = 'idle'
  idle.resolve()
  await idle.promise
  expect(followup).toHaveBeenCalledExactlyOnceWith(later)

  native.status = 'running'
  currentGeneration = new AbortController()
  boundary = { openTurnStartSeq: 20, lastTurn: 2 }
  voiceTurns.claimed(agent, owner('new-voice'), 2)
  voiceTurns.stream(agent, start(2, 'new-stream'))
  voiceTurns.cut({ ownerMessageId: 'first-voice', reading: { kind: 'say', sessionId: 'main', startSeq: 10, turn: 1 } })
  expect(currentGeneration.signal.aborted).toBe(false)
  voiceTurns.stream(agent, end('new-stream'))
  voiceTurns.cut({ reading: { kind: 'say', sessionId: 'main', startSeq: 20, turn: 2 } })
  expect(currentGeneration.signal.aborted).toBe(false)
  voiceTurns.stream(agent, start(2, 'continuation'))
  expect(currentGeneration.signal.aborted).toBe(true)
})
