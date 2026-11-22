import type { Context } from '@deepseek-ai/cordis'
import { PLAY_RATE, type VoiceAvailability, type VoiceMessage } from './voice-protocol.ts'

interface SpeechRegistry {
  snapshot(): {
    selection: { providerId: string; language: string }
    providers: readonly { id: string; name: string; location: 'host-local' | 'cloud'; preparation: { phase: string } }[]
  }
  resolve(input: { audio: Uint8Array }): unknown
  transcribe(input: unknown, signal: AbortSignal): Promise<{ text: string }>
}
type Endpoint = { url: string; key?: string; location: 'host-local' | 'cloud' }
type Recognition = { info: NonNullable<VoiceAvailability['input']>; transcribe(wav: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string> }
type Synthesis = { info: NonNullable<VoiceAvailability['output']>; stream(message: VoiceMessage, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> }
export interface VoiceProviders { input: Recognition | null; output: Synthesis | null }

const localhost = new Set(['localhost', '127.0.0.1', '[::1]'])
const tone = {
  gentle: { speed: 0.94, instructions: '温柔、清亮，音高自然偏明亮。像平静地和熟悉的人说话，句尾放松。' },
  bright: { speed: 1.05, instructions: '轻快真诚，语调稍有起伏，重点清楚，语速自然。' },
  grounded: { speed: 0.91, instructions: '沉着清楚，遇到事实或分歧略微放慢，留出自然停顿。' },
} as const

export function speechStyle(message: VoiceMessage): { speed: number; instructions: string } {
  const style = message.tone === 'serious' ? tone.grounded
    : message.tone === 'playful' || !message.tone && /[！!]/u.test(message.text) ? tone.bright : tone.gentle
  return { speed: style.speed, instructions: `用自然的普通话演绎原创动画角色的语气。${style.instructions} 按标点自然停顿，避免夸张、卖萌或模仿任何真人。不增加原文以外的内容。` }
}

function endpoint(base: string, key?: string): Endpoint {
  const value = new URL(base)
  if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password || value.search || value.hash) throw new Error('语音服务地址无效')
  return { url: value.href.replace(/\/+$/u, ''), location: localhost.has(value.hostname) ? 'host-local' : 'cloud', key }
}

function remoteFetch(target: Endpoint, route: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const headers = new Headers(init.headers)
  if (target.key) headers.set('authorization', `Bearer ${target.key}`)
  return fetch(`${target.url}/${route}`, { ...init, headers, signal, redirect: 'error' })
}

export class VoiceProviderDiscovery {
  private readonly env: NodeJS.ProcessEnv
  private readonly lifecycle = new AbortController()
  private probe?: { until: number; result: Promise<Endpoint | undefined> }

  constructor(private readonly ctx: Context, env = process.env) { this.env = env }

  private recognition(): Recognition | null {
    const env = this.env
    if (env.SPIRIT_ASR_BASE_URL) {
      const target = endpoint(env.SPIRIT_ASR_BASE_URL, env.SPIRIT_ASR_API_KEY)
      return {
        info: { name: 'OpenAI 兼容语音转写', location: target.location },
        transcribe: async (wav, signal) => {
          const form = new FormData()
          form.set('file', new Blob([wav], { type: 'audio/wav' }), 'spirit.wav')
          form.set('model', env.SPIRIT_ASR_MODEL ?? 'whisper-1')
          if (env.SPIRIT_ASR_LANGUAGE !== 'auto') form.set('language', env.SPIRIT_ASR_LANGUAGE ?? 'zh')
          const result = await remoteFetch(target, 'audio/transcriptions', { method: 'POST', body: form },
            AbortSignal.any([signal, AbortSignal.timeout(45_000)]))
          if (!result.ok) { await result.body?.cancel(); throw new Error(`语音转写服务未接受请求（HTTP ${result.status}）`) }
          const data = await result.json() as { text?: unknown }
          if (typeof data.text !== 'string') throw new Error('语音转写服务返回了无效文本')
          return data.text
        },
      }
    }
    const registry = this.ctx.get('speechToText') as SpeechRegistry | undefined
    const snapshot = registry?.snapshot()
    const current = snapshot?.providers.find(provider => provider.id === snapshot.selection.providerId)
    if (!registry || !current || !['ready', 'standby', 'waking'].includes(current.preparation.phase)) return null
    return {
      info: { name: current.name, location: current.location },
      transcribe: async (audio, signal) => (await registry.transcribe(registry.resolve({ audio }), signal)).text,
    }
  }

  private localKokoro(): Promise<Endpoint | undefined> {
    if (this.env.SPIRIT_TTS_LOCAL_PROBE === '0') return Promise.resolve(undefined)
    if (this.probe && this.probe.until > Date.now()) return this.probe.result
    const target = endpoint('http://127.0.0.1:8880/v1')
    const result = remoteFetch(target, 'models', {}, AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(750)]))
      .then(async response => {
        if (!response.ok) { await response.body?.cancel(); return undefined }
        const models = await response.json() as { data?: { id?: string }[] }
        return models.data?.some(item => item.id?.toLowerCase().includes('kokoro')) ? target : undefined
      }).catch(() => undefined)
    this.probe = { until: Date.now() + 15_000, result }
    return result
  }

  async detect(): Promise<VoiceProviders> {
    const env = this.env
    this.lifecycle.signal.throwIfAborted()
    const input = this.recognition()
    const inferredOpenAI = !env.SPIRIT_TTS_BASE_URL && !!env.SPIRIT_TTS_API_KEY
    const target = env.SPIRIT_TTS_BASE_URL ? endpoint(env.SPIRIT_TTS_BASE_URL, env.SPIRIT_TTS_API_KEY)
      : inferredOpenAI ? endpoint('https://api.openai.com/v1', env.SPIRIT_TTS_API_KEY) : await this.localKokoro()
    if (!target) return { input, output: null }
    const officialOpenAI = inferredOpenAI || new URL(target.url).hostname === 'api.openai.com'
    const model = env.SPIRIT_TTS_MODEL ?? (officialOpenAI ? 'gpt-4o-mini-tts' : 'kokoro')
    const kokoro = /kokoro/iu.test(model)
    const voice = env.SPIRIT_TTS_VOICE ?? (kokoro ? 'zf_xiaobei' : 'marin')
    const expressive = env.SPIRIT_TTS_STYLE === 'instructions' || (env.SPIRIT_TTS_STYLE !== 'pace' && model.includes('mini-tts'))
    return {
      input,
      output: {
        info: { name: kokoro ? 'Kokoro 神经语音' : officialOpenAI ? 'OpenAI 神经语音' : '配置的语音合成服务', location: target.location },
        stream: async (message, signal) => {
          const style = speechStyle(message)
          const result = await remoteFetch(target, 'audio/speech', {
            method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/octet-stream' },
            body: JSON.stringify({ model, input: message.text, voice, response_format: 'pcm',
              ...(expressive ? { instructions: style.instructions } : { speed: style.speed }) }),
          }, AbortSignal.any([signal, AbortSignal.timeout(90_000)]))
          const type = result.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
          if (!result.ok || !result.body || !type || !['audio/pcm', 'audio/l16', 'audio/raw', 'application/octet-stream'].includes(type)) {
            await result.body?.cancel()
            throw new Error(`语音合成服务没有返回 ${PLAY_RATE}Hz PCM 音频（HTTP ${result.status}）`)
          }
          return result.body
        },
      },
    }
  }

  close(): void { this.lifecycle.abort() }
}
