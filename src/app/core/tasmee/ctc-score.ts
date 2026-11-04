import { VOCAB } from './qasr-features';

/**
 * Scoring words against the offline recogniser's output (per-frame letter probabilities, CTC), so tasmee' can ask
 * "does the audio fit the word that should be here?" instead of trusting only the letters the model picked.
 *
 * The model picks the likeliest letter at each frame (greedy); a recitation slightly off from the training voices
 * can make it write «اله» for «الله» although the audio fits «الله» almost as well. forcedGap() measures exactly
 * that: how much less likely the expected words are than the model's own reading of the same frames (0 = just as
 * likely). A word really said differently (another word, a skipped one) costs many times more.
 */

const LETTER_ID = new Map<string, number>(VOCAB.map((c, i) => [c, i]));
export const BLANK = 0;
export const SEPARATOR = VOCAB.length - 1;

/** Letters the model writes for a written word (its training labels: Uthmani rasm, no marks, letter forms folded). */
export function modelLetters(word: string): number[] {
  const out: number[] = [];
  for (const ch of word) {
    const o = ch.codePointAt(0)!;
    // Harakat, Quranic marks, small letters, tatweel, digits.
    if ((o >= 0x064b && o <= 0x065f) || o === 0x0670 || (o >= 0x06d6 && o <= 0x06ed) || o === 0x0640 || (o >= 0x0660 && o <= 0x0669) || (o >= 0x08d3 && o <= 0x08ff)) continue;
    const c = FOLD[ch] ?? ch;
    const id = LETTER_ID.get(c);
    if (id !== undefined && id !== SEPARATOR && id !== BLANK) out.push(id);
  }
  return out;
}
const FOLD: Record<string, string> = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ٲ': 'ا', 'ٳ': 'ا', 'ى': 'ي', 'ئ': 'ي', 'ی': 'ي', 'ے': 'ي', 'ؤ': 'و', 'ة': 'ه', 'ک': 'ك',
};

/** A word the model wrote, with the frames it spans (first and last frame of its letters). */
export interface HeardSpan {
  text: string;
  start: number;
  end: number;
}

/** Greedy CTC reading with each word's frames. lp is [frames * vocab] log-probabilities. */
export function greedyWords(lp: Float32Array, frames: number, vocab = VOCAB.length): HeardSpan[] {
  const out: HeardSpan[] = [];
  let cur: HeardSpan | null = null;
  let prev = -1;
  for (let f = 0; f < frames; f++) {
    let best = 0;
    let bestV = -Infinity;
    for (let v = 0; v < vocab; v++) {
      const x = lp[f * vocab + v];
      if (x > bestV) {
        bestV = x;
        best = v;
      }
    }
    if (best === SEPARATOR) {
      if (cur) out.push(cur);
      cur = null;
    } else if (best !== BLANK) {
      if (best !== prev || !cur) {
        if (!cur) cur = { text: '', start: f, end: f };
        cur.text += VOCAB[best];
      }
      cur.end = f;
    }
    prev = best;
  }
  if (cur) out.push(cur);
  return out;
}

/** Sum over frames [from, to] of the best log-probability per frame: the model's own reading. */
function bestPath(lp: Float32Array, vocab: number, from: number, to: number): number {
  let sum = 0;
  for (let f = from; f <= to; f++) {
    let m = -Infinity;
    for (let v = 0; v < vocab; v++) m = Math.max(m, lp[f * vocab + v]);
    sum += m;
  }
  return sum;
}

/**
 * How much less likely [words] (letter ids each) are than the model's own reading over frames [from, to], in nats
 * (Viterbi, the best single alignment: blanks anywhere, letters held over several frames; a blank frame may also be
 * the word separator). Infinity when the frames are too few for the letters.
 */
export function forcedGap(lp: Float32Array, frames: number, vocab: number, from: number, to: number, words: number[][]): number {
  from = Math.max(0, from);
  to = Math.min(frames - 1, to);
  const letters = words.flat();
  const labels: number[] = [BLANK];
  for (const l of letters) labels.push(l, BLANK);
  const S = labels.length;
  if (to < from || S < 3) return Infinity;
  const emit = (f: number, s: number) =>
    labels[s] === BLANK ? Math.max(lp[f * vocab + BLANK], lp[f * vocab + SEPARATOR]) : lp[f * vocab + labels[s]];
  let prev = new Float64Array(S).fill(-Infinity);
  let cur = new Float64Array(S);
  prev[0] = emit(from, 0);
  prev[1] = emit(from, 1);
  for (let f = from + 1; f <= to; f++) {
    cur.fill(-Infinity);
    for (let s = 0; s < S; s++) {
      let best = prev[s];
      if (s >= 1 && prev[s - 1] > best) best = prev[s - 1];
      if (s >= 2 && labels[s] !== BLANK && labels[s] !== labels[s - 2] && prev[s - 2] > best) best = prev[s - 2];
      if (best > -Infinity) cur[s] = best + emit(f, s);
    }
    [prev, cur] = [cur, prev];
  }
  const end = Math.max(prev[S - 1], prev[S - 2]);
  if (end === -Infinity) return Infinity;
  return Math.max(0, bestPath(lp, vocab, from, to) - end);
}
