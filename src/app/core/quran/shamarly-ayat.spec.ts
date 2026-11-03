import ayatJson from '../../../../public/assets/quran/shamarly-ayat.json';
import mapJson from '../../../../public/assets/quran/shamarly.json';
import metaJson from '../../../../public/assets/quran/meta.json';
import { ShamarlyArea, ShamarlyMap, shamarlyAyahAt } from './mushaf-editions.service';
import { QuranMeta } from './quran-utils';

const pages = (ayatJson as unknown as { pages: ShamarlyArea[][] }).pages;
const map = mapJson as unknown as ShamarlyMap;
const meta = metaJson as QuranMeta;

describe('Shamarly ayah areas', () => {
  it('cover every ayah once (plus the ayat that run on to the next page), page by page in order', () => {
    expect(pages).toHaveLength(522);
    const seen = new Set<string>();
    let last = -1;
    for (const page of pages) {
      for (const [sura, aya, rects] of page) {
        const index = meta.suras[sura - 1].start + aya - 1;
        // Reading order: an ayah carried over from the page before may repeat once.
        expect(index).toBeGreaterThanOrEqual(last);
        last = index;
        seen.add(`${sura}:${aya}`);
        expect(rects.length % 4).toBe(0);
        expect(rects.length).toBeGreaterThan(0);
        for (let i = 0; i < rects.length; i += 4) {
          const [x0, y0, x1, y1] = rects.slice(i, i + 4);
          expect(0 <= x0 && x0 < x1 && x1 <= 1000 && 0 <= y0 && y0 < y1 && y1 <= 1000).toBe(true);
        }
      }
    }
    expect(seen.size).toBe(6236);
  });

  it('agree with the page map: each page starts with its first ayah', () => {
    map.first.forEach((f, i) => {
      if (f) expect(pages[i][0].slice(0, 2)).toEqual(f);
    });
  });

  it('find the ayah under a tap, and the nearest one on its line just beside the text', () => {
    const page: ShamarlyArea[] = [
      [2, 1, [600, 100, 900, 160]],
      [2, 2, [100, 100, 590, 160, 100, 170, 900, 230]],
    ];
    expect(shamarlyAyahAt(page, 700, 130)).toEqual({ sura: 2, aya: 1 });
    expect(shamarlyAyahAt(page, 300, 130)).toEqual({ sura: 2, aya: 2 });
    expect(shamarlyAyahAt(page, 500, 200)).toEqual({ sura: 2, aya: 2 });
    expect(shamarlyAyahAt(page, 920, 130)).toEqual({ sura: 2, aya: 1 });
    expect(shamarlyAyahAt(page, 500, 600)).toBeNull();
  });

  it('put al-Baqarah 255 (Ayat al-Kursi) on the Shamarly page the map gives', () => {
    const p = pages.findIndex((page) => page.some(([s, a]) => s === 2 && a === 255)) + 1;
    expect(map.first[p - 1]![0]).toBe(2);
    expect(map.first[p - 1]![1]).toBeLessThanOrEqual(255);
    expect(map.first[p]![1]).toBeGreaterThanOrEqual(255);
  });
});
