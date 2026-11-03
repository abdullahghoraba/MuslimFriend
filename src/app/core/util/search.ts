import { normalizeArabic } from '../quran/quran-utils';

/**
 * Forgiving search for names (reciters, suras, radios, the Names of Allah...):
 * - Arabic ignores tashkeel, hamza forms, ى/ي, ة/ه, spaces ("عبد الباسط" = "عبدالباسط") and a leading "ال";
 * - Latin ignores case, accents, punctuation and how a name is transliterated: "Menshawy" finds "Al-Minshawi",
 *   "Sudais" finds "Alsudaes", "Husari" finds "Al-Hussary" (compared by consonants);
 * - several words match in any order and each may match a different field ("الحصري ورش": the reciter's name and
 *   one of his recordings).
 */

/** One text prepared for matching (prepare once, match many times). */
export interface SearchText {
  /** Arabic normalised, spaces removed. */
  ar: string;
  /** Latin folded: lower case, no accents, letters and digits only, words joined. */
  latin: string;
  /** Consonant skeleton of [latin]. */
  skel: string;
  /** Start of each word (for ranking "starts with"), in [ar] and [latin]. */
  arWords: string[];
  latinWords: string[];
}

const ARABIC = /[؀-ۿ]/;

/** Lower case, accents removed, anything but letters and digits as spaces. */
export function foldLatin(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim();
}

/**
 * The consonants of a transliterated name, so spellings agree: vowels (and y, w used as vowels) dropped, q = k,
 * doubled letters once, "h" after another consonant dropped (sh, th, dh, kh, gh stay distinct enough).
 */
export function skeleton(latin: string): string {
  return latin
    .replace(/[^a-z0-9]/g, '')
    .replace(/q/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/[aeiouyw]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const stripAl = (w: string) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w);

export function prepareSearch(...texts: (string | undefined | null)[]): SearchText {
  const all = texts.filter((t): t is string => !!t);
  const arWords = all.flatMap((t) => normalizeArabic(t).split(' ')).filter(Boolean).map(stripAl);
  const latinWords = all.flatMap((t) => foldLatin(t).split(' ')).filter(Boolean);
  const latin = latinWords.join('');
  return { ar: arWords.join(''), latin, skel: skeleton(latin), arWords, latinWords };
}

/** The query split into words, each ready to match. */
export interface SearchQuery {
  raw: string;
  words: { ar?: string; latin?: string; skel?: string; digits?: string }[];
}

export function prepareQuery(query: string): SearchQuery {
  const words = query
    .split(/[\s,،.\-_/]+/)
    .filter(Boolean)
    .map((w) => {
      const digits = w.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
      if (/^\d+$/.test(digits)) return { digits };
      if (ARABIC.test(w)) {
        const ar = stripAl(normalizeArabic(w).replace(/\s/g, ''));
        return ar ? { ar } : {};
      }
      const latin = foldLatin(w).replace(/\s/g, '');
      const skel = skeleton(latin);
      // Short skeletons match too much; "afasy" (fs) is still specific enough with four letters typed.
      const useSkel = skel.length >= 3 || (skel.length === 2 && latin.length >= 4);
      return latin ? { latin, skel: useSkel ? skel : undefined } : {};
    })
    .filter((w) => w.ar || w.latin || w.digits);
  return { raw: query.trim(), words };
}

/**
 * How well [q] matches: 0 = no match; higher is better. Every word of the query must be found in one of [fields]
 * (in order of importance: a match in the first field, e.g. the name, ranks above one in a later field).
 * [numbers] are matched exactly by digits in the query (a sura's number, a page...).
 */
export function searchScore(q: SearchQuery, fields: SearchText[], numbers: number[] = []): number {
  if (!q.words.length) return 1;
  let score = 0;
  for (const w of q.words) {
    let best = 0;
    if (w.digits) {
      if (numbers.some((n) => String(n) === String(Number(w.digits)))) best = 100;
      else for (const f of fields) if (f.latin.includes(w.digits)) best = Math.max(best, 20);
    }
    fields.forEach((f, i) => {
      const weight = i === 0 ? 1 : 0.6;
      let s = 0;
      if (w.ar) {
        if (f.arWords.some((x) => x.startsWith(w.ar!))) s = 60;
        else if (f.ar.includes(w.ar)) s = 40;
      }
      if (w.latin) {
        if (f.latinWords.some((x) => x.startsWith(w.latin!) || (x.startsWith('al') && x.slice(2).startsWith(w.latin!)))) s = Math.max(s, 60);
        else if (f.latin.includes(w.latin)) s = Math.max(s, 40);
        else if (w.skel && f.skel.includes(w.skel)) s = Math.max(s, 25);
      }
      best = Math.max(best, s * weight);
    });
    if (!best) return 0;
    score += best;
  }
  return score;
}

/** Items of [list] matching [query], best first (the original order among equals); all of them for no query. */
export function searchList<T>(list: readonly T[], query: string, fields: (item: T) => SearchText[], numbers?: (item: T) => number[]): T[] {
  const q = prepareQuery(query);
  if (!q.words.length) return [...list];
  return list
    .map((item, i) => ({ item, i, s: searchScore(q, fields(item), numbers?.(item)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

/** Quick yes / no for one item. */
export function searchMatches(query: string, ...texts: (string | undefined | null)[]): boolean {
  const q = prepareQuery(query);
  return !q.words.length || searchScore(q, [prepareSearch(...texts)]) > 0;
}
