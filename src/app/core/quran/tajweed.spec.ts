import { readFileSync } from 'node:fs';
import { alignTajweed, tajweedParts } from './tajweed';
import { riwayaFromKfgqpc } from './mushaf-editions.service';

describe('tajweed', () => {
  it('keeps only text and known rules from the markup', () => {
    const parts = tajweedParts('مِ<tajweed class=ghunnah>نّ</tajweed> <tajweed class=evil onclick=x>ا</tajweed><img src=x>ب <span class=end>١</span>');
    // Unknown tags and attributes are dropped, their letters kept as plain text.
    expect(parts.map((p) => p.text).join('')).toBe('مِنّ اب');
    expect(parts.filter((p) => p.rule)).toEqual([{ text: 'نّ', rule: 'ghunnah' }]);
  });

  it('colours the app\'s own text and never changes it (1:6 and 2:4, written differently in the markup)', () => {
    const text16 = 'ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ';
    const mark16 = '<tajweed class=ham_wasl>ٱ</tajweed>هْدِنَا <tajweed class=ham_wasl>ٱ</tajweed><tajweed class=laam_shamsiyah>ل</tajweed>صِّرَ<tajweed class=madda_normal>ٲ</tajweed>طَ <tajweed class=ham_wasl>ٱ</tajweed>لْمُسْتَق<tajweed class=madda_permissible>ِي</tajweed>مَ <span class=end>٦</span>';
    const parts = alignTajweed(text16, mark16)!;
    expect(parts.map((p) => p.text).join('')).toBe(text16);
    expect(parts.filter((p) => p.rule === 'ham_wasl').map((p) => p.text)).toEqual(['ٱ', 'ٱ', 'ٱ']);
    expect(parts.find((p) => p.rule === 'laam_shamsiyah')?.text).toBe('ل');
    // The dagger alef is a mark of the raa in this text: the raa's cluster takes the madd colour.
    expect(parts.find((p) => p.rule === 'madda_normal')?.text).toBe('رَٰ');
  });

  it('leaves a word uncoloured when its letters do not line up', () => {
    const parts = alignTajweed('كَلِمَةٌ أُخْرَىٰ', '<tajweed class=ghunnah>كلمة</tajweed> <tajweed class=qalaqah>ب</tajweed>')!;
    expect(parts.map((p) => p.text).join('')).toBe('كَلِمَةٌ أُخْرَىٰ');
    expect(parts.some((p) => p.rule === 'qalaqah')).toBe(false);
  });

  it('gives up on an ayah whose words differ in number', () => {
    expect(alignTajweed('أَ بَ', 'أَ')).toBeNull();
  });
});

describe('riwayat (King Fahd Complex data)', () => {
  it('builds pages, taking the first page of an ayah that runs over two', () => {
    const m = riwayaFromKfgqpc([
      { page: '1', sura_no: 1, aya_no: 1, aya_text: 'اَ۬لْحَمْدُ ١ ', sura_name_ar: 'الفَاتِحة ' },
      { page: '2-3', sura_no: 2, aya_no: 1, aya_text: 'أَلَٓمِّٓ ١', sura_name_ar: 'البَقَرَة' },
      { page: 3, sura_no: 2, aya_no: 2, aya_text: 'ذَٰلِكَ ٢', sura_name_ar: 'البَقَرَة' },
    ]);
    expect(m.pages.map((p) => p.map(([s, a]) => `${s}:${a}`))).toEqual([['1:1'], ['2:1'], ['2:2']]);
    expect(m.pages[0][0][2]).toBe('اَ۬لْحَمْدُ ١');
    expect(m.suraNames).toEqual(['الفَاتِحة', 'البَقَرَة']);
  });
});

describe('Shamarly page map', () => {
  const map = JSON.parse(readFileSync('public/assets/quran/shamarly.json', 'utf8')) as { pages: number; first: ([number, number] | null)[]; rub: number[] };

  it('has 522 pages in reading order, al-Fatihah on page 2 and an-Nas on the last', () => {
    expect(map.pages).toBe(522);
    expect(map.first).toHaveLength(522);
    expect(map.first[1]).toEqual([1, 1]);
    expect(map.first[2]).toEqual([2, 1]);
    expect(map.rub).toHaveLength(240);
    let prev = 0;
    for (const f of map.first) {
      if (!f) continue;
      const key = f[0] * 1000 + f[1];
      expect(key).toBeGreaterThan(prev);
      prev = key;
    }
    expect(prev).toBeLessThanOrEqual(114 * 1000 + 6);
  });
});
