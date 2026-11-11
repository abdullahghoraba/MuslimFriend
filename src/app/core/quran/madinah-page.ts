import { Ayah } from './quran.service';
import { MadinahLine, MadinahRun, ayahWords } from './mushaf-layout';
import { BASMALA, splitBasmala } from './quran-utils';
import { TajweedPart, alignTajweed } from './tajweed';

export interface MadinahWord {
  ayah: Ayah;
  text: string;
  parts?: TajweedPart[];
  /** Only the last word of an ending run carries the number and badges. */
  end: boolean;
}

export type MadinahRow =
  | { kind: 'title'; sura: number }
  | { kind: 'basmala'; text: string; parts?: TajweedPart[] }
  | { kind: 'text'; words: MadinahWord[] };

/** Slice already aligned runs by UTF-16 offsets, preserving every character and its colour. */
export function sliceTajweed(parts: TajweedPart[], from: number, to: number): TajweedPart[] {
  const out: TajweedPart[] = [];
  let offset = 0;
  for (const part of parts) {
    const end = offset + part.text.length;
    if (end > from && offset < to) {
      out.push({ ...part, text: part.text.slice(Math.max(0, from - offset), to - offset) });
    }
    offset = end;
    if (offset >= to) break;
  }
  return out;
}

/** Align once per ayah, then distribute its words (including attached pause marks) to printed rows. */
export function madinahRows(lines: MadinahLine[], ayahAt: (index: number) => Ayah, tajweed: string[] | null): MadinahRow[] {
  const cache = new Map<number, MadinahWord[]>();
  const wordsOf = (index: number): MadinahWord[] => {
    const saved = cache.get(index);
    if (saved) return saved;
    const ayah = ayahAt(index);
    const text = splitBasmala(ayah, ayah.text).text;
    const parts = tajweed?.[index] ? alignTajweed(text, tajweed[index]) : null;
    let offset = 0;
    const words = ayahWords(text).map((word) => {
      const from = text.indexOf(word, offset);
      offset = from + word.length;
      return { ayah, text: word, parts: parts ? sliceTajweed(parts, from, offset) : undefined, end: false };
    });
    cache.set(index, words);
    return words;
  };
  return lines.map((line, row): MadinahRow => {
    if (line[0] === 's') return { kind: 'title', sura: line[1] as number };
    if (line[0] === 'b') {
      // A title may be on the preceding page. Read the prefix of the next text run, not the preceding title.
      const next = lines.slice(row + 1).find((l) => Array.isArray(l[0])) as MadinahRun[] | undefined;
      const ayah = next ? ayahAt(next[0][0]) : undefined;
      const text = ayah ? splitBasmala(ayah, ayah.text).basmalaText || BASMALA : BASMALA;
      return { kind: 'basmala', text, parts: tajweed?.[0] ? alignTajweed(text, tajweed[0]) ?? undefined : undefined };
    }
    return {
      kind: 'text',
      words: (line as MadinahRun[]).flatMap(([index, from, to]) => {
        const words = wordsOf(index).slice(from, to === -1 ? undefined : to);
        return words.map((word, i) => ({ ...word, end: to === -1 && i === words.length - 1 }));
      }),
    };
  });
}

// ---- The Madinah pages in the King Fahd Complex's own text and font ---------------------------------------------------

/** One text line of madinah-qpc.json: the QPC words of each run of the same line of madinah-lines.json. */
export type QpcLine = ['s', number] | ['b'] | string[];
export interface MadinahQpcData { source: unknown; pages: QpcLine[][] }

/** The basmala in the QPC text (al-Fatihah's first ayah). */
export const QPC_BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

/** Arabic-Indic digits: the KFGQPC font draws them inside the ayah-end ornament. */
export const ayahMark = (n: number) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);

/**
 * The rows of a Madinah page in the QPC text: the same lines, ayat and ayah ends as [madinahRows], with each run's
 * words taken from [qpc] (the King Fahd Complex's text, which its font and line breaks were made for).
 */
export function madinahQpcRows(lines: MadinahLine[], qpc: QpcLine[], ayahAt: (index: number) => Ayah): MadinahRow[] {
  return lines.map((line, row): MadinahRow => {
    if (line[0] === 's') return { kind: 'title', sura: line[1] as number };
    if (line[0] === 'b') return { kind: 'basmala', text: QPC_BASMALA };
    const texts = qpc[row] as string[];
    return {
      kind: 'text',
      words: (line as MadinahRun[]).flatMap(([index, , to], k) => {
        const ayah = ayahAt(index);
        const words = (texts?.[k] ?? '').split(' ').filter(Boolean);
        return words.map((text, i) => ({ ayah, text, end: to === -1 && i === words.length - 1 }));
      }),
    };
  });
}

// ---- Kashida: lines are filled the way the print fills them, by drawing letters out, not by wide spaces ------------

const MARK = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF]/;
/** Letters that join the letter after them (a tatweel can follow them inside a word). */
const JOINS_NEXT = new Set([...'بتثجحخسشصضطظعغفقكلمنهيئىـٮڡٯ']);
const ALEFS = new Set([...'اأإآٱ']);
export const TATWEEL = 'ـ';

