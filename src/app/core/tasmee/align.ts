import { quranSearchKey } from '../quran/quran-utils';

/**
 * Tasmee' (تسميع): compares what the reciter said (speech recognition) with the ayat, word by word.
 *
 * The words heard are aligned with the words expected (dynamic programming, like a spelling diff): each expected word
 * is correct, wrong (another word was said in its place), skipped, or still to come. Extra words (a repeated word,
 * "آمين", a cough read as a word) cost little, so they do not throw the alignment off. Words are compared by their
 * search key (no tashkeel, alif, hamza forms...), so the Uthmani spelling and the recogniser's everyday spelling match,
 * and by letters, so a recogniser's small spelling slip is not counted as a mistake. Letters a recogniser confuses
 * (ص/س, ض/د/ظ/ذ/ز, ط/ت, ق/ك, ح/ه, ع/ء) count almost the same, and two heard words may make one written word (or the
 * other way round: "يا أيها" for «يٰٓأيها»).
 */

export type WordStatus = 'correct' | 'wrong' | 'skipped' | 'pending';

export interface WordResult {
  status: WordStatus;
  /** The word heard in its place (wrong words). */
  heard?: string;
  /** Settled: the reciter has gone on past it, so it will not change any more. */
  settled: boolean;
  /** The heard words matched to it: indexes [from, to) in the heard list (not for skipped words). */
  h?: [number, number];
  /** Accepted after checking the audio itself (the recogniser wrote it a little differently). */
  rescued?: boolean;
  /** Said wrongly or left out at first, then said right when the reciter went back over it. */
  corrected?: boolean;
}

/** Letters-only key of a word. */
export function wordKey(w: string): string {
  return quranSearchKey(w).replace(/[^ء-ي]/g, '');
}

/** Sound key: letters that sound alike to a recogniser folded together (and ع / ء dropped, like alif). */
const SOUND: Record<string, string> = {
  'ص': 'س', 'ث': 'س', 'ض': 'د', 'ظ': 'د', 'ذ': 'د', 'ز': 'د', 'ط': 'ت', 'ق': 'ك', 'ح': 'ه', 'خ': 'ه', 'ة': 'ه',
  'ع': '', 'ء': '', 'أ': '', 'إ': '', 'آ': '', 'ؤ': 'و', 'ئ': 'ي', 'ى': 'ي',
};
export function soundKey(key: string): string {
  let out = '';
  for (const c of key) out += SOUND[c] ?? c;
  return out;
}

const memo = new Map<string, number>();

/** How alike a written word and a heard word are (keys), counting near-sounding letters as almost the same. */
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const k = a + '|' + b;
  let v = memo.get(k);
  if (v === undefined) {
    v = Math.max(similarity(a, b), similarity(soundKey(a), soundKey(b)) - 0.04);
    if (memo.size > 200000) memo.clear();
    memo.set(k, v);
  }
  return v;
}

/** 1 = same word, 0 = nothing in common (edit distance on the keys). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/** Same word, allowing a recogniser's slip (one letter in a short word, a few in a long one). */
const SAME = 0.72;
/** Close enough to be the word said wrongly (rather than an unrelated extra word). */
const NEAR = 0.4;
const COST_WRONG = 1;
const COST_UNRELATED = 2.2;
const COST_SKIP = 1.1;
const COST_EXTRA = 0.8;
/** Two heard words for one written word, or one for two: only when they then match. */
const COST_JOIN = 0.05;
/** Going back to recite again from an earlier word (two repeated words cost more as extras). */
const COST_RESTART = 1.2;

/**
 * Aligns [heard] (recognised words, in order) with [expected] (the ayat's words). The expected words after the last
 * one reached are 'pending'. A word counts as settled once [settleAfter] correct words follow it, or when [done].
 */
export function alignRecitation(expected: string[], heard: string[], done = false, settleAfter = 2): WordResult[] {
  return alignWithCost(expected, heard, done, settleAfter).results;
}

/**
 * alignRecitation() with the alignment's cost (0 = every heard word is an expected word, in order): to choose
 * between two readings of the same recitation, the one that fits the ayat better.
 */
