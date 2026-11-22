import type { VoiceMessage } from './voice-protocol.ts'

function mandarinRank(language: string): number {
  const tag = language.toLowerCase().replaceAll('_', '-')
  if (/^(zh|cmn)(?:-hans)?-cn(?:-|$)/u.test(tag)) return 2
  if (/^cmn(?:-|$)|^zh-cmn(?:-|$)|^zh(?:-(?:hans|hant|tw|sg)(?:-(?:cn|tw|sg))?)?$/u.test(tag)) return 1
  return 0
}

export function localMandarinVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  let best: SpeechSynthesisVoice | undefined
  let priority = 0
  for (const voice of voices) {
    if (voice.localService !== true) continue
    const rank = mandarinRank(voice.lang)
    if (!rank) continue
    const candidate = rank * 2 + Number(voice.default)
    if (candidate > priority) { best = voice; priority = candidate }
  }
  return best
}

export function deviceVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window.SpeechSynthesisUtterance !== 'function') return
  return localMandarinVoice(window.speechSynthesis?.getVoices() ?? [])
}

export async function speakOnDevice(message: VoiceMessage, voice: SpeechSynthesisVoice, signal: AbortSignal, started: () => void): Promise<void> {
  signal.throwIfAborted()
  const synth = window.speechSynthesis
  const selected = synth?.getVoices().find(candidate => candidate.localService === true && mandarinRank(candidate.lang)
    && candidate.voiceURI === voice.voiceURI && candidate.lang === voice.lang)
  if (!selected) throw new Error('设备中文声线已不可用')
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
    speech.onerror = () => finish(new Error('设备中文朗读失败'))
    signal.addEventListener('abort', abort, { once: true })
    try { synth.speak(speech) } catch (error) { finish(error) }
  })
}
