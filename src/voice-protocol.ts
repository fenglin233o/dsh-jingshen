export const VOICE_PATH = '/personal-spirit/api/voice'
export const RECORD_RATE = 16_000
export const PLAY_RATE = 24_000
export const BUNDLED_VOICE_MODEL = 'jingshen-light'
export const MAX_UTTERANCE_SECONDS = 25
export const MAX_WAV_BYTES = 44 + RECORD_RATE * 2 * MAX_UTTERANCE_SECONDS

export type VoiceTone = 'neutral' | 'warm' | 'serious' | 'gentle' | 'playful'
export type VoiceLanguage = 'zh' | 'en'
export type SpeechLanguage = VoiceLanguage | 'mixed'
export function speechLanguage(text: string): SpeechLanguage {
  const latin = /\p{Script=Latin}/u.test(text)
  if (/\p{Script=Han}/u.test(text)) return latin ? 'mixed' : 'zh'
  return latin ? 'en' : 'zh'
}
export interface VoiceMessage { id: string; text: string; tone?: VoiceTone }
export interface VoiceDelivery extends VoiceMessage { sequence: number }
export interface VoiceAvailability {
  input: { name: string; location: 'host-local' | 'cloud' } | null
  output: { name: string; model: string; voice: string; location: 'host-local' | 'cloud'; provider?: 'breezeblue' } | null
  setup?: { kind: 'breeze-key' }
  active: boolean
}
export type VoiceEvent =
  | { type: 'ready' | 'heartbeat' }
  | { type: 'closed'; reason: string }
  | { type: 'speech'; message: VoiceDelivery }
