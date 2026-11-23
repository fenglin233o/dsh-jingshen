import type { Context } from '@deepseek-ai/cordis'
import { speechLanguage, type VoiceLanguage, type VoiceMessage, type VoiceTone } from './voice-protocol.ts'

export const BREEZE_MODEL = 'breeze-tts-2'
export const BREEZE_VOICE = 'voc_8yud7hz7c9q2'
const multilingualModel = 'breeze-tts-2-multilingual'
const endpoint = `https://api.breeze.blue/v1/text-to-speech/${BREEZE_VOICE}/stream?output_format=pcm&enable_logging=false`
const credential = 'BREEZE_API_KEY'
const delivery: Record<VoiceLanguage, Record<Exclude<VoiceTone, 'neutral'>, string>> = {
  zh: {
    gentle: '放轻声音，语气柔和。',
    warm: '带着温暖的语气，像和熟悉的朋友说话。',
    serious: '语气认真，重音清楚。',
    playful: '带一点笑意，语气轻快俏皮。',
  },
  en: {
    gentle: 'Keep your voice soft and gentle.',
    warm: 'Speak warmly, as if talking to a close friend.',
    serious: 'Speak seriously and emphasize the important words clearly.',
    playful: 'Speak lightly and playfully, with a smile in your voice.',
  },
}

interface Credentials {
  resolve(ref: string): Promise<{ value: string } | undefined>
}

function validKey(value: string | undefined): string | undefined {
  const key = value?.trim()
  return key && /^[\x21-\x7e]+$/u.test(key) ? key : undefined
}

export async function breezeKey(ctx: Context, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  try {
    const service = ctx.get('credentials') as Credentials | undefined
    const key = validKey((await service?.resolve(credential))?.value)
    if (key) return key
  } catch { /* The host environment still works when the credential service is unavailable. */ }
  return validKey(env.BREEZE_API_KEY)
}

const failureReason: Readonly<Record<number, string>> = {
  401: 'API Key 无效，请检查或更新密钥',
  402: '余额或 API Key 的额度不足',
  403: 'API Key 没有使用该音色的权限',
  404: '找不到所选音色',
  429: '请求过多或达到并发限制，请稍后再试',
  503: '服务暂时不可用，请稍后再试',
  504: '服务生成超时，请稍后再试',
}

function transportError(source: AbortSignal, request: AbortSignal): never {
  source.throwIfAborted()
  if (request.aborted) throw new Error('BreezeBlue 语音请求超时')
  throw new Error('BreezeBlue 语音连接失败或音频流中断')
}

function pcmStream(body: ReadableStream<Uint8Array>, source: AbortSignal, request: AbortSignal): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let bytes = 0
  return new ReadableStream({
    async pull(controller) {
      let frame: ReadableStreamReadResult<Uint8Array>
      try {
        request.throwIfAborted()
        frame = await reader.read()
        request.throwIfAborted()
      } catch {
        void reader.cancel().catch(() => {})
        reader.releaseLock()
        transportError(source, request)
      }
      if (frame.done) {
        reader.releaseLock()
        if (!bytes || bytes % 2) throw new Error('BreezeBlue 返回了不完整的 24 kHz PCM 音频')
        controller.close()
      } else {
        bytes += frame.value.byteLength
        controller.enqueue(frame.value)
      }
    },
    async cancel() {
      try { await reader.cancel() } catch { /* A disconnected upstream is already closed. */ }
      finally { reader.releaseLock() }
    },
  }, { highWaterMark: 0 })
}

export async function streamBreeze(key: string, message: VoiceMessage, signal: AbortSignal,
  language = speechLanguage(message.text)): Promise<ReadableStream<Uint8Array>> {
  signal.throwIfAborted()
  const request = AbortSignal.any([signal, AbortSignal.timeout(90_000)])
  const tone = message.tone && message.tone !== 'neutral' ? message.tone : undefined
  const mixed = language === 'mixed'
  const instructions = tone && (mixed ? `${delivery.zh[tone]} ${delivery.en[tone]}` : delivery[language][tone])
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST', signal: request, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'audio/pcm', 'xi-api-key': key },
      body: JSON.stringify({ text: message.text, model_id: mixed ? multilingualModel : BREEZE_MODEL,
        language_code: mixed ? undefined : language, instructions }),
    })
  } catch { transportError(signal, request) }
  if (!response.ok || response.redirected) {
    void response.body?.cancel().catch(() => {})
    const reason = failureReason[response.status] ?? '未能生成声音'
    throw new Error(`BreezeBlue ${reason}（HTTP ${response.status}）`)
  }
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (!response.body || type !== 'audio/pcm') {
    void response.body?.cancel().catch(() => {})
    throw new Error('BreezeBlue 未返回 24 kHz PCM 音频')
  }
  return pcmStream(response.body, signal, request)
}
