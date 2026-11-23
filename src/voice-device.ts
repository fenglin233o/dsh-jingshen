import type { VoiceLanguage, VoiceMessage } from './voice-protocol.ts'

function mandarinRank(language: string): number {
  const tag = language.toLowerCase().replaceAll('_', '-')
  if (/^(zh|cmn)(?:-hans)?-cn(?:-|$)/u.test(tag)) return 2
  if (/^cmn(?:-|$)|^zh-cmn(?:-|$)|^zh(?:-(?:hans|hant|tw|sg)(?:-(?:cn|tw|sg))?)?$/u.test(tag)) return 1
  return 0
}

export function localVoice(voices: readonly SpeechSynthesisVoice[], language: VoiceLanguage): SpeechSynthesisVoice | undefined {
  let best: SpeechSynthesisVoice | undefined
  let priority = 0
  for (const voice of voices) {
    if (voice.localService !== true) continue
    const rank = language === 'zh' ? mandarinRank(voice.lang) : Number(/^en(?:[-_]|$)/iu.test(voice.lang))
    if (!rank) continue
    const candidate = rank * 2 + Number(voice.default)
    if (candidate > priority) { best = voice; priority = candidate }
  }
  return best
}

export function deviceVoice(language?: VoiceLanguage): SpeechSynthesisVoice | undefined {
  if (typeof window.SpeechSynthesisUtterance !== 'function') return
  const voices = window.speechSynthesis?.getVoices() ?? []
  return language ? localVoice(voices, language) : localVoice(voices, 'zh') ?? localVoice(voices, 'en')
}

export function* devicePhrases(text: string): Iterable<{ text: string; language?: VoiceLanguage }> {
  let language: VoiceLanguage | undefined
  let start = 0
  for (const match of text.matchAll(/\p{Script=Han}+|\p{Script=Latin}+/gu)) {
    const next = /\p{Script=Han}/u.test(match[0]) ? 'zh' : 'en'
    if (language && language !== next) {
      yield { text: text.slice(start, match.index), language }
      start = match.index
    }
    language = next
  }
  if (start < text.length) yield { text: text.slice(start), language }
}

export async function speakOnDevice(message: VoiceMessage, voice: SpeechSynthesisVoice, signal: AbortSignal, started: () => void): Promise<void> {
  signal.throwIfAborted()
  const synth = window.speechSynthesis
  const selected = synth?.getVoices().find(candidate => candidate.localService === true
    && candidate.voiceURI === voice.voiceURI && candidate.lang === voice.lang)
  if (!selected) throw new Error('设备本机声线已不可用')
  await new Promise<void>((resolve, reject) => {
    const speech = new SpeechSynthesisUtterance(message.text)
    speech.lang = selected.lang
    speech.voice = selected
    speech.rate = message.tone === 'playful' ? 1.03 : message.tone === 'serious' ? 0.88 : 0.94
    speech.pitch = message.tone === 'playful' ? 1.08 : 1.02
    // Some engines deliver neither a start nor an error on loss of the device.
    let timer = setTimeout(() => cancel(new Error('设备朗读没有开始')), 8_000)
    function finish(error?: unknown): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      speech.onstart = null
      speech.onend = null
      speech.onerror = null
      if (error === undefined) resolve(); else reject(error)
    }
    function cancel(error: unknown): void {
      finish(error)
      synth.cancel()
    }
    const abort = () => cancel(signal.reason)
    speech.onstart = () => {
      clearTimeout(timer)
      timer = setTimeout(() => cancel(new Error('设备朗读已超时')), Math.max(30_000, message.text.length * 1_000))
      started()
    }
    speech.onend = () => finish()
    speech.onerror = () => finish(new Error('设备朗读失败'))
    signal.addEventListener('abort', abort, { once: true })
    try { synth.speak(speech) } catch (error) { finish(error) }
  })
}
