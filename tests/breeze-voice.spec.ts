import type { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, test, vi } from 'vitest'
import { VoiceProviderDiscovery } from '../src/voice-providers.ts'
import { VoiceService } from '../src/voice-service.ts'

const endpoint = 'https://api.breeze.blue/v1/text-to-speech/voc_8yud7hz7c9q2/stream?output_format=pcm&enable_logging=false'
const signal = () => new AbortController().signal
const text = { id: 'call-message', text: '好呀，我在听。' }
const ctx = (resolve?: (ref: string) => Promise<{ value: string } | undefined>) => ({
  get: (key: string) => key === 'credentials' && resolve ? { resolve } : undefined,
} as unknown as Context)

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

function pcm(body: BodyInit) {
  return new Response(body, { headers: { 'content-type': 'audio/pcm' } })
}

test('BreezeBlue resolves stored credentials on playback and uses only the documented fixed PCM route', async () => {
  const resolve = vi.fn().mockResolvedValueOnce({ value: 'brz_fixture_original' })
    .mockResolvedValueOnce({ value: 'brz_fixture_rotated' })
    .mockResolvedValueOnce(undefined)
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => pcm(new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(3))
      controller.enqueue(Uint8Array.of(4, 5, 6))
      controller.close()
    },
  })))
  const provider = new VoiceProviderDiscovery(ctx(resolve), { SPIRIT_TTS_PROTOCOL: 'breezeblue',
    SPIRIT_TTS_BASE_URL: 'https://other.example.test/v1', SPIRIT_TTS_MODEL: 'wrong-model',
    SPIRIT_TTS_VOICE: 'wrong-voice', SPIRIT_TTS_API_KEY: 'unrelated-key' })
  try {
    const { output, setup } = await provider.detect()
    expect(setup).toBeUndefined()
    expect(output?.info).toEqual({ name: '大肥鱼·迷糊版', provider: 'breezeblue',
      model: 'breeze-tts-2', voice: 'voc_8yud7hz7c9q2', location: 'cloud' })
    expect(JSON.stringify(output)).not.toContain('brz_fixture')
    expect(fetch).not.toHaveBeenCalled()
    const reader = (await output!.stream(text, signal())).getReader()
    expect(await reader.read()).toEqual({ value: Uint8Array.of(3), done: false })
    expect(await reader.read()).toEqual({ value: Uint8Array.of(4, 5, 6), done: false })
    expect(await reader.read()).toEqual({ value: undefined, done: true })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(endpoint)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store' })
    expect(new Headers(init?.headers).get('xi-api-key')).toBe('brz_fixture_rotated')
    expect(new Headers(init?.headers).get('authorization')).toBeNull()
    expect(new Headers(init?.headers).get('accept')).toBe('audio/pcm')
    expect(JSON.parse(String(init?.body))).toEqual({ text: text.text, model_id: 'breeze-tts-2', language_code: 'zh' })
    await expect(output!.stream(text, signal())).rejects.toThrow('请先设置 BreezeBlue API Key')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(resolve.mock.calls).toEqual([['BREEZE_API_KEY'], ['BREEZE_API_KEY'], ['BREEZE_API_KEY']])
  } finally { provider.close() }
})

test('status, opening a call and receiving a delivery never request cloud synthesis', async () => {
  for (const key of ['BREEZE_API_KEY','SPIRIT_TTS_PROTOCOL','SPIRIT_TTS_BASE_URL','SPIRIT_TTS_MODEL','SPIRIT_TTS_VOICE','SPIRIT_ASR_BASE_URL']) {
    vi.stubEnv(key, undefined)
  }
  vi.stubEnv('BREEZE_API_KEY', 'brz_fixture_env')
  const resolve = vi.fn(async () => undefined)
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pcm(Uint8Array.of(0, 1)))
  const service = new VoiceService({ ctx: ctx(resolve), checkActive() {}, submit: async () => {} })
  try {
    expect((await service.availability()).output?.provider).toBe('breezeblue')
    const call = await service.open()
    const unopened = service.speech(call.id, text.id, signal())[Symbol.asyncIterator]()
    await expect(unopened.next()).rejects.toThrow()
    service.attach(call.id, () => {})
    const draft = service.speech(call.id, 'draft-message', signal())[Symbol.asyncIterator]()
    await expect(draft.next()).rejects.toThrow()
    service.delivered(text)
    expect(fetch).not.toHaveBeenCalled()
    const playback = service.speech(call.id, text.id, signal())[Symbol.asyncIterator]()
    expect((await playback.next()).value).toEqual(Uint8Array.of(0, 1))
    await playback.return?.()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(new Headers(fetch.mock.lastCall?.[1]?.headers).get('xi-api-key')).toBe('brz_fixture_env')
  } finally { service.close() }
})

test('an explicit OpenAI protocol uses its distinct key and never resolves the BreezeBlue credential', async () => {
  const resolve = vi.fn(async () => ({ value: 'brz_fixture_private' }))
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pcm(Uint8Array.of(0, 1)))
  const provider = new VoiceProviderDiscovery(ctx(resolve), { BREEZE_API_KEY: 'brz_fixture_env',
    SPIRIT_TTS_PROTOCOL: 'openai', SPIRIT_TTS_API_KEY: 'only-openai' })
  try {
    const { output } = await provider.detect()
    const reply = 'Nice to hear from you.'
    await (await output!.stream({ ...text, text: reply }, signal())).cancel()
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect(new Headers(init?.headers).get('xi-api-key')).toBeNull()
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer only-openai')
    expect(JSON.parse(String(init?.body))).toMatchObject({ input: reply, instructions: expect.stringMatching(/^Speak naturally in English\b/u) })
    expect(resolve).not.toHaveBeenCalled()
  } finally { provider.close() }
})

