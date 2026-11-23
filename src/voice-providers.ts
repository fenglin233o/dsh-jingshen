import type { Context } from '@deepseek-ai/cordis'
import { BREEZE_MODEL, BREEZE_VOICE, breezeKey, streamBreeze } from './breeze-voice.ts'
import { BUNDLED_VOICE_MODEL, PLAY_RATE, speechLanguage, type SpeechLanguage, type VoiceAvailability, type VoiceMessage } from './voice-protocol.ts'
import { LocalSpeech } from './local-speech.ts'

interface SpeechRegistry {
  snapshot(): {
    selection: { providerId: string; language: string }
    providers: readonly { id: string; name: string; location: 'host-local' | 'cloud'; languages: readonly string[]; preparation: { phase: string } }[]
  }
  resolve(input: { audio: Uint8Array; providerId: string; language?: string }): unknown
  transcribe(input: unknown, signal: AbortSignal): Promise<{ text: string }>
}
type Endpoint = { url: string; key?: string; location: 'host-local' | 'cloud' }
type ListedModel = { id?: string; family?: string; task?: string; mode?: string }
type Recognition = { info: NonNullable<VoiceAvailability['input']>; transcribe(wav: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string> }
type Synthesis = { info: NonNullable<VoiceAvailability['output']>; stream(message: VoiceMessage, signal: AbortSignal, language?: SpeechLanguage): Promise<ReadableStream<Uint8Array>> }
export interface VoiceProviders {
  input: Recognition | null
  output: Synthesis | null
  setup?: { kind: 'breeze-key' }
}

const characterModel = 'jingshen-character'
const characterUrl = 'http://127.0.0.1:8891/v1'
const kokoroUrl = 'http://127.0.0.1:8880/v1'
const audioCppUrl = 'http://127.0.0.1:8080/v1'
const localhost = new Set(['localhost', '127.0.0.1', '[::1]'])
const pcmTypes = ['audio/pcm', 'audio/l16', 'audio/raw', 'application/octet-stream']
const tone = {
  gentle: { speed: 0.99, zh: '像在和身边的朋友说悄悄话，温柔里带一点好奇，问句末尾轻轻扬起。', en: 'Speak softly, with warmth and a little curiosity.' },
  bright: { speed: 1.06, zh: '发现有趣的事时笑意透出来，重音灵巧，有轻有重。', en: 'Let a smile come through, with light and expressive emphasis.' },
  grounded: { speed: 0.95, zh: '认真解释时稍慢，仍用同一个清亮的小嗓音，停顿从容。', en: 'Slow down a little and pause naturally when explaining something.' },
} as const
const audioCppDirections = {
  zh: { neutral: '', warm: '语气温暖舒展。', gentle: '语气柔和，停顿自然。', serious: '语气认真，重音清楚。', playful: '音调轻快，重音灵巧。' },
  en: { neutral: '', warm: ' Use a warm, relaxed tone.', gentle: ' Speak softly and pause naturally.',
    serious: ' Speak seriously with clear emphasis.', playful: ' Use a light, playful tone.' },
} as const
const audioCppScripts = {
  zh: '沿用参考声线，自然朗读原文。',
  en: 'Read the original English text naturally in the reference voice.',
  mixed: 'Read the Mandarin and English phrases naturally in the reference voice, keeping their original wording and order.',
} as const

export function speechStyle(message: VoiceMessage, language = speechLanguage(message.text)): { speed: number; instructions: string } {
  const style = message.tone === 'serious' ? tone.grounded
    : message.tone === 'playful' || !message.tone && /[！!]/u.test(message.text) ? tone.bright : tone.gentle
  const instructions = language === 'zh'
    ? `用自然的普通话演绎小肥鱼，一位聪慧、带稚气的动画女孩。嗓音清透偏高，发音轻巧，像近距离对话。${style.zh} 保持原文，在意群之间换气。`
    : `Speak naturally in ${language === 'mixed' ? 'both Mandarin and English' : 'English'} as Xiaoyu, a bright animated girl with a clear, light voice. ${style.en} Keep the original wording and pause between phrases.`
  return { speed: style.speed, instructions }
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

async function streamPcm(target: Endpoint, request: object, signal: AbortSignal, types = pcmTypes): Promise<ReadableStream<Uint8Array>> {
  const result = await remoteFetch(target, 'audio/speech', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/octet-stream' },
    body: JSON.stringify(request),
  }, AbortSignal.any([signal, AbortSignal.timeout(90_000)]))
  const type = result.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (!result.ok || !result.body || !type || !types.includes(type)) {
    await result.body?.cancel()
    throw new Error(`语音合成服务没有返回 ${PLAY_RATE}Hz PCM 音频（HTTP ${result.status}）`)
  }
  return result.body
}

// Select a whole provider configuration together. A new URL must never inherit
// a credential supplied for the old provider's URL.
function providerSettings(env: NodeJS.ProcessEnv, group: 'ASR' | 'TTS'): NodeJS.ProcessEnv {
  const current = `JINGSHEN_${group}_`
  const prefix = Object.keys(env).some(key => key.startsWith(current)) ? current : `SPIRIT_${group}_`
  return Object.fromEntries(Object.entries(env)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => [key.slice(prefix.length), value]))
}