/**
 * The places in [word] (string offsets) where a tatweel may go: after a letter that joins the next one (and after its
 * marks), never inside lam-alef (a ligature). Later places first: the print draws out a word near its end.
 */
export function kashidaPlaces(word: string): number[] {
  const chars = [...word];
  const places: number[] = [];
  let offset = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    offset += c.length;
    if (MARK.test(c) || !JOINS_NEXT.has(c)) continue;
    // Skip this letter's marks: the tatweel goes after them.
    let j = i + 1;
    let at = offset;
    while (j < chars.length && MARK.test(chars[j])) at += chars[j++].length;
    const next = chars[j];
    if (!next || MARK.test(next) || next === ' ') continue;
    if (c === 'ل' && ALEFS.has(next)) continue;
    places.push(at);
  }
  return places.reverse();
}

/**
 * How many tatweels each word gets to fill [missing] pixels when one tatweel is [tatweel] pixels wide: spread over
 * the words that can take one (longest first), at most [max] per word (by default 3, more on lines of few words),
 * keeping a little of the space as spacing.
 */
export function kashidaCounts(words: string[], missing: number, tatweel: number, max?: number): number[] {
  const counts = words.map(() => 0);
  if (missing <= 0 || tatweel <= 0) return counts;
  let left = Math.floor((missing * 0.85) / tatweel);
  const able = words.map((w, i) => ({ i, len: [...w].filter((c) => !MARK.test(c)).length, ok: kashidaPlaces(w).length > 0 }))
    .filter((w) => w.ok)
    .sort((a, b) => b.len - a.len);
  // Lines of few words are drawn out further, as in the print (al-Falaq's «حاسد إذا حسد»): 3 per word, up to 8.
  const cap = max ?? Math.max(3, Math.min(8, Math.ceil(left / Math.max(1, able.length))));
  for (let round = 0; round < cap && left > 0; round++) {
    for (const w of able) {
      if (left <= 0) break;
      counts[w.i]++;
      left--;
    }
  }
  return counts;
}

/** [word] with [count] tatweels, at its last place (two places when there are several). */
export function drawOut(word: string, count: number): string {
  const places = kashidaPlaces(word);
  if (!count || !places.length) return word;
  const plan = new Map<number, number>();
  if (count > 1 && places.length > 1) {
    plan.set(places[0], Math.ceil(count / 2));
    plan.set(places[1], Math.floor(count / 2));
  } else plan.set(places[0], count);
  let out = word;
  for (const at of [...plan.keys()].sort((a, b) => b - a)) out = out.slice(0, at) + TATWEEL.repeat(plan.get(at)!) + out.slice(at);
  return out;
}

// ---- The flowing Madinah text (the default view) -------------------------------------------------------------------

/**
 * Each ayah's text in the King Fahd Complex's Hafs text (QPC), by global ayah index, joined from the printed lines:
 * the text its font was drawn for, without the ayah number (the font draws [ayahMark] in its ornament).
 */
export function qpcAyahTexts(lines: { pages: MadinahLine[][] }, qpc: MadinahQpcData): string[] {
  const texts: string[][] = [];
  lines.pages.forEach((page, p) =>
    page.forEach((line, row) => {
      if (line[0] === 's' || line[0] === 'b') return;
      const runs = qpc.pages[p]?.[row] as string[] | undefined;
      (line as MadinahRun[]).forEach(([index], k) => {
        const words = runs?.[k]?.trim();
        if (words) (texts[index] ??= []).push(words);
      });
    }),
  );
  return Array.from({ length: texts.length }, (_, i) => (texts[i] ?? []).join(' '));
}

// ---- The printed page (QCF v2 page fonts) ---------------------------------------------------------------------------

/** Words of one ayah on one printed line, as glyphs of the page's font; end = 1 when they end with the ayah's number. */
export type QcfRun = [index: number, glyphs: string[], end: 0 | 1];
export type QcfLine = ['s', number] | ['b'] | QcfRun[];
/** madinah-qcf.json (scripts/madinah-qcf/build.mjs). */
export interface MadinahQcfData { source: unknown; font: string; pages: QcfLine[][] }

/** The font family of a page of the printed Madinah mushaf (one font per page). */
export const qcfFamily = (page: number) => `qcf-p${page}`;

/** The surah-name font of the same set: draws «سورة …» in the print's calligraphy from the sura's number ("003"). */
export const QCF_SURAH_NAMES_URL = 'https://static.qurancdn.com/fonts/quran/surah-names/v2/sura_names.woff2';
export const QCF_SURAH_NAMES_FAMILY = 'qcf-surah-names';
export const surahGlyph = (sura: number) => String(sura).padStart(3, '0');

/** The basmala as the print writes it: al-Fatihah's first ayah on page 1 without its number, in page 1's font. */
export function qcfBasmala(data: MadinahQcfData): string[] {
  const line = data.pages[0]?.[1] as QcfRun[] | undefined;
  return line?.[0]?.[1].slice(0, -1) ?? [];
}
