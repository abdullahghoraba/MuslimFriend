import { HeardSpan } from './ctc-score';

/** What the offline recogniser read in a piece of audio: its words (with their frames) and letter probabilities. */
export interface Reading {
  text: string;
  words: HeardSpan[];
  lp: Float32Array;
  frames: number;
  vocab: number;
}

const RATE = 16000;
/** 20 ms windows. */
const W = 320;

/** The loudness of each 20 ms of [audio]. */
function levels(audio: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor(audio.length / W));
  for (let k = 0; k < out.length; k++) {
    let p = 0;
    for (let i = k * W; i < (k + 1) * W; i++) p += audio[i] * audio[i];
    out[k] = Math.sqrt(p / W);
  }
  return out;
}

/** Two readings of consecutive pieces of audio as one (frames, letter probabilities and word frames run on). */
export function joinReadings(a: Reading, b: Reading): Reading {
  if (!a.frames) return b;
  if (!b.frames) return a;
  const lp = new Float32Array(a.lp.length + b.lp.length);
  lp.set(a.lp);
  lp.set(b.lp, a.lp.length);
  const words = [...a.words, ...b.words.map((w) => ({ ...w, start: w.start + a.frames, end: w.end + a.frames }))];
  return { text: words.map((w) => w.text).join(' '), words, lp, frames: a.frames + b.frames, vocab: a.vocab || b.vocab };
}

/**
 * Where the recitation in a phrase has no word written for it: places to cut the phrase (samples, in the middle of a
 * stop), best first, each with the seconds of voice beside it that the reading left without a word.
 *
 * The model was trained on one ayah at a time. Given two ayat said with only a short stop between them, it often
 * writes one of them and nothing of the other: the first (the basmala before al-Hamd), the second (in al-Mulk 6–7 it
 * wrote «المصير» over seven seconds and nothing of «إذا ألقوا فيها سمعوا لها»), or a word said twice once. Each stop
 * is scored by the voice between it and the nearest word written on either side.
 */
export function cutsToReread(audio: Float32Array, words: { start: number; end: number }[], minVoice = 0.6): { at: number; voice: number }[] {
  const lv = levels(audio);
  if (!lv.length || !words.length) return [];
  const p90 = [...lv].sort((a, b) => a - b)[Math.floor(lv.length * 0.9)];
  // Voice: a quarter of the recitation's level or more (not a breath, the room, or a madd fading out).
  const loud = p90 / 4;
  const quiet = p90 / 10;
  const voiced = (from: number, to: number) => {
    let n = 0;
    for (let k = Math.max(0, Math.floor(from / W)); k < Math.min(lv.length, Math.ceil(to / W)); k++) if (lv[k] > loud) n++;
    return (n * W) / RATE;
  };
  // Stops: 200 ms or more under a tenth of the recitation's level (and the quietest moment of a shorter dip at the
  // edges, where a reader joins the basmala to al-Hamd with hardly a stop).
  const stops: number[] = [];
  for (let k = 0; k < lv.length; ) {
    if (lv[k] >= quiet) {
      k++;
      continue;
    }
    let e = k;
    while (e < lv.length && lv[e] < quiet) e++;
    if ((e - k) * W >= 0.2 * RATE && k > 0 && e < lv.length) stops.push(Math.round(((k + e) / 2) * W));
    k = e;
  }
  const quietest = (from: number, to: number) => {
    let best = -1;
    for (let k = Math.max(1, Math.floor(from / W)); k < Math.min(lv.length - 1, Math.ceil(to / W)); k++) if (best < 0 || lv[k] < lv[best]) best = k;
    return best < 0 ? -1 : Math.round((best + 0.5) * W);
  };
  const head = words[0].start;
  const tail = words[words.length - 1].end;
  const near = Math.round(0.7 * RATE);
  if (!stops.some((s) => s > head - near && s <= head)) stops.push(quietest(head - near, head + 0.1 * RATE));
  if (!stops.some((s) => s >= tail && s < tail + near)) stops.push(quietest(tail - 0.1 * RATE, tail + near));
  const cuts: { at: number; voice: number }[] = [];
  for (const at of stops) {
    if (at <= 0 || at >= audio.length) continue;
    const inside = words.find((w) => w.start < at && at < w.end);
    let voice: number;
    if (inside) {
      // In a word stretched over a stop: some of it is that word and some is not, on one side or the other; a madd
      // fading out into the stop has no voice after it.
      voice = Math.min(voiced(inside.start, at), voiced(at, inside.end));
    } else {
      const next = words.find((w) => w.start >= at);
      const prev = [...words].reverse().find((w) => w.end <= at);
      voice = Math.max(voiced(at, next ? next.start : audio.length), voiced(prev ? prev.end : 0, at));
    }
    if (voice >= minVoice) cuts.push({ at, voice });
  }
  return cuts.sort((a, b) => b.voice - a.voice);
}

/**
 * Whether reading the two sides of a cut on their own only added words where nothing was written before: the words
 * wholly before the cut are read again the same at the start of the first side, those wholly after it at the end of
 * the second (a word the cut falls in may come back different), and at least three letters were added. Read alone, a
 * short piece of audio can come back as words that were never said (the end of «إذا وقب» as «لم يلد ولم يولد»):
 * then the words already read change, and the cut is not taken.
 */
export function onlyAdds(before: string[], after: string[], a: string[], b: string[], inside = ''): boolean {
  if (a.length < before.length || b.length < after.length) return false;
  if (before.some((w, i) => a[i] !== w) || after.some((w, i) => b[b.length - after.length + i] !== w)) return false;
  const added = [...a.slice(before.length), ...b.slice(0, b.length - after.length)];
  const kept = inside ? 1 : 0;
  return added.join('').length - inside.length >= 3 && added.length > kept;
}

/**
 * Reads a phrase; where some of the recitation came back without a word (see cutsToReread), the phrase is cut at the
 * stop beside it and each side read on its own, and the two readings are joined if that only added words (onlyAdds).
 */
export async function readPhrase(audio: Float32Array, transcribe: (a: Float32Array) => Promise<Reading>, depth = 0): Promise<Reading> {
  const r = await transcribe(audio);
  if (depth >= 2 || !r.words.length || audio.length < 1.5 * RATE) return r;
  const spf = audio.length / r.frames;
  const spans = r.words.map((w) => ({ text: w.text, start: Math.round(w.start * spf), end: Math.round((w.end + 1) * spf) }));
  for (const { at } of cutsToReread(audio, spans).slice(0, 2)) {
    const a = await readPhrase(audio.subarray(0, at), transcribe, depth + 1);
    const b = await readPhrase(audio.subarray(at), transcribe, depth + 1);
    const before = spans.filter((w) => w.end <= at).map((w) => w.text);
    const after = spans.filter((w) => w.start >= at).map((w) => w.text);
    const inside = spans.find((w) => w.start < at && at < w.end)?.text ?? '';
    if (onlyAdds(before, after, a.words.map((w) => w.text), b.words.map((w) => w.text), inside)) return joinReadings(a, b);
  }
  return r;
}