export class VoiceProviderDiscovery {
  private readonly env: NodeJS.ProcessEnv
  private readonly lifecycle = new AbortController()
  private readonly bundled = new LocalSpeech()
  private probe?: { target: Endpoint; selection: string; until: number; result: Promise<Endpoint | undefined> }

  constructor(private readonly ctx: Context, env = process.env) { this.env = env }

  private recognition(): Recognition | null {
    const env = providerSettings(this.env, 'ASR')
    if (env.BASE_URL) {
      const target = endpoint(env.BASE_URL, env.API_KEY)
      return {
        info: { name: 'OpenAI 兼容语音转写', location: target.location },
        transcribe: async (wav, signal) => {
          const form = new FormData()
          form.set('file', new Blob([wav], { type: 'audio/wav' }), 'jingshen.wav')
          form.set('model', env.MODEL ?? 'whisper-1')
          if (env.LANGUAGE && env.LANGUAGE !== 'auto') form.set('language', env.LANGUAGE)
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
    if (registry && current?.location === 'host-local'
      && ['auto', 'zh', 'en'].every(hint => current.languages?.includes(hint))
      && ['ready', 'standby', 'waking'].includes(current.preparation.phase)) {
      return {
        info: { name: current.name, location: current.location },
        transcribe: async (audio, signal) => (await registry.transcribe(registry.resolve({ audio, providerId: current.id, language: 'auto' }), signal)).text,
      }
    }
    return this.bundled.available('asr') ? {
      info: { name: '随包中英语音识别', location: 'host-local' },
      transcribe: (wav, signal) => this.bundled.transcribe(wav, signal),
    } : null
  }

  private localSynthesis(kokoroRequested: boolean): Promise<Endpoint | undefined> {
    if (providerSettings(this.env, 'TTS').LOCAL_PROBE === '0') return Promise.resolve(undefined)
    const target = endpoint(kokoroRequested ? kokoroUrl : characterUrl)
    return this.probeSynthesis(target, kokoroRequested ? 'kokoro' : characterModel,
      item => kokoroRequested ? !!item.id?.toLowerCase().includes('kokoro') : item.id === characterModel)
  }

  private probeSynthesis(target: Endpoint, selection: string, matches: (item: ListedModel) => boolean): Promise<Endpoint | undefined> {
    if (this.probe?.target.url === target.url && this.probe.target.key === target.key
      && this.probe.selection === selection && this.probe.until > Date.now()) return this.probe.result
    const result = remoteFetch(target, 'models', {}, AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(750)]))
      .then(async response => {
        if (!response.ok) { await response.body?.cancel(); return undefined }
        const models = await response.json() as { data?: ListedModel[] }
        return models.data?.some(matches) ? target : undefined
      }).catch(() => undefined)
    this.probe = { target, selection, until: Date.now() + 3_000, result }
    return result
  }

  private async audioCppSynthesis(): Promise<Synthesis | null> {
    const env = providerSettings(this.env, 'TTS')
    const address = env.BASE_URL
    const target = endpoint(address || audioCppUrl, address ? env.API_KEY : undefined)
    const model = env.MODEL ?? 'breeze', voice = env.VOICE ?? 'xiaoyu'
    // The v0.9.6 raw stream has no sample-rate or channel header. The advertised
    // Breeze streaming model supplies 24 kHz mono, unlike arbitrary model aliases.
    const confirmed = await this.probeSynthesis(target, `audiocpp:${model}`, item => item.id === model
      && item.family === 'breeze_tts' && item.task === 'tts' && item.mode === 'streaming')
    if (!confirmed) return null
    return {
      info: { name: `BreezeTTS 2 · ${voice}`, model, voice, location: confirmed.location },
      stream: (message, signal, language = speechLanguage(message.text)) => streamPcm(confirmed, {
        model, input: message.text, voice, response_format: 'pcm', stream_format: 'audio',
        options: { instruct: audioCppScripts[language] + audioCppDirections[language === 'zh' ? 'zh' : 'en'][message.tone ?? 'neutral'] },
      }, signal, ['application/octet-stream']),
    }
  }

  private async breeze(input: Recognition | null): Promise<VoiceProviders> {
    const keyConfigured = !!await breezeKey(this.ctx, this.env)
    this.lifecycle.signal.throwIfAborted()
    if (!keyConfigured) return { input, output: null, setup: { kind: 'breeze-key' } }
    return {
      input,
      output: {
        info: { name: '大肥鱼·迷糊版', provider: 'breezeblue', model: BREEZE_MODEL, voice: BREEZE_VOICE, location: 'cloud' },
        stream: async (message, signal, language) => {
          const caller = AbortSignal.any([signal, this.lifecycle.signal])
          caller.throwIfAborted()
          const key = await breezeKey(this.ctx, this.env)
          caller.throwIfAborted()
          if (!key) throw new Error('请先设置 BreezeBlue API Key')
          return streamBreeze(key, message, caller, language)
        },
      },
    }
  }

  async detect(): Promise<VoiceProviders> {
    const env = providerSettings(this.env, 'TTS')
    this.lifecycle.signal.throwIfAborted()
    const input = this.recognition()
    if (env.PROTOCOL === 'breezeblue') return this.breeze(input)
    if (env.PROTOCOL === 'audiocpp') return { input, output: await this.audioCppSynthesis() }
    const kokoroRequested = /kokoro/iu.test(env.MODEL ?? '') || (!env.MODEL && /^[a-z][fm]_/iu.test(env.VOICE ?? ''))
    const openai = env.PROTOCOL === 'openai' || /^(gpt-4o-mini-tts|tts-1|tts-1-hd)$/u.test(env.MODEL ?? '')
    const address = env.BASE_URL || (openai ? 'https://api.openai.com/v1' : undefined)
    if (!address && !env.MODEL && !kokoroRequested) return this.breeze(input)
    if (!address && env.MODEL === BUNDLED_VOICE_MODEL) {
      const output: Synthesis | null = this.bundled.available('tts') ? {
        info: { name: '小肥鱼 · 轻声普通话', model: BUNDLED_VOICE_MODEL, voice: 'xiaoyu', location: 'host-local' },
        stream: (message, signal) => this.bundled.synthesize({ text: message.text,
          speed: message.tone === 'serious' ? 0.95 : message.tone === 'playful' ? 1.04 : 1 }, signal),
      } : null
      return { input, output }
    }
    if (!address && !kokoroRequested && env.MODEL !== characterModel) return { input, output: null }
    const target = address ? endpoint(address, env.API_KEY)
      : await this.localSynthesis(kokoroRequested)
    if (!target) return { input, output: null }
    const url = new URL(target.url)
    const officialOpenAI = url.hostname === 'api.openai.com'
    const isCharacterEndpoint = target.location === 'host-local' && url.port === '8891'
    const model = env.MODEL ?? (officialOpenAI ? 'gpt-4o-mini-tts' : isCharacterEndpoint ? characterModel : 'kokoro')
    const character = model === characterModel
    const kokoro = /kokoro/iu.test(model)
    const voice = env.VOICE ?? (character ? 'xiaoyu' : kokoro ? 'zf_xiaobei' : 'marin')
    const expressive = !character && (env.STYLE === 'instructions' || (env.STYLE !== 'pace' && model.includes('mini-tts')))
    const name = character && voice === 'xiaoyu' ? '小肥鱼 · 中文动画少女声'
      : `${kokoro ? 'Kokoro' : officialOpenAI ? 'OpenAI' : model} · ${voice}`
    return {
      input,
      output: {
        info: { name, model, voice, location: target.location },
        stream: (message, signal, language) => {
          const style = speechStyle(message, language)
          return streamPcm(target, {
            model, input: message.text, voice, response_format: 'pcm',
            ...(expressive ? { instructions: style.instructions } : { speed: style.speed }),
          }, signal)
        },
      },
    }
  }

  close(): void { this.lifecycle.abort(); this.bundled.close() }
}