test.each([
  ['I’m here. How can I help?', 'breeze-tts-2', 'en', /soft and gentle/u],
  ['我在听，we can start now。', 'breeze-tts-2-multilingual', undefined, /柔和.*soft and gentle/u],
] as const)('BreezeBlue keeps the voice and original %s text while using the matching model and instructions', async (reply, model, language, direction) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pcm(Uint8Array.of(0, 1)))
  const provider = new VoiceProviderDiscovery(ctx(), { BREEZE_API_KEY: 'brz_fixture_env' })
  try {
    const { output } = await provider.detect()
    await (await output!.stream({ id: text.id, text: reply, tone: 'gentle' }, signal())).cancel()
    const [url, init] = fetch.mock.lastCall!
    expect(url).toBe(endpoint)
    expect(JSON.parse(String(init?.body))).toEqual({ text: reply, model_id: model, ...(language !== undefined && { language_code: language }),
      instructions: expect.stringMatching(direction) })
  } finally { provider.close() }
})

test.each([
  ['gentle', /柔和/u], ['warm', /温暖/u], ['serious', /认真/u], ['playful', /俏皮/u], ['neutral', undefined],
] as const)('BreezeBlue sends the explicit %s tone separately from the exact delivered text', async (tone, direction) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pcm(Uint8Array.of(0, 1)))
  const provider = new VoiceProviderDiscovery(ctx(), { BREEZE_API_KEY: 'brz_fixture_env' })
  try {
    const { output } = await provider.detect()
    await (await output!.stream({ ...text, tone }, signal())).cancel()
    const body = JSON.parse(String(fetch.mock.lastCall?.[1]?.body))
    expect(body).toEqual({ text: text.text, model_id: 'breeze-tts-2', language_code: 'zh',
      ...(direction ? { instructions: expect.stringMatching(direction) } : {}) })
  } finally { provider.close() }
})

test.each([
  [401, 'API Key 无效'], [402, '额度不足'], [403, '没有使用该音色的权限'], [404, '找不到所选音色'], [429, '达到并发限制'],
])('BreezeBlue HTTP %i gives a safe diagnostic and cancels the upstream body', async (status, diagnostic) => {
  const cancel = vi.fn()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('brz_fixture_private and user text'))
    },
    cancel,
  }), { status, headers: { 'content-type': 'application/json' } }))
  const provider = new VoiceProviderDiscovery(ctx(), { BREEZE_API_KEY: 'brz_fixture_private' })
  try {
    const { output } = await provider.detect()
    const error = await output!.stream(text, signal()).catch(error => error as Error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(diagnostic)
    expect((error as Error).message).toContain(`HTTP ${status}`)
    expect((error as Error).message).not.toContain('brz_fixture_private')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally { provider.close() }
})

test('BreezeBlue rejects non-PCM and safely propagates an interrupted PCM stream', async () => {
  const cancelled = vi.fn()
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'content-type': 'text/event-stream' } }))
    .mockImplementationOnce(async (_url, init) => pcm(new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.of(7, 8))
        init?.signal?.addEventListener('abort', () => controller.error(new Error('sensitive request details')), { once: true })
      },
    })))
    .mockResolvedValueOnce(pcm(Uint8Array.of(7)))
  const caller = new AbortController()
  const provider = new VoiceProviderDiscovery(ctx(), { BREEZE_API_KEY: 'brz_fixture_env' })
  try {
    const { output } = await provider.detect()
    await expect(output!.stream(text, signal())).rejects.toThrow('未返回 24 kHz PCM')
    expect(cancelled).toHaveBeenCalledTimes(1)
    const reader = (await output!.stream(text, caller.signal)).getReader()
    expect(await reader.read()).toEqual({ value: Uint8Array.of(7, 8), done: false })
    caller.abort()
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    const fragmented = (await output!.stream(text, signal())).getReader()
    expect(await fragmented.read()).toEqual({ value: Uint8Array.of(7), done: false })
    await expect(fragmented.read()).rejects.toThrow('不完整的 24 kHz PCM')
    expect(fetch).toHaveBeenCalledTimes(3)
  } finally { provider.close() }
})

test('BreezeBlue never retries transport errors and drops the underlying response when playback cancels', async () => {
  const cancelled = vi.fn()
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new Error('brz_fixture_env request was refused'))
    .mockResolvedValueOnce(pcm(new ReadableStream({ cancel: cancelled })))
  const provider = new VoiceProviderDiscovery(ctx(), { BREEZE_API_KEY: 'brz_fixture_env' })
  try {
    const { output } = await provider.detect()
    await expect(output!.stream(text, signal())).rejects.toThrow(/^BreezeBlue 语音连接失败或音频流中断$/u)
    expect(fetch).toHaveBeenCalledTimes(1)
    const stream = await output!.stream(text, signal())
    await stream.cancel()
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  } finally { provider.close() }
})
