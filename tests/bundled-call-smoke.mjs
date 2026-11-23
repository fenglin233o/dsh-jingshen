// Run from a source checkout with dependencies and the local voice assets:
// node --experimental-transform-types tests/bundled-call-smoke.mjs
import assert from 'node:assert/strict'
import { VoiceService } from '../src/voice-service.ts'

const text = process.argv[2] || '嗯，你说，我在听。刚才有点走神了，你接着说呀。'
for (const key of Object.keys(process.env)) {
  if (key.startsWith('SPIRIT_TTS_') || key.startsWith('SPIRIT_ASR_')) delete process.env[key]
}
process.env.SPIRIT_TTS_MODEL = 'jingshen-light'
const service = new VoiceService({ ctx: { get: () => undefined }, checkActive() {}, async submit() {} })
const signal = AbortSignal.timeout(120_000)
try {
  const call = await service.open()
  assert.equal(call.output?.model, 'jingshen-light')
  service.attach(call.id, () => {})
  const runs = []
  for (const id of ['cold', 'warm']) {
    const start = performance.now()
    service.delivered({ id, text })
    let firstMs, lastMs, bytes = 0, peak = 0
    for await (const part of service.speech(call.id, id, signal)) {
      lastMs = Math.round(performance.now() - start)
      firstMs ??= lastMs
      const pcm = Buffer.from(part.buffer, part.byteOffset, part.byteLength)
      assert.equal(pcm.length % 2, 0)
      for (let offset = 0; offset < pcm.length; offset += 2) {
        peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)))
      }
      bytes += pcm.length
    }
    assert.ok(bytes && peak > 32, 'Expected synthesized, non-silent speech')
    runs.push({ id, firstPcmMs: firstMs, lastPcmMs: lastMs, audioSeconds: bytes / 48_000 })
  }
  console.log(JSON.stringify({ text, provider: call.output, measurements: runs }, null, 2))
} finally {
  service.close()
}
