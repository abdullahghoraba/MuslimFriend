import pagesJson from '../../../../public/assets/quran/shamarly-pages.json';
import texts from '../../../../public/assets/quran/text.json';
import metaJson from '../../../../public/assets/quran/meta.json';
import { ayahWords, shamarlyLayout } from './mushaf-layout';
import { QuranMeta, globalIndex, quranSearchKey, refAt, splitBasmala } from './quran-utils';

const meta = metaJson as QuranMeta;
const indexOf = (sura: number, aya: number) => globalIndex(meta, { sura, aya });
const layout = shamarlyLayout((pagesJson as { start: ([number, number, number] | null)[] }).start, indexOf);
const words = (index: number) => {
  const ref = refAt(meta, index);
  return ayahWords(splitBasmala(ref, (texts as string[])[index]).text);
};
const pageText = (p: number) => layout.pieces(p).map((x) => words(x.index).slice(x.from, x.to).join(' ')).join(' ');

describe('Shamarly page layout', () => {
  it('has 522 pages, the cover first and al-Fatihah on page 2', () => {
    expect(layout.pages).toBe(522);
    expect(layout.pieces(1)).toEqual([]);
    expect(layout.pieces(2).map((x) => refAt(meta, x.index))).toEqual(Array.from({ length: 7 }, (_, i) => ({ sura: 1, aya: i + 1 })));
  });

  it('gives every word of the Quran to exactly one page, in order', () => {
    let next = { index: 0, word: 0 };
    for (let p = 2; p <= layout.pages; p++) {
      for (const piece of layout.pieces(p)) {
        expect({ index: piece.index, word: piece.from }).toEqual(next);
        const n = words(piece.index).length;
        const to = piece.to ?? n;
        expect(to).toBeGreaterThan(piece.from);
        expect(to).toBeLessThanOrEqual(n);
        next = to === n ? { index: piece.index + 1, word: 0 } : { index: piece.index, word: to };
      }
    }
    expect(next).toEqual({ index: 6236, word: 0 });
  });

  it('breaks pages inside ayat where the printed Shamarly does', () => {
    // Checked on the scans: page 100 starts «مع الشاهدين» (al-Ma'idah 83), page 251 «فأبوا أن يضيفوهما».
    const starts = (p: number, t: string) => quranSearchKey(pageText(p)).startsWith(quranSearchKey(t));
    const ends = (p: number, t: string) => quranSearchKey(pageText(p)).endsWith(quranSearchKey(t));
    expect(starts(100, 'مع الشاهدين')).toBe(true);
    expect(ends(99, 'فاكتبنا')).toBe(true);
    expect(starts(251, 'فأبوا أن')).toBe(true);
    expect(ends(250, 'أهلها')).toBe(true);
    expect(starts(24, 'وما أهل')).toBe(true);
    expect(starts(367, 'إن الله عزيز غفور')).toBe(true);
  });

  it('finds the page where an ayah begins', () => {
    expect(layout.pageOf(indexOf(1, 1))).toBe(2);
    expect(layout.pageOf(indexOf(2, 1))).toBe(3);
    expect(layout.pageOf(indexOf(5, 83))).toBe(99); // begins on 99, ends on 100
    expect(layout.pageOf(indexOf(5, 84))).toBe(100);
    expect(layout.pageOf(indexOf(114, 6))).toBe(522);
    for (let i = 0; i < 6236; i += 97) {
      const p = layout.pageOf(i);
      expect(layout.pieces(p).some((x) => x.index === i && x.from === 0)).toBe(true);
    }
  });
});
