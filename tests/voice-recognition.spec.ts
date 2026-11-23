import type { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'
import { encodeVoiceWav } from '../src/voice-audio.ts'
import { VoiceProviderDiscovery } from '../src/voice-providers.ts'
import { VoiceService } from '../src/voice-service.ts'

const require = createRequire(import.meta.url)
const { recognize } = require('../scripts/local-speech/recognize.cjs') as {
  recognize(recognizer: unknown, wave: Uint8Array): string
}

const wave = () => new Uint8Array(encodeVoiceWav([Float32Array.of(.2, -.2, .1)], 16_000))
const rejected = ['', ' ？……\u200b ', '<unk>', '你好<unk>呀', '<UNK>回来', 'hello <unk> there']

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

test('the local recognizer drops undecodable transcripts and preserves genuine recognized words', () => {
  const stream = { acceptWaveform: vi.fn() }
  const recognizer = { createStream: () => stream, decode: vi.fn(), getResult: vi.fn() }
  for (const text of rejected) {
    recognizer.getResult.mockReturnValueOnce({ text, tokens: [] })
    expect(recognize(recognizer, wave())).toBe('')
  }
  recognizer.getResult.mockReturnValueOnce({ text: '好吗', tokens: ['<unk>', '好吗'] })
  expect(recognize(recognizer, wave())).toBe('')
  recognizer.getResult.mockReturnValueOnce({ text: ' 唔，五点见。 ', tokens: ['唔', '五', '点', '见'] })
  expect(recognize(recognizer, wave())).toBe('唔，五点见。')
  const { samples, sampleRate } = stream.acceptWaveform.mock.lastCall![0]
  expect(sampleRate).toBe(16_000)
  expect(samples).toHaveLength(2_400)
  expect(samples[0]).toBeCloseTo(.2)
  expect(samples.subarray(3).every((value: number) => value === 0)).toBe(true)
  expect(recognizer.decode).toHaveBeenLastCalledWith(stream)
  recognizer.getResult.mockReturnValueOnce({ text: ' Can you hear me? ', tokens: ['Can', 'you', 'hear', 'me'] })
  expect(recognize(recognizer, wave())).toBe('Can you hear me?')
})

test('unrecognized call audio returns an empty transcript and never becomes an owner message', async () => {
  vi.stubEnv('SPIRIT_ASR_BASE_URL', undefined)
  vi.stubEnv('JINGSHEN_ASR_BASE_URL', undefined)
  vi.stubEnv('JINGSHEN_TTS_MODEL', 'jingshen-light')
  const transcribe = vi.fn()
  const ctx = { get: (name: string) => name === 'speechToText' ? {
    snapshot: () => ({ selection: { providerId: 'local' }, providers: [
      { id: 'local', name: 'Local ASR', languages: ['zh', 'en', 'auto'], location: 'host-local', preparation: { phase: 'ready' } },
    ] }),
    resolve: (audio: unknown) => audio,
    transcribe,
  } : undefined } as Context
  const submit = vi.fn(async () => {})
  const voice = new VoiceService({ ctx, checkActive() {}, submit })
  const signal = new AbortController().signal
  try {
    const call = await voice.open()
    voice.attach(call.id, () => {})
    for (const [index, text] of rejected.entries()) {
      transcribe.mockResolvedValueOnce({ text })
      await expect(voice.input(call.id, `empty-${index}`, wave(), signal)).resolves.toEqual({ text: '' })
    }
    expect(submit).not.toHaveBeenCalled()
    transcribe.mockResolvedValueOnce({ text: ' 唔，五点见。 ' })
    await expect(voice.input(call.id, 'heard', wave(), signal)).resolves.toEqual({ text: '唔，五点见。' })
    expect(submit).toHaveBeenCalledExactlyOnceWith({ requestId: 'voice:heard', text: '唔，五点见。' }, expect.any(AbortSignal), expect.any(Function))
  } finally {
    voice.close()
  }
})

test('existing profiles keep their explicit recognition endpoint and language', async () => {
  const provider = new VoiceProviderDiscovery({ get: () => undefined } as unknown as Context, {
    SPIRIT_ASR_BASE_URL: 'http://127.0.0.1:8800/v1',
    SPIRIT_ASR_MODEL: 'legacy-asr',
    SPIRIT_ASR_LANGUAGE: 'auto',
  })
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ text: '你好呀' }))
  try {
    const { input } = await provider.detect()
    await expect(input!.transcribe(wave(), new AbortController().signal)).resolves.toBe('你好呀')
    const [url, options] = fetch.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:8800/v1/audio/transcriptions')
    const form = options?.body as FormData
    expect(form.get('model')).toBe('legacy-asr')
    expect(form.has('language')).toBe(false)
  } finally {
    provider.close()
  }
})

test('a custom ASR receives audio without a monolingual hint unless explicitly configured', async () => {
  const provider = new VoiceProviderDiscovery({ get: () => undefined } as unknown as Context, {
    JINGSHEN_ASR_BASE_URL: 'http://127.0.0.1:8800/v1',
  })
  const text = '帮我 check the calendar 再告诉我几点'
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ text }))
  try {
    const { input } = await provider.detect()
    expect(await input!.transcribe(wave(), new AbortController().signal)).toBe(text)
    expect((fetch.mock.lastCall?.[1]?.body as FormData).has('language')).toBe(false)
  } finally { provider.close() }
})
