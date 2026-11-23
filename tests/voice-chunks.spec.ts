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
  vi.stubEnv('SPIRIT_TTS_MODEL', BUNDLED_VOICE_MODEL)
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
    phrases, service, call,
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

test('unplayed deliveries survive a burst across the old history limit and retire after playback', async () => {
  const f = await openPrime()
  try {
    const replies = Array.from({ length: 40 }, (_, index) => ({ id: String(index), text: `消息 ${index}` }))
    for (const reply of replies) f.service.delivered(reply)
    for (const { id } of replies) {
      await drain(f.service.speech(f.call.id, id, new AbortController().signal)[Symbol.asyncIterator]())
      f.service.playing(f.call.id, id, false)
    }
    expect(f.phrases).toEqual(replies.map(reply => reply.text))
    await expect(f.service.speech(f.call.id, '0', new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow()
  } finally { f.close() }
})

test('a client that never retires deliveries receives an explicit close at the backlog limit', async () => {
  const f = await openPrime()
  try {
    const call = await f.service.open()
    const closed: string[] = []
    f.service.attach(call.id, event => { if (event.type === 'closed') closed.push(event.reason) })
    const text = '字'.repeat(100_000)
    for (let index = 0; index < 45; index++) f.service.delivered({ id: String(index), text })
    expect(closed).toEqual(['待朗读消息过多，通话已挂断'])
  } finally { f.close() }
})

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
    expect(f.phrases[1]?.length).toBeLessThanOrEqual(21)
    expect(f.phrases[2]?.length).toBeLessThanOrEqual(32)
    expect(f.phrases.slice(3, -1).every(phrase => phrase.length >= 31 && phrase.length <= 52)).toBe(true)
  } finally { f.close() }
})

test('Prime stages the phrases that follow the first audio instead of synthesizing a long second block', async () => {
  const f = await openPrime()
  try {
    const text = '我们先把正在做的事情理顺，再一起选出今天最值得完成的一步。如果手边还有几件事没有想清楚，也可以先在这里停一会儿，把问题说具体。等你准备好，我们就从你最关心的那件事开始。'
    await drain(f.deliver('staged', text))
    expect(f.phrases.slice(0, 2)).toEqual(['我们先把正在做的事情理顺，', '再一起选出今天最值得完成的一步。'])
    expect(f.phrases[2]?.length).toBeLessThanOrEqual(32)
    expect(f.phrases.join('')).toBe(text)
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

async function openBreeze() {
  for (const key of ['SPIRIT_TTS_MODEL', 'SPIRIT_TTS_PROTOCOL', 'SPIRIT_TTS_BASE_URL', 'SPIRIT_ASR_BASE_URL']) vi.stubEnv(key, undefined)
  vi.stubEnv('BREEZE_API_KEY', 'synthetic-test-value')
  vi.spyOn(LocalSpeech.prototype, 'available').mockImplementation(kind => kind === 'asr')
  const requests: { text: string; model_id: string; language_code?: string; signal: AbortSignal }[] = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const { text, model_id, language_code } = JSON.parse(init!.body as string)
    requests.push({ text, model_id, language_code, signal: init!.signal! })
    return new Response(Uint8Array.of(3, 0), { headers: { 'content-type': 'audio/pcm' } })
  })
  const service = new VoiceService({ ctx: { get: () => undefined } as unknown as Context, checkActive() {}, submit: async () => {} })
  expect((await service.availability()).input?.location).toBe('host-local')
  const call = await service.open()
  service.attach(call.id, () => {})
  expect(fetch).not.toHaveBeenCalled()
  return { service, requests,
    speech: (id: string, signal = new AbortController().signal) => service.speech(call.id, id, signal)[Symbol.asyncIterator]() }
}

test('one delivered Breeze reply makes one request even with concurrent and repeated reads', async () => {
  const f = await openBreeze()
  try {
    const text = '雨停了吗？我们一起出去走走吧。'
    await expect(f.speech('reply').next()).rejects.toThrow('播放队列')
    f.service.delivered({ id: 'reply', text })
    await expect(f.speech('reply', AbortSignal.abort()).next()).rejects.toThrow()
    const first = f.speech('reply')
    const opened = first.next()
    await expect(f.speech('reply').next()).rejects.toThrow('已经请求过')
    expect((await opened).value).toEqual(Uint8Array.of(3, 0))
    expect(f.requests[0]?.signal.aborted).toBe(false)
    await drain(first)
    await expect(f.speech('reply').next()).rejects.toThrow('已经请求过')
    expect(f.requests.map(r => r.text)).toEqual([text])
  } finally { f.service.close() }
})

test('long Breeze replies split at natural boundaries within the 1,000 Unicode character limit', async () => {
  const f = await openBreeze()
  try {
    const sentence = '𠮷'.repeat(683) + '。'
    const clause = '夏'.repeat(700) + '，'
    const text = sentence + clause + 'A'.repeat(1050) + '结束。'
    f.service.delivered({ id: 'long', text })
    await drain(f.speech('long'))
    const chunks = f.requests.map(r => r.text)
    expect(chunks.slice(0, 2)).toEqual([sentence, clause])
    expect(chunks.every(chunk => Array.from(chunk).length <= 1000)).toBe(true)
    expect(chunks.join('')).toBe(text)
    expect(f.requests.every(request => request.model_id === 'breeze-tts-2-multilingual' && request.language_code === undefined)).toBe(true)
  } finally { f.service.close() }
})

test('ending a Breeze read stops its upstream and skips subsequent chunks without suppressing new replies', async () => {
  const f = await openBreeze()
  try {
    f.service.delivered({ id: 'long', text: '天地'.repeat(1200) })
    const speech = f.speech('long')
    await speech.next()
    expect(f.requests).toHaveLength(1)
    await speech.return!()
    expect(f.requests[0]!.signal.aborted).toBe(true)
    await expect(f.speech('long').next()).rejects.toThrow('已经请求过')
    f.service.delivered({ id: 'new', text: '从这里接着聊。' })
    await drain(f.speech('new'))
    expect(f.requests.map(r => r.text)).toEqual(['天地'.repeat(500), '从这里接着聊。'])
  } finally { f.service.close() }
})