export function alignWithCost(expected: string[], heard: string[], done = false, settleAfter = 2): { results: WordResult[]; cost: number } {
  const E = expected.map(wordKey);
  // Heard words without letters are dropped; [hIndex] maps back to the caller's list.
  const hIndex: number[] = [];
  heard.forEach((w, k) => wordKey(w) && hIndex.push(k));
  const H = hIndex.map((k) => wordKey(heard[k]));
  const heardText = hIndex.map((k) => heard[k]);
  const n = E.length;
  const m = H.length;
  // D[i][j]: least cost of reading the first i expected words as the first j heard words.
  const D: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  // Moves: 1 word for word, 2 skipped, 3 extra, 4 two heard words = one written, 5 one heard word = two written,
  // 6 went back to an earlier word to recite again from there ([back] says from which word).
  const move: Uint8Array[] = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  const back: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  const sim = (i: number, j: number) => wordSimilarity(E[i], H[j]);
  for (let i = 1; i <= n; i++) {
    D[i][0] = D[i - 1][0] + COST_SKIP;
    move[i][0] = 2;
  }
  for (let j = 1; j <= m; j++) {
    D[0][j] = D[0][j - 1] + COST_EXTRA;
    move[0][j] = 3;
  }
  for (let j = 1; j <= m; j++) {
    for (let i = 1; i <= n; i++) {
      const s = sim(i - 1, j - 1);
      const diag = D[i - 1][j - 1] + (s >= SAME ? 0 : s >= NEAR ? COST_WRONG : COST_UNRELATED);
      const skip = D[i - 1][j] + COST_SKIP;
      const extra = D[i][j - 1] + COST_EXTRA;
      if (diag <= skip && diag <= extra) {
        D[i][j] = diag;
        move[i][j] = 1;
      } else if (skip <= extra) {
        D[i][j] = skip;
        move[i][j] = 2;
      } else {
        D[i][j] = extra;
        move[i][j] = 3;
      }
      if (s < SAME) {
        if (j >= 2 && D[i - 1][j - 2] + COST_JOIN < D[i][j] && wordSimilarity(E[i - 1], H[j - 2] + H[j - 1]) >= SAME) {
          D[i][j] = D[i - 1][j - 2] + COST_JOIN;
          move[i][j] = 4;
        }
        if (i >= 2 && D[i - 2][j - 1] + COST_JOIN < D[i][j] && wordSimilarity(E[i - 2] + E[i - 1], H[j - 1]) >= SAME) {
          D[i][j] = D[i - 2][j - 1] + COST_JOIN;
          move[i][j] = 5;
        }
      }
    }
    // Going back: after the j-th heard word the reciter may start again from an earlier word (to repeat an ayah, or to
    // put a mistake right). Cheaper than counting the words said again as extras once two or more are repeated.
    let least = Infinity;
    let from = -1;
    for (let k = n - 1; k >= 0; k--) {
      if (D[k + 1][j] < least) {
        least = D[k + 1][j];
        from = k + 1;
      }
      if (least + COST_RESTART < D[k][j] - 1e-9) {
        D[k][j] = least + COST_RESTART;
        move[k][j] = 6;
        back[k][j] = from;
      }
    }
  }
  // Every heard word is used; the reciter may not have reached the end: the best prefix of the expected words.
  // Ties go to the shorter prefix, so words not yet said are not called skipped.
  let end = 0;
  if (done) end = n;
  else for (let i = 1; i <= n; i++) if (D[i][m] < D[end][m] - 1e-9) end = i;

  const out: WordResult[] = expected.map(() => ({ status: 'pending' as WordStatus, settled: false }));
  // The path is walked from the last heard word back, so a word met again belongs to an earlier pass: the later
  // reading stands (a mistake put right by going back counts as put right), except that a word left out of a later
  // pass (or after it, at the end) keeps what the earlier pass said about it.
  const seen = new Uint8Array(n);
  const put = (k: number, r: WordResult) => {
    if (!seen[k]) {
      seen[k] = 1;
      out[k] = r;
    } else if (out[k].status === 'skipped' && r.status !== 'skipped') {
      out[k] = r;
    } else if (out[k].status === 'correct' && r.status !== 'correct' && !out[k].corrected) {
      out[k] = { ...out[k], corrected: true };
    }
  };
  let i = end;
  let j = m;
  while (i > 0 || j > 0) {
    const mv = move[i][j];
    const h = (a: number, b: number): [number, number] => [hIndex[a], hIndex[b - 1] + 1];
    if (mv === 6) {
      i = back[i][j];
    } else if (mv === 1) {
      const s = sim(i - 1, j - 1);
      put(i - 1, s >= SAME ? { status: 'correct', settled: false, h: h(j - 1, j) } : { status: 'wrong', heard: heardText[j - 1], settled: false, h: h(j - 1, j) });
      i--;
      j--;
    } else if (mv === 2) {
      put(i - 1, { status: 'skipped', settled: false });
      i--;
    } else if (mv === 4) {
      put(i - 1, { status: 'correct', settled: false, h: h(j - 2, j) });
      i--;
      j -= 2;
    } else if (mv === 5) {
      put(i - 1, { status: 'correct', settled: false, h: h(j - 1, j) });
      put(i - 2, { status: 'correct', settled: false, h: h(j - 1, j) });
      i -= 2;
      j--;
    } else {
      j--;
    }
  }
  return { results: settle(out, done, settleAfter), cost: D[end][m] };
}

/** Marks the words that will not change any more: enough correct words after them (or the session is over). */
export function settle(results: WordResult[], done = false, settleAfter = 2): WordResult[] {
  let correctAfter = 0;
  for (let k = results.length - 1; k >= 0; k--) {
    if (results[k].status === 'pending') continue;
    results[k].settled = done || correctAfter >= settleAfter;
    if (results[k].status === 'correct') correctAfter++;
  }
  return results;
}

/** Where a heard word came from: its phrase and frames (the offline recogniser), so its audio can be checked. */
export interface HeardSource {
  phrase: number;
  start: number;
  end: number;
}

