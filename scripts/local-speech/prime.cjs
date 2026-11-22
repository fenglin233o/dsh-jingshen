'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pinyin } = require('./pinyin/index.cjs');

const digits = '零一二三四五六七八九';
const initials = new Map(Object.entries({
  b:'ㄅ', p:'ㄆ', m:'ㄇ', f:'ㄈ', d:'ㄉ', t:'ㄊ', n:'ㄋ', l:'ㄌ', g:'ㄍ', k:'ㄎ', h:'ㄏ',
  j:'ㄐ', q:'ㄑ', x:'ㄒ', zh:'ㄓ', ch:'ㄔ', sh:'ㄕ', r:'ㄖ', z:'ㄗ', c:'ㄘ', s:'ㄙ',
}));
const finals = new Map(Object.entries({
  a:'ㄚ', o:'ㄛ', e:'ㄜ', ê:'ㄝ', ai:'ㄞ', ei:'ㄟ', ao:'ㄠ', ou:'ㄡ', an:'ㄢ', en:'ㄣ',
  ang:'ㄤ', eng:'ㄥ', er:'ㄦ', i:'ㄧ', ia:'ㄧㄚ', io:'ㄧㄛ', ie:'ㄧㄝ', iao:'ㄧㄠ', iu:'ㄧㄡ',
  iou:'ㄧㄡ', ian:'ㄧㄢ', in:'ㄧㄣ', iang:'ㄧㄤ', ing:'ㄧㄥ', u:'ㄨ', ua:'ㄨㄚ', uo:'ㄨㄛ',
  uai:'ㄨㄞ', ui:'ㄨㄟ', uei:'ㄨㄟ', uan:'ㄨㄢ', un:'ㄨㄣ', uen:'ㄨㄣ', uang:'ㄨㄤ', ong:'ㄨㄥ',
  ueng:'ㄨㄥ', v:'ㄩ', ve:'ㄩㄝ', van:'ㄩㄢ', vn:'ㄩㄣ', iong:'ㄩㄥ',
}));
const spelling = new Map(Object.entries({
  A:'EY1', B:'B IY1', C:'S IY1', D:'D IY1', E:'IY1', F:'EH1 F', G:'JH IY1', H:'EY1 CH', I:'AY1',
  J:'JH EY1', K:'K EY1', L:'EH1 L', M:'EH1 M', N:'EH1 N', O:'OW1', P:'P IY1', Q:'K Y UW1',
  R:'AA1 R', S:'EH1 S', T:'T IY1', U:'Y UW1', V:'V IY1', W:'D AH1 B AH0 L Y UW0', X:'EH1 K S',
  Y:'W AY1', Z:'Z IY1',
}));
const englishOverrides = new Map(Object.entries({
  ai:'EY1 AY1', api:'EY1 P IY1 AY1', cpu:'S IY1 P IY1 Y UW1', gpu:'JH IY1 P IY1 Y UW1',
  github:'G IH1 T HH AH2 B', json:'JH EY1 S AH0 N', openai:'OW1 P AH0 N EY1 AY1',
  primetts:'P R AY1 M T IY1 T IY1 EH1 S', tts:'T IY1 T IY1 EH1 S',
  wifi:'W AY1 F AY2', youtube:'Y UW1 T UW2 B',
}));

function spellDigits(value) {
  return value.replace(/\d/g, digit => digits[Number(digit)]);
}

function cardinal(value) {
  if (value.length > 12 || /^0\d/.test(value)) return spellDigits(value);
  const grouped = value.padStart(Math.ceil(value.length / 4) * 4, '0').match(/.{4}/g);
  const groups = ['', '万', '亿'];
  let result = '';
  let zero = false;
  for (const [index, group] of grouped.entries()) {
    if (+group === 0) {
      zero ||= result.length > 0;
      continue;
    }
    for (const [place, digit] of [...group].entries()) {
      if (digit === '0') {
        zero ||= result.length > 0;
        continue;
      }
      if (zero) result += '零';
      zero = false;
      if (digit !== '1' || place !== 2 || result) result += digits[+digit];
      result += ['千', '百', '十', ''][place];
    }
    result += groups[grouped.length - 1 - index];
    zero = false;
  }
  return result || '零';
}

