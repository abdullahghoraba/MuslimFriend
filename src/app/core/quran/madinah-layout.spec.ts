import linesJson from '../../../../public/assets/quran/madinah-lines.json';
import texts from '../../../../public/assets/quran/text.json';
import metaJson from '../../../../public/assets/quran/meta.json';
import { MadinahLinesData, MadinahRun, ayahWords, madinahLayout } from './mushaf-layout';
import { QuranMeta, globalIndex, refAt, splitBasmala } from './quran-utils';
import { madinahRows, sliceTajweed } from './madinah-page';
import { alignTajweed } from './tajweed';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MushafEditionsService } from './mushaf-editions.service';

const data = linesJson as MadinahLinesData;
const meta = metaJson as QuranMeta;
const layout = madinahLayout(data);
const indexOf = (sura: number, aya: number) => globalIndex(meta, { sura, aya });
const ayahAt = (index: number) => ({ ...refAt(meta, index), index, text: texts[index] });
const wordsOf = (index: number) => ayahWords(splitBasmala(ayahAt(index), texts[index]).text);

describe('Madinah printed line layout', () => {
  it('uses the verified page boundaries and fifteen rows from page 3 onwards', () => {
    expect(layout.pages).toBe(604);
    expect(refAt(meta, layout.pieces(3)[0].index)).toEqual({ sura: 2, aya: 6 });
    expect(refAt(meta, layout.pieces(604).at(-1)!.index)).toEqual({ sura: 114, aya: 6 });
    expect(layout.pageOf(indexOf(100, 6))).toBe(600);
    expect(data.pages.slice(2).every((lines) => lines.length === 15)).toBe(true);
    expect(layout.lines!(1)[0]).toEqual(['s', 1]);
    expect(layout.lines!(1).some((line) => line[0] === 'b')).toBe(false);
  });

  it('includes every word and ayah exactly once, in order, and merges line runs per ayah', () => {
    let next = { index: 0, word: 0 };
    const seen = new Set<number>();
    for (let p = 1; p <= 604; p++) {
      const pieces = layout.pieces(p);
      expect(new Set(pieces.map((piece) => piece.index)).size).toBe(pieces.length);
      for (const piece of pieces) {
        seen.add(piece.index);
        expect(piece.from).toBe(0);
        expect(piece.to).toBeUndefined();
        expect(layout.pageOf(piece.index)).toBe(p);
      }
      for (const line of layout.lines!(p)) {
        if (!Array.isArray(line[0])) continue;
        for (const [index, from, to] of line as MadinahRun[]) {
          expect({ index, word: from }).toEqual(next);
          const count = wordsOf(index).length;
          const end = to === -1 ? count : to;
          expect(end).toBeGreaterThan(from);
          expect(end).toBeLessThanOrEqual(count);
          next = to === -1 ? { index: index + 1, word: 0 } : { index, word: end };
        }
      }
    }
    expect(seen.size).toBe(6236);
    expect(next).toEqual({ index: 6236, word: 0 });
  });

  it('renders every run verbatim with one number at each ayah end', () => {
    for (let p = 1; p <= 604; p++) {
      const rows = madinahRows(layout.lines!(p), ayahAt, null);
      expect(rows.length).toBe(data.pages[p - 1].length);
      const words = rows.flatMap((row) => row.kind === 'text' ? row.words : []);
      expect(words.filter((word) => word.end).map((word) => word.ayah.index)).toEqual(layout.pieces(p).map((piece) => piece.index));
      expect(words.map((word) => word.text)).toEqual(layout.pieces(p).flatMap((piece) => wordsOf(piece.index)));
    }
  });

  it('keeps a trailing title on its page and the next page basmala before its text', () => {
    const p = data.pages.findIndex((lines) => lines.at(-1)?.[0] === 's');
    expect(p).toBeGreaterThanOrEqual(0);
    const title = data.pages[p].at(-1) as ['s', number];
    expect(madinahRows(data.pages[p], ayahAt, null).at(-1)).toEqual({ kind: 'title', sura: title[1] });
    const rows = madinahRows(data.pages[p + 1], ayahAt, null);
    expect(rows[0].kind).toBe('basmala');
    expect(rows.filter((row) => row.kind === 'title').some((row) => row.sura === title[1])).toBe(false);
  });

  it('slices aligned colours across lines without dropping pause marks or changing text', () => {
    const index = indexOf(2, 6);
    const text = splitBasmala(ayahAt(index), texts[index]).text;
    const markup = `<tajweed class=ghunnah>${text}</tajweed>`;
    const tajweed: string[] = [];
    tajweed[index] = markup;
    const rows = madinahRows([[[index, 0, 3]], [[index, 3, -1]]], ayahAt, tajweed);
    const words = rows.flatMap((row) => row.kind === 'text' ? row.words : []);
    const aligned = alignTajweed(text, markup)!;
    let offset = 0;
    for (const word of words) {
      const start = text.indexOf(word.text, offset);
      offset = start + word.text.length;
      expect(word.parts).toEqual(sliceTajweed(aligned, start, offset));
      expect(word.parts!.map((part) => part.text).join('')).toBe(word.text);
    }
    expect(words.some((word) => word.parts?.some((part) => part.rule === 'ghunnah'))).toBe(true);
    expect(words.filter((word) => word.end)).toHaveLength(1);
    expect(words.map((word) => word.text)).toEqual(wordsOf(index));
  });

  it('shares a single HTTP load between callers and subsequent opens', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(MushafEditionsService);
    const http = TestBed.inject(HttpTestingController);
    const first = service.madinahLayout();
    expect(service.madinahLayout()).toBe(first);
    http.expectOne('assets/quran/madinah-lines.json').flush(data);
    const result = await first;
    expect(await service.madinahLayout()).toBe(result);
    http.verify();
  });
});
