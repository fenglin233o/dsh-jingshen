'use strict'

const { createRequire } = require('node:module')

let engine
const loadAddon = createRequire(__filename)

async function synthesis(directory) {
  const { loadOrt } = require('./ort.cjs')
  const { createPrime } = require('./prime.cjs')
  const { encodeCallPcm } = require('./pcm.cjs')
  const prime = await createPrime(directory, await loadOrt())
  return async ({ text, speed, voice }) => {
    const { samples, sampleRate } = await prime.synthesize(voice, text, speed)
    if (!(samples instanceof Float32Array) || sampleRate !== 16000) throw new Error('本机语音合成返回了无效的采样格式')
    return encodeCallPcm(samples)
  }
}

function recognition(addon, directory) {
  const { createRecognizer, recognize } = require('./recognize.cjs')
  const recognizer = createRecognizer(loadAddon(addon), directory)
  return ({ wav }) => recognize(recognizer, wav)
}

process.once('disconnect', () => process.exit(0))
process.on('message', async ({ id, init, input }) => {
  try {
    engine ??= init.kind === 'tts' ? await synthesis(init.directory) : recognition(init.addon, init.directory)
    const result = await engine(input)
    process.send({ id, result }, () => {})
  } catch (error) {
    process.send({ id, error: error instanceof Error ? error.message : String(error) }, () => {})
  }
})
