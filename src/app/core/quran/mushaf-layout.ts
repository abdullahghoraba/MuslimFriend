/**
 * How a printed mushaf spreads the ayat over its pages. The Madinah mushaf ends every page with a whole ayah; the
 * Shamarly mushaf breaks pages inside ayat, so a page holds pieces of ayat: a run of the ayah's words.
 */

/** Words [from, to) of the ayah with global index [index] (to undefined: to the end, with the ayah's number). */
export interface PagePiece {
  index: number;
  from: number;
  to?: number;
}

export interface MushafLayout {
  id: 'madinah' | 'shamarly';
  pages: number;
  /** The pieces of ayat on page [p], in order. */
  pieces(p: number): PagePiece[];
  /** The page where the ayah with global index [index] begins. */
  pageOf(index: number): number;
}

/** Pause marks (ۚ ۖ ۗ ...) written as separate "words" belong to the word before them. */
const PAUSE = /^[ۖ-ۭ۞۩]+$/;

/**
 * The words of an ayah's text (without the basmala that precedes a sura's first ayah), as counted for page breaks:
 * a pause mark stays with the word before it. Must match words() in scripts/shamarly-ayat/splits.py.
 */
export function ayahWords(text: string): string[] {
  const out: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (PAUSE.test(w) && out.length) out[out.length - 1] += ` ${w}`;
    else out.push(w);
  }
  return out;
}

/**
 * The Shamarly layout from its page starts: starts[p - 1] = [sura, aya, word] where page p begins (null for the cover
 * page, which has no ayat). [indexOf] gives an ayah's global index.
 */
export function shamarlyLayout(starts: ([number, number, number] | null)[], indexOf: (sura: number, aya: number) => number, totalAyat = 6236): MushafLayout {
  // Page starts as positions (global ayah index, word), for searching.
  const pos = starts.map((s) => (s ? { index: indexOf(s[0], s[1]), word: s[2] } : null));
  const pages = starts.length;
  const nextStart = (p: number): { index: number; word: number } => {
    for (let q = p; q < pages; q++) if (pos[q]) return pos[q]!;
    return { index: totalAyat, word: 0 };
  };
  return {
    id: 'shamarly',
    pages,
    pieces(p: number): PagePiece[] {
      const s = pos[p - 1];
      if (!s) return [];
      const end = nextStart(p);
      const out: PagePiece[] = [];
      for (let i = s.index; i <= Math.min(end.index, totalAyat - 1); i++) {
        const from = i === s.index ? s.word : 0;
        const to = i === end.index ? end.word : undefined;
        if (to === undefined || to > from) out.push(to === undefined ? { index: i, from } : { index: i, from, to });
      }
      return out;
    },
    pageOf(index: number): number {
      // The last page starting at or before the ayah's first word.
      let lo = 0;
      let hi = pages - 1;
      let found = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        let m = mid;
        while (m >= lo && !pos[m]) m--;
        if (m < lo) {
          lo = mid + 1;
          continue;
        }
        const at = pos[m]!;
        if (at.index < index || (at.index === index && at.word === 0)) {
          found = m + 1;
          lo = mid + 1;
        } else hi = m - 1;
      }
      return found;
    },
  };
}
