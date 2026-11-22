import type { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, test, vi } from 'vitest'
import { LocalSpeech } from '../src/local-speech.ts'
import { BUNDLED_VOICE_MODEL } from '../src/voice-protocol.ts'
import { VoiceService } from '../src/voice-service.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

async function openPrime() {
  for (const key of ['SPIRIT_TTS_MODEL', 'SPIRIT_TTS_BASE_URL', 'SPIRIT_TTS_VOICE', 'SPIRIT_TTS_PROTOCOL', 'SPIRIT_ASR_BASE_URL']) {
    vi.stubEnv(key, undefined)
  }
  vi.spyOn(LocalSpeech.prototype, 'available').mockImplementation(kind => kind === 'tts')
  const phrases: string[] = []
  vi.spyOn(LocalSpeech.prototype, 'synthesize').mockImplementation(async message => {
    phrases.push(message.text)
    return new ReadableStream({ start(controller) {
      controller.enqueue(Uint8Array.of(1, 0))
      controller.close()
    } })
  })
  const service = new VoiceService({ ctx: { get: () => undefined } as unknown as Context, checkActive() {}, submit: async () => {} })
  const call = await service.open()
  expect(call.output?.model).toBe(BUNDLED_VOICE_MODEL)
  service.attach(call.id, () => {})
  return {
    phrases,
    deliver(id: string, text: string) {
      service.delivered({ id, text })
      return service.speech(call.id, id, new AbortController().signal)[Symbol.asyncIterator]()
    },
    close: () => service.close(),
  }
}

async function drain(speech: AsyncIterator<Uint8Array>) {
  while (!(await speech.next()).done) { /* consume each phrase */ }
}

test('Prime gives a short natural first clause to playback and groups the rest', async () => {
  const f = await openPrime()
  try {
    const first = '嗯？我们可以先看看天色，'
    const text = first + '等雨彻底停下以后再去老街转一圈，然后找一家有热茶的小店歇歇脚，顺便看看那边还有没有开门。'.repeat(4)
    const speech = f.deliver('clauses', text)
    expect((await speech.next()).value).toEqual(Uint8Array.of(1, 0))
    expect(f.phrases).toEqual([first])
    await drain(speech)
    expect(f.phrases.join('')).toBe(text)
    expect(f.phrases.slice(1, -1).every(phrase => phrase.length >= 36 && phrase.length <= 60)).toBe(true)
  } finally { f.close() }
})

test('Prime starts unpunctuated Chinese at a word boundary and retains supplementary characters', async () => {
  const f = await openPrime()
  try {
    const text = '这句话没有标点我们依然应该尽快读出一小段自然的话'.repeat(28) + '𠮷'
    await drain(f.deliver('chinese', text))
    expect(f.phrases[0]).toBe('这句话没有标点我们依然应该尽快读出')
    expect(f.phrases.join('')).toBe(text)
    expect(f.phrases.at(-1)).toMatch(/𠮷$/u)
    expect(f.phrases.every(phrase => !/[\uD800-\uDFFF]/u.test(phrase))).toBe(true)
  } finally { f.close() }
})

test('Prime keeps English words, dotted abbreviations, addresses, versions and number groups together', async () => {
  const f = await openPrime()
  try {
    const text = '先给 alexander.smith+qa@example.com 写邮件。Then verify v10.24.3-beta and the U.S. API documentation at 12:34，金额是 1,234.50。'
    await drain(f.deliver('mixed', text))
    expect(f.phrases.join('')).toBe(text)
    for (const atom of ['alexander.smith+qa@example.com', 'verify', 'v10.24.3-beta', 'U.S.', 'API', 'documentation', '12:34', '1,234.50']) {
      expect(f.phrases.some(phrase => phrase.includes(atom)), atom).toBe(true)
    }
    expect(f.phrases[0]).toBe('先给 alexander.smith+qa@example.com')
  } finally { f.close() }
})

test('Prime bounds pathological unbroken tokens and can speak immediately after a silent message', async () => {
  const f = await openPrime()
  try {
    await drain(f.deliver('silent', '🙂🎉……！？'))
    expect(f.phrases).toEqual([])
    const text = 'A'.repeat(713) + '，现在继续。！'
    await drain(f.deliver('unbroken', text))
    expect(f.phrases.join('')).toBe(text)
    expect(f.phrases.every(phrase => phrase.length <= 256)).toBe(true)
  } finally { f.close() }
})
