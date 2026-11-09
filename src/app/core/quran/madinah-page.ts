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
