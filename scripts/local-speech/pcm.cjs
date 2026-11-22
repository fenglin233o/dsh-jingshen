'use strict'

// Prime yields 16 kHz. Interpolate at phases 0, 1/3, and 2/3 for the
// 24 kHz call protocol, filtering out the images above the source Nyquist.
const taps = 32
const cutoff = 0.475
const phases = [0, 1 / 3, 2 / 3].map(phase => {
  const weights = new Float64Array(taps * 2)
  let sum = 0
  for (let i = 0; i < weights.length; i++) {
    const x = i - taps + 1 - phase
    const window = (1 + Math.cos(Math.PI * x / taps)) / 2
    const lowPass = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)
    weights[i] = lowPass * window
    sum += weights[i]
  }
  return weights.map(weight => weight / sum)
})

function encodeCallPcm(samples) {
  const count = Math.round(samples.length * 1.5)
  const pcm = Buffer.alloc(count * 2)
  for (let i = 0; i < count; i++) {
    const position = i * 2
    const weights = phases[position % 3]
    const first = Math.floor(position / 3) - taps + 1
    let sample = 0
    for (let tap = Math.max(0, -first); tap < Math.min(weights.length, samples.length - first); tap++) {
      sample += samples[first + tap] * weights[tap]
    }
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(32767 / 32768, sample)) * 32768), i * 2)
  }
  return pcm
}

module.exports = { encodeCallPcm }
