export const VOICE_PATH = '/personal-spirit/api/voice'
export const RECORD_RATE = 16_000
export const PLAY_RATE = 24_000
export const MAX_UTTERANCE_SECONDS = 25
export const MAX_WAV_BYTES = 44 + RECORD_RATE * 2 * MAX_UTTERANCE_SECONDS

export type VoiceTone = 'neutral' | 'warm' | 'serious' | 'gentle' | 'playful'
export interface VoiceMessage { id: string; text: string; tone?: VoiceTone }
export interface VoiceDelivery extends VoiceMessage { sequence: number }
export interface VoiceAvailability {
  input: { name: string; location: 'host-local' | 'cloud' } | null
  output: { name: string; model: string; voice: string; location: 'host-local' | 'cloud' } | null
  active: boolean
}
export type VoiceEvent =
  | { type: 'ready' | 'heartbeat' }
  | { type: 'closed'; reason: string }
  | { type: 'speech'; message: VoiceDelivery }
