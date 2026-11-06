import { PhraseSplitter } from './quran-speech';
import { StreamResampler, VOCAB, resample } from './qasr-features';
import { forcedGap, greedyWords, modelLetters } from './ctc-score';
import { alignRecitation, rescue } from './align';

const RATE = 16000;
const tone = (seconds: number, amp: number, hz = 300) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE) * (1 + 0.3 * Math.sin(i / 900)));
let seed = 3;
const noise = (seconds: number, amp: number) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, () => amp * (((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1));
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

function phrasesOf(parts: Float32Array[]): number[] {
  const out: number[] = [];
  const split = new PhraseSplitter((a, final) => final && out.push(a.length / RATE), RATE);
  for (const p of parts) for (let i = 0; i < p.length; i += 4096) split.push(p.subarray(i, i + 4096));
  split.flush();
  return out;
}

describe('tasmee: listening', () => {
  it('hears a reciter who starts at once (no quiet moment first to learn the room from)', () => {
    expect(phrasesOf([tone(2.5, 0.1), noise(1, 0.0005), tone(2, 0.1), noise(1, 0.0005)])).toHaveLength(2);
  });

  it('keeps hearing in a noisy room (the background is measured from its quietest moments)', () => {
    const room = (s: number) => noise(s, 0.01);
    const mix = (a: Float32Array, b: Float32Array) => a.map((v, i) => v + b[i]);
    expect(phrasesOf([room(1), mix(tone(2, 0.12), room(2)), room(1), mix(tone(2, 0.12), room(2)), room(1)])).toHaveLength(2);
  });

  it('takes a breath between two ayat as a pause, not as more recitation', () => {
    const breath = noise(0.4, 0.012); // a hiss, softer than the voice
    const pause = (s: number) => noise(s, 0.0003);
    const p = phrasesOf([pause(0.5), tone(2, 0.1), pause(0.25), breath, pause(0.4), tone(2, 0.1), pause(1)]);
    expect(p).toHaveLength(2);
  });

  it('cuts a very long phrase at its quietest moment, not in the middle of a word', () => {
    const word = () => tone(0.6, 0.1);
    const gap = (s: number) => noise(s, 0.003);
    const parts: Float32Array[] = [];
    for (let k = 0; k < 30; k++) parts.push(word(), gap(k === 21 ? 0.35 : 0.12));
    const p = phrasesOf(parts);
    expect(p.length).toBeGreaterThanOrEqual(2);
    // The cut falls in the long gap after the 22nd word (22 * 0.72 s + 0.12 s ≈ 15.9 s), within the last seconds.
    expect(p[0]).toBeLessThanOrEqual(14);
    expect(p[0]).toBeGreaterThan(10);
  });
});

describe('tasmee: resampling the microphone', () => {
  it('keeps speech and removes what would fold back into it', () => {
    for (const from of [48000, 44100]) {
      const sine = (hz: number) => Float32Array.from({ length: from }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / from));
      const db = (hz: number) => 20 * Math.log10(rms(resample(sine(hz), from).subarray(300, -300)) / (0.5 / Math.SQRT2));
      expect(Math.abs(db(1000))).toBeLessThan(0.1);
      expect(db(5000)).toBeGreaterThan(-0.5);
      expect(db(10000)).toBeLessThan(-60);
      expect(db(15000)).toBeLessThan(-60);
    }
  });

  it('gives the same samples streamed in chunks as all at once', () => {
    const x = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i / 7) * 0.3 + Math.sin(i * 1.3) * 0.1);
    const s = new StreamResampler(48000);
    const chunks: number[] = [];
    for (let i = 0; i < x.length; i += 4096) chunks.push(...s.push(x.subarray(i, i + 4096)));
    const whole = resample(x, 48000);
    for (let i = 100; i < chunks.length - 100; i += 37) expect(Math.abs(chunks[i] - whole[i])).toBeLessThan(1e-6);
  });
});

