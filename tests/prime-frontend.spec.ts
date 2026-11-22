import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
type Phone = [id: number, tone: number, language: number, boundary?: boolean]
const { createPrime, normalize, phonemes } = require('../scripts/local-speech/prime.cjs') as {
  normalize(text: string): string
  phonemes(text: string, symbols: Map<string, number>, lexicon: Record<string, string>): Phone[]
  createPrime(directory: string, ort: object): Promise<{
    synthesize(voice: string, text: string): Promise<{ samples: Float32Array; sampleRate: number }>
    close(): Promise<void>
  }>
}
const table = require('../media/voice/local/tts/symbol_table.json') as { symbols: string[] }
const lexicon = require('../media/voice/local/tts/english-pronunciations.json') as Record<string, string>
const symbols = new Map(table.symbols.map((symbol, id) => [symbol, id]))

it.each([
  ['总数1,234,567和100000001、100010001', '总数一百二十三万四千五百六十七和一亿零一,一亿零一万零一'],
  ['Build v2.10.03，-12.50%，07:05:09', 'Build v二点一零点零三,负百分之十二点五零,七点五分九秒'],
  ['2026年09月01日与2026-12-31', '二零二六年九月一日与二零二六年十二月三十一日'],
  ['¥-129.90，-$20.05，-.50', '负一百二十九点九零元,负二十点零五美元,负零点五零'],
  ['工单００１２０３，公式9 - 2', '工单零零一二零三,公式九减二'],
])('normalizes numbers in %s', (input, spoken) => {
  expect(normalize(input)).toBe(spoken)
  expect(phonemes(input, symbols, lexicon)).toEqual(phonemes(spoken, symbols, lexicon))
})

function syllables(text: string): [string, number][] {
  const result: [string, number][] = []
  let sequence = ''
  for (const [id, tone, , boundary] of phonemes(text, symbols, lexicon)) {
    sequence += table.symbols[id]
    if (boundary) {
      result.push([sequence, tone])
      sequence = ''
    }
  }
  return result
}

it('uses context-specific Mandarin pronunciations and keeps conversational syllables', () => {
  expect(syllables('重庆银行的行长')).toEqual([
    ['ㄔㄨㄥ', 2], ['ㄑㄧㄥ', 4], ['ㄧㄣ', 2], ['ㄏㄤ', 2], ['ㄉㄜ', 5], ['ㄏㄤ', 2], ['ㄓㄤ', 3],
  ])
  expect(syllables('你好，嗯，你接着说呀。')).toEqual([
    ['ㄋㄧ', 2], ['ㄏㄠ', 3], [',', 0], ['ㄣ', 2], [',', 0], ['ㄋㄧ', 3],
    ['ㄐㄧㄝ', 1], ['ㄓㄜ', 5], ['ㄕㄨㄛ', 1], ['ㄧㄚ', 5], ['.', 0],
  ])
  expect(syllables('𠮷')).toEqual(syllables('生僻字'))
})

it('reads common English and keeps every letter of a long out-of-vocabulary word', () => {
  const english = phonemes('Chrome API', symbols, lexicon)
  expect(english.map(([id]) => table.symbols[id])).toEqual(['K', 'R', 'OW', 'M', 'SP', 'EY', 'P', 'IY', 'AY', 'SP'])
  expect(english.every(([, , language]) => language === 1)).toBe(true)
  const longWord = 'supercalifragilisticexpialidocious'
  expect(phonemes(longWord, symbols, lexicon)).toEqual([...longWord].flatMap(letter => phonemes(letter, symbols, {})))
})

it.each(['', '   \r\n\t', '...!? — () ,', '🙂👩‍💻 1️⃣ #️⃣', '🈲 ㊙️ ℹ️ ™', '$¥％'])(
  'leaves nonspoken input silent (%j)', (text) => {
    expect(phonemes(text, symbols, lexicon)).toEqual([])
  },
)

it('returns empty PCM before the encoder and can synthesize the next line', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'spirit-prime-'))
  try {
    writeFileSync(join(directory, 'meta.json'), JSON.stringify({ sample_rate: 16_000, max_frames: 1000, abs_frame_bins: 512 }))
    writeFileSync(join(directory, 'symbol_table.json'), JSON.stringify(table))
    writeFileSync(join(directory, 'english-pronunciations.json'), JSON.stringify(lexicon))
    for (const name of ['acoustic_encoder', 'acoustic_decoder', 'vocoder']) {
      writeFileSync(join(directory, `${name}.onnx`), '')
    }
    const samples = Float32Array.of(0.125)
    const run = vi.fn()
      .mockResolvedValueOnce({
        conditioned: { dims: [1, 1, 1], data: Float32Array.of(0) },
        durations: { data: BigInt64Array.of(1n) },
        pitch: { data: Float32Array.of(0, 0) },
      })
      .mockResolvedValueOnce({ mel: {} })
      .mockResolvedValueOnce({ wav: { data: samples } })
    const ort = { Tensor: class {}, InferenceSession: { create: () => ({ run, release: async () => {} }) } }
    const engine = await createPrime(directory, ort)
    expect(await engine.synthesize('jingshen-light', '1️⃣ …')).toEqual({ sampleRate: 16_000, samples: new Float32Array() })
    expect(run).not.toHaveBeenCalled()
    expect(await engine.synthesize('jingshen-light', '嗯')).toEqual({ sampleRate: 16_000, samples })
    expect(run).toHaveBeenCalledTimes(3)
    await engine.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