function normalize(text) {
  return text.replace(/\p{Extended_Pictographic}[\uFE0E\uFE0F]?/gu, ' ')
    .normalize('NFKC')
    .replace(/[0-9#*][\uFE0E\uFE0F]?\u20E3/gu, ' ')
    .replace(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/g, (_, year, month, day) => `${year}年${+month}月${+day}日`)
    .replace(/(\d{4})(?=年)/g, spellDigits)
    .replace(/(?<!\d)0(\d)(?=[月日号])/g, '$1')
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/g,
      (_, hour, minute, second) => `${cardinal(String(+hour))}点${cardinal(String(+minute))}分${second === undefined ? '' : `${cardinal(String(+second))}秒`}`)
    .replace(/(?<!\d)\d{1,3}(?:,\d{3})+(?!\d)/g, amount => amount.replace(/,/g, ''))
    .replace(/([+-]?)([$¥])\s*([+-]?)(\d+(?:\.\d+)?)/g,
      (_, leadingSign, currency, amountSign, amount) => `${leadingSign || amountSign}${amount}${currency === '$' ? '美元' : '元'}`)
    .replace(/(\d)\s*-\s*(?=\d)/g, '$1减')
    .replace(/(^|[^\d.])([+-]?)\.(?=\d)/g, (_, before, sign) => `${before}${sign}0.`)
    .replace(/([+-]?)(\d+(?:\.\d+)*)(%?)/g, (_, sign, value, percent) => {
      const [whole, ...fractions] = value.split('.');
      const body = [cardinal(whole), ...fractions.map(spellDigits)].join('点');
      return `${sign === '-' ? '负' : sign === '+' ? '正' : ''}${percent ? '百分之' : ''}${body}`;
    })
    .replace(/\u2026|\.{3,}/g, '…')
    .replace(/[，、；;：:\u2013\u2014]/g, ',')
    .replace(/[。｡]/g, '.')
    .replace(/[‘’]/g, "'")
    .replace(/\r?\n+/g, ',');
}

function zhuyin(pronunciation) {
  const match = /^([a-züê]+)([0-5])$/i.exec(pronunciation);
  if (!match) return null;
  let [, syllable, tone] = match;
  syllable = syllable.replace('ü', 'v');
  if (syllable === 'ng' || syllable === 'n') return ['ㄣ', Number(tone) || 5];
  if (syllable === 'm') return ['ㄇㄨ', Number(tone) || 5];
  if (syllable === 'hng' || syllable === 'hm') return ['ㄏㄥ', Number(tone) || 5];
  if (syllable.startsWith('y')) {
    const rest = syllable.slice(1);
    if (rest.startsWith('u')) syllable = 'v' + rest.slice(1);
    else if (rest === 'ong') syllable = 'iong';
    else syllable = rest.startsWith('i') ? rest : 'i' + rest;
  }
  if (syllable.startsWith('w')) {
    const rest = syllable.slice(1);
    syllable = rest === 'u' ? rest : 'u' + rest;
  }
  const initial = /^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/.exec(syllable)?.[0] || '';
  let final = syllable.slice(initial.length);
  if (initial && /[jqx]/.test(initial) && final.startsWith('u')) final = 'v' + final.slice(1);
  if (final === 'i' && /^(?:zh|ch|sh|r|z|c|s)$/.test(initial)) final = '';
  const end = final ? finals.get(final) : '';
  if (end === undefined || (!initial && !end)) return null;
  return [(initials.get(initial) || '') + end, Number(tone) || 5];
}

function phonemes(text, symbols, lexicon) {
  const result = [];
  const add = (phone, tone, language) => {
    const id = symbols.get(phone);
    if (id === undefined) throw new Error(`PrimeTTS model lacks phoneme ${phone}`);
    result.push([id, tone, language]);
  };
  const markBoundary = () => { result.at(-1)[3] = true; };
  const mandarin = ([syllable, tone]) => {
    for (const phone of syllable) add(phone, tone, 0);
    markBoundary();
  };
  const unknownHan = () => {
    mandarin(['ㄕㄥ', 1]);
    mandarin(['ㄆㄧ', 4]);
    mandarin(['ㄗ', 4]);
  };
  const chunks = normalize(text).match(/[\p{Script=Han}]+|[A-Za-z]+(?:'[A-Za-z]+)*|[^]/gu) || [];
  for (const chunk of chunks) {
    if (/^\p{Script=Han}/u.test(chunk)) {
      const readings = pinyin(chunk, { type:'all', toneType:'num', v:true, toneSandhi:true });
      for (const [index, item] of readings.entries()) {
        // A rising nasal is the model's clearer reading of the conversational interjection 嗯.
        const current = item.isZh ? zhuyin(item.origin === '嗯' ? 'ng2' : item.pinyin) : null;
        if (!current) {
          unknownHan();
          continue;
        }
        // A run of third tones becomes rising until its final syllable.
        const next = readings[index + 1]?.pinyin;
        if (current[1] === 3 && next?.endsWith('3')) current[1] = 2;
        mandarin(current);
      }
    } else if (/^[A-Za-z]/.test(chunk)) {
      const word = chunk.toLowerCase();
      const known = englishOverrides.get(word) || (Object.hasOwn(lexicon, word) ? lexicon[word] : undefined);
      const words = known ? [known] : [...chunk.toUpperCase()].map(letter => spelling.get(letter)).filter(Boolean);
      for (const spelledWord of words) {
        for (const token of spelledWord.split(' ')) {
          const match = /^([A-Z]+)([0-2]?)$/.exec(token);
          if (match) add(match[1], Number(match[2]), 1);
        }
        add('SP', 0, 1);
        markBoundary();
      }
    } else if ([',', '.', '?', '!', '…', '-', "'"].includes(chunk)) {
      add(chunk, 0, 0);
      markBoundary();
    } else if (result.length && result.at(-1)[0] !== symbols.get('SP')) {
      add('SP', 0, 0);
      markBoundary();
    }
  }
  return result.some(([, tone, language]) => tone || language) ? result : [];
}

// PrimeTTS host_regulate, ported from scripts/synth_from_text.py (Apache-2.0).
function regulate(ort, encoded, speed, meta) {
  const { conditioned, durations, pitch } = encoded;
  const [, tokens, width] = conditioned.dims;
  const counts = Array.from(durations.data, count => Math.max(0, Math.round(Number(count) / speed)));
  const length = counts.reduce((total, count) => total + count, 0);
  if (length > meta.max_frames) return null;
  if (!length) throw new Error('PrimeTTS produced no acoustic frames');
  const frames = new Float32Array(length * width);
  const context = new Float32Array(length * width * 3);
  const frameMeta = new Float32Array(length * 8);
  const position = new BigInt64Array(length);
  const framePitch = new Float32Array(length * 2);
  const frameMask = new Uint8Array(length).fill(1);
  const activeTokens = counts.filter(count => count > 0).length;
  const condition = conditioned.data;
  let frame = 0;
  for (const [index, count] of counts.entries()) {
    const current = condition.subarray(index * width, (index + 1) * width);
    const previousIndex = Math.max(0, index - 1);
    const nextIndex = Math.min(tokens - 1, index + 1);
    const previous = condition.subarray(previousIndex * width, (previousIndex + 1) * width);
    const next = condition.subarray(nextIndex * width, (nextIndex + 1) * width);
    const sourcePitch = pitch.data.subarray(index * 2, index * 2 + 2);
    const tokenPosition = index / Math.max(1, activeTokens - 1);
    for (let within = 0; within < count; within++, frame++) {
      const relative = within / Math.max(1, count - 1);
      frames.set(current, frame * width);
      context.set(previous, frame * width * 3);
      context.set(current, frame * width * 3 + width);
      context.set(next, frame * width * 3 + width * 2);
      frameMeta.set([
        relative, 1-relative, 1-Math.abs(relative*2-1), Math.sin(relative*Math.PI), Math.cos(relative*Math.PI),
        tokenPosition, Math.log1p(count)/6, count/40,
      ], frame * 8);
      position[frame] = BigInt(Math.min(Math.floor(frame * meta.abs_frame_bins / meta.max_frames), meta.abs_frame_bins - 1));
      framePitch.set(sourcePitch, frame * 2);
    }
  }
  return {
    frames: new ort.Tensor('float32', frames, [1, length, width]),
    frame_meta: new ort.Tensor('float32', frameMeta, [1, length, 8]),
    local_ctx_raw: new ort.Tensor('float32', context, [1, length, width * 3]),
    abs_pos: new ort.Tensor('int64', position, [1, length]),
    pitch_frame: new ort.Tensor('float32', framePitch, [1, length, 2]),
    frame_mask: new ort.Tensor('bool', frameMask, [1, length]),
  };
}

async function createPrime(directory, ort) {
  const read = filename => fs.readFile(path.join(directory, filename));
  const readJson = async filename => JSON.parse((await read(filename)).toString('utf8'));
  const [meta, symbolTable, lexicon] = await Promise.all([
    readJson('meta.json'), readJson('symbol_table.json'), readJson('english-pronunciations.json'),
  ]);
  if (meta.sample_rate !== 16000 || !meta.max_frames || !meta.abs_frame_bins) throw new Error('Invalid PrimeTTS model metadata');
  const symbols = new Map(symbolTable.symbols.map((symbol, index) => [symbol,index]));
  const sessions = [];
  try {
    for (const file of ['acoustic_encoder', 'acoustic_decoder', 'vocoder']) {
      const model = await read(`${file}.onnx`);
      sessions.push(await ort.InferenceSession.create(new Uint8Array(model.buffer, model.byteOffset, model.byteLength)));
    }
  } catch (error) {
    await Promise.allSettled(sessions.map(session => session.release()));
    throw error;
  }
  const [encoder, decoder, vocoder] = sessions;

  async function render(input, speed) {
    if (input.length <= 160) {
      const column = index => new ort.Tensor('int64', BigInt64Array.from(input, row => BigInt(row[index])), [1,input.length]);
      const encoded = await encoder.run({
        phone: column(0), tone: column(1), lang: column(2),
        speaker: new ort.Tensor('int64', new BigInt64Array(1), [1]),
      });
      const phoneticFrames = regulate(ort, encoded, speed, meta);
      if (phoneticFrames) {
        const { mel } = await decoder.run(phoneticFrames);
        const { wav } = await vocoder.run({ mel });
        return [wav.data];
      }
    }
    if (input.length < 2) throw new Error('PrimeTTS audio exceeds model limits');
    const halfway = Math.floor(input.length / 2);
    const breaks = [',', '.', '?', '!', '…', 'SP'].map(mark => symbols.get(mark));
    const phraseEnd = input.findIndex(([id], index) => index >= halfway * .9 && index < halfway * 1.1
      && index < input.length - 1 && breaks.includes(id));
    const syllableEnd = input.findIndex(([, , , boundary], index) => index >= halfway && index < input.length - 1 && boundary);
    const boundary = phraseEnd < 0 ? (syllableEnd < 0 ? halfway : syllableEnd + 1) : phraseEnd + 1;
    return [...await render(input.slice(0, boundary), speed), ...await render(input.slice(boundary), speed)];
  }

  return {
    // PrimeTTS v1b contains a single voice. The worker accepts the product-facing voice alias.
    async synthesize(_voice, text, speed = 1) {
      if (!Number.isFinite(speed) || speed <= 0) throw new Error('PrimeTTS speaking speed must be positive');
      const input = phonemes(text, symbols, lexicon);
      const pieces = input.length ? await render(input, speed) : [];
      const samples = new Float32Array(pieces.reduce((total, piece) => total + piece.length, 0));
      let offset = 0;
      for (const piece of pieces) {
        samples.set(piece, offset);
        offset += piece.length;
      }
      return { samples, sampleRate: meta.sample_rate };
    },
    async close() {
      await Promise.all(sessions.map(session => session.release()));
    },
  };
}

module.exports = { createPrime, normalize, phonemes };