describe("tasmee: checking a mistake against the audio", () => {
  const V = VOCAB.length;
  const id = (c: string) => VOCAB.indexOf(c);
  /** Frames where the model is sure of [seq] (letters, '_' blank, ' ' separator), with [soft] frames nearly tied. */
  function frames(seq: string, soft: Record<number, string> = {}): Float32Array {
    const lp = new Float32Array(seq.length * V).fill(-12);
    [...seq].forEach((c, f) => {
      const best = c === '_' ? 0 : id(c);
      lp[f * V + best] = -0.05;
      if (soft[f]) {
        lp[f * V + best] = -0.6;
        lp[f * V + id(soft[f])] = -0.8;
      }
    });
    return lp;
  }

  it('writes a word in the letters the model uses', () => {
    expect(modelLetters('ٱلرَّحْمَـٰنِ').map((i) => VOCAB[i]).join('')).toBe('الرحمن');
    expect(modelLetters('ٱلصَّلَوٰةَ').map((i) => VOCAB[i]).join('')).toBe('الصلوه');
  });

  it('scores the words the model heard as fitting, and other words as not', () => {
    const lp = frames('_ب_س_م_ _ا_ل_ل_ه_');
    const T = lp.length / V;
    expect(greedyWords(lp, T).map((w) => w.text)).toEqual(['بسم', 'الله']);
    expect(forcedGap(lp, T, V, 0, T - 1, ['بسم', 'الله'].map(modelLetters))).toBeLessThan(0.01);
    expect(forcedGap(lp, T, V, 0, T - 1, ['باسم', 'ربك'].map(modelLetters))).toBeGreaterThan(20);
  });

  it('accepts a word the model wrote a little differently when the audio fits it, and not a different word', () => {
    // The model wrote «اله» (one ل), but the frame where the second ل is said nearly fits ل too.
    const lp = frames('_ب_س_م_ _ا_ل__ه_ _ا_ل_ر_ح_م_ن_', { 13: 'ل' });
    const T = lp.length / V;
    const heard = greedyWords(lp, T);
    const sources = heard.map((w) => ({ phrase: 0, start: w.start, end: w.end }));
    const gap = (_p: number, a: number, b: number, ws: string[]) => forcedGap(lp, T, V, a, b, ws.map(modelLetters));
    const check = (expected: string[]) =>
      rescue(alignRecitation(expected, heard.map((w) => w.text), true), expected, sources, gap, true).map((r) => r.status);
    expect(heard.map((w) => w.text)).toEqual(['بسم', 'اله', 'الرحمن']);
    expect(check(['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَـٰنِ'])).toEqual(['correct', 'correct', 'correct']);
    expect(check(['بِسْمِ', 'رَبِّكَ', 'ٱلرَّحْمَـٰنِ'])[1]).not.toBe('correct');
  });

  it('checks a word said softly at the end of a phrase against that phrase, though the next word is in another', () => {
    // Phrase 0: «بسم» clearly, then «الله» softly (the model nearly writes it, but blanks win); phrase 1: «الرحمن».
    const p0 = frames('_ب_س_م_ ________', { 8: 'ا', 10: 'ل', 12: 'ل', 14: 'ه' });
    const p1 = frames('_ا_ل_ر_ح_م_ن_');
    const lps = [p0, p1];
    const heard = lps.flatMap((lp, phrase) => greedyWords(lp, lp.length / V).map((w) => ({ ...w, phrase })));
    expect(heard.map((w) => w.text)).toEqual(['بسم', 'الرحمن']);
    const sources = heard.map((w) => ({ phrase: w.phrase, start: w.start, end: w.end }));
    const gap = (p: number, a: number, b: number, ws: string[]) => forcedGap(lps[p], lps[p].length / V, V, a, b, ws.map(modelLetters));
    const check = (expected: string[]) =>
      rescue(alignRecitation(expected, heard.map((w) => w.text), true), expected, sources, gap, true).map((r) => r.status);
    expect(check(['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَـٰنِ'])).toEqual(['correct', 'correct', 'correct']);
    expect(check(['بِسْمِ', 'رَبِّكَ', 'ٱلرَّحْمَـٰنِ'])[1]).toBe('skipped');
  });
});