/**
 * Second look at the mistakes, with the audio (offline recogniser): each run of wrong or skipped words, with the
 * correct word on each side, is scored against the frames those words were heard in; when the audio fits the
 * written words almost as well as the recogniser's own reading ([gap] at most [maxGap] nats per word), the run was
 * said right and only written differently («اله» for «الله», two words run together). [sources] gives each heard
 * word's phrase and frames (undefined: no audio, e.g. a live reading). The results are changed in place and settled
 * again.
 */
export function rescue(
  results: WordResult[],
  expected: string[],
  sources: (HeardSource | undefined)[],
  gap: (phrase: number, from: number, to: number, words: string[]) => number,
  done = false,
  maxGap = 1.6,
): WordResult[] {
  const bad = (r: WordResult) => r.status === 'wrong' || r.status === 'skipped';
  /** The audio of heard words [from, to) when it is all one phrase. */
  const span = (from: number, to: number) => {
    const src = from >= 0 && to > from ? sources.slice(from, to) : [];
    return src.length && src.every((x) => x && x.phrase === src[0]!.phrase) ? (src as HeardSource[]) : null;
  };
  const fits = (src: HeardSource[], start: number, end: number, a: number, b: number, n: number) =>
    gap(src[0].phrase, start, end, expected.slice(a, b + 1)) <= maxGap * n;
  for (let i = 0; i < results.length; i++) {
    if (!bad(results[i])) continue;
    let j = i;
    while (j + 1 < results.length && bad(results[j + 1])) j++;
    const before = i > 0 && results[i - 1].h ? i - 1 : -1;
    const after = j + 1 < results.length && results[j + 1].h ? j + 1 : -1;
    const own = results.slice(i, j + 1).filter((r) => r.h);
    const ownFrom = own[0]?.h?.[0] ?? -1;
    const ownTo = own[own.length - 1]?.h?.[1] ?? -1;
    const n = j - i + 1;
    let ok = false;
    // The heard words from the word before the run to the word after it, all in one phrase.
    const from = before >= 0 ? results[before].h![0] : ownFrom;
    const to = after >= 0 ? results[after].h![1] : ownTo;
    const all = span(from, to);
    if (all) ok = fits(all, all[0].start - 2, all[all.length - 1].end + 2, before >= 0 ? before : i, after >= 0 ? after : j, n);
    else if (before >= 0 && after >= 0) {
      // A pause fell inside the run: the words may end the phrase before it, or begin the phrase after it.
      const b = span(results[before].h![0], results[before].h![1]);
      const a = span(results[after].h![0], results[after].h![1]);
      const withOwn = own.length ? span(ownFrom, ownTo) : null;
      if (b && (!withOwn || withOwn[0].phrase === b[0].phrase)) ok = fits(b, b[0].start - 2, (withOwn ?? b)[(withOwn ?? b).length - 1].end + 1e6, before, j, n);
      if (!ok && a && (!withOwn || withOwn[0].phrase === a[0].phrase)) ok = fits(a, 0, a[a.length - 1].end + 2, i, after, n);
    }
    if (ok) for (let k = i; k <= j; k++) results[k] = { ...results[k], status: 'correct', heard: undefined, rescued: true };
    i = j;
  }
  return settle(results, done);
}

/**
 * Of the recogniser's guesses for a phrase (best first), the one that fits the ayat around [position] best: each is
 * matched against the written words from a little before the position on (it may start anywhere there, and need not
 * reach the end). Ties go to the recogniser's own first guess.
 */
export function bestAlternative(expected: string[], position: number, alternatives: string[]): string {
  if (alternatives.length < 2) return alternatives[0] ?? '';
  let best = alternatives[0];
  let bestCost = Infinity;
  for (const alt of alternatives) {
    const H = heardWords(alt).map(wordKey).filter(Boolean);
    if (!H.length) continue;
    const from = Math.max(0, position - 6);
    const E = expected.slice(from, position + H.length * 2 + 8).map(wordKey);
    // Local alignment: free to start at any written word, scored by the heard words' cost.
    let prev = Array.from({ length: H.length + 1 }, (_, j) => j * COST_EXTRA);
    let least = prev[H.length];
    for (let i = 1; i <= E.length; i++) {
      const cur = [0];
      for (let j = 1; j <= H.length; j++) {
        const sm = wordSimilarity(E[i - 1], H[j - 1]);
        cur[j] = Math.min(
          prev[j - 1] + (sm >= SAME ? 0 : sm >= NEAR ? COST_WRONG : COST_UNRELATED),
          prev[j] + COST_SKIP,
          cur[j - 1] + COST_EXTRA,
        );
      }
      least = Math.min(least, cur[H.length]);
      prev = cur;
    }
    const cost = least / H.length;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = alt;
    }
  }
  return best;
}

/** Splits recognised text into words (punctuation dropped). */
export function heardWords(text: string): string[] {
  return text
    .replace(/[.,،؛:!?؟"«»()\[\]{}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Correct share of the words reached, 0..1. */
export function score(results: WordResult[]): number {
  const reached = results.filter((r) => r.status !== 'pending');
  return reached.length ? reached.filter((r) => r.status === 'correct').length / reached.length : 0;
}
