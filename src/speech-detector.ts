// libfvad consumes 20 ms of signed mono PCM. Keep full-rate microphone samples
// for transcription and use a separate 16 kHz buffer for speech detection.
interface VadModule {
  HEAP16: Int16Array
  _malloc(bytes: number): number
  _free(address: number): void
  _fvad_new(): number
  _fvad_free(instance: number): void
  _fvad_set_sample_rate(instance: number, sampleRate: number): number
  _fvad_set_mode(instance: number, mode: number): number
  _fvad_process(instance: number, samples: number, count: number): number
}

export interface SpeechDetector {
  voiced(frame: Float32Array): boolean
  close(): void
}

let modulePromise: Promise<VadModule> | undefined

export async function createSpeechDetector(): Promise<SpeechDetector> {
  const script = new URL('/personal-spirit/assets/voice/vad/fvad.js', window.location.href)
  modulePromise ??= import(script.href).then(module => module.default({
    locateFile: (file: string) => new URL(file, script).href,
  }) as Promise<VadModule>).catch(error => { modulePromise = undefined; throw error })
  const wasm = await modulePromise
  const instance = wasm._fvad_new()
  const count = 320
  const address = wasm._malloc(count * 2)
  const close = () => {
    if (instance) wasm._fvad_free(instance)
    if (address) wasm._free(address)
  }
  if (!instance || !address || wasm._fvad_set_sample_rate(instance, 16_000) || wasm._fvad_set_mode(instance, 2)) {
    close()
    throw new Error('无法初始化人声检测')
  }
  return {
    close,
    voiced(frame) {
      const samples = wasm.HEAP16.subarray(address / 2, address / 2 + count)
      for (let i = 0; i < count; i++) {
        const start = Math.floor(i * frame.length / count)
        const end = Math.max(start + 1, Math.floor((i + 1) * frame.length / count))
        let sum = 0
        for (let j = start; j < end; j++) sum += frame[j]!
        samples[i] = Math.round(Math.max(-1, Math.min(1, sum / (end - start))) * 32767)
      }
      return wasm._fvad_process(instance, address, count) === 1
    },
  }
}
