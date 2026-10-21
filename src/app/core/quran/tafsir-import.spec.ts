import { REMOTE_TAFSIRS, parseTafsirFile, spa5kToAyat } from './tafsir-library.service';

describe('spa5kToAyat', () => {
  it('keeps a passage repeated over several ayat on the first one only', () => {
    const out = spa5kToAyat([
      { ayah: 2, text: 'B' }, { ayah: 1, text: 'A' }, { ayah: 3, text: 'B' }, { ayah: 4, text: '<p>C</p>' }, { ayah: 9, text: 'x' },
    ], 5);
    expect(out).toEqual(['A', 'B', '', 'C', '']);
  });

  it('drops printed page markers', () => {
    expect(spa5kToAyat([{ ayah: 1, text: 'صفحة ١٣٧\nالبسملة اسم' }, { ayah: 2, text: '(p-٣٦٩)سورة الإخلاص' }], 2))
      .toEqual(['البسملة اسم', 'سورة الإخلاص']);
  });
});

describe('REMOTE_TAFSIRS', () => {
  it('has unique ids and every open-dataset entry names its folder', () => {
    const ids = REMOTE_TAFSIRS.map((t) => t.apiId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(REMOTE_TAFSIRS.filter((t) => t.provider === 'spa5k').every((t) => !!t.slug)).toBe(true);
  });
});

const counts = [7, 286, 200];

describe('parseTafsirFile', () => {
  it('reads the app format with name, author, language and source', () => {
    const file = JSON.stringify({
      type: 'muslim-friend-tafsir', name: 'في ظلال القرآن', nameEn: 'Fi Zilal al-Quran', author: 'سيد قطب',
      lang: 'ar', source: 'نسخة شخصية', ayahs: { '1:1': 'الفاتحة <b>مكية</b>', '2:255': 'آية الكرسي', '2:256': '' },
    });
    const t = parseTafsirFile(file, counts);
    expect(t.nameAr).toBe('في ظلال القرآن - سيد قطب');
    expect(t.nameEn).toBe('Fi Zilal al-Quran');
    expect(t.lang).toBe('ar');
    expect(t.source).toBe('نسخة شخصية');
    expect(t.suras[0][0]).toBe('الفاتحة مكية');
    expect(t.suras[1][254]).toBe('آية الكرسي');
    expect(t.suras[1][255]).toBe('');
    expect(t.filled).toBe(2);
    expect(t.suras.map((s) => s.length)).toEqual(counts);
  });

  it('accepts a bare verse map (QUL style) and treats verse-key values as "explained with an earlier verse"', () => {
    const file = JSON.stringify({ '2:1': { text: 'الم' }, '2:2': '2:1', '9:1': 'out of range', 'x': 'junk' });
    const t = parseTafsirFile(file, counts, 'my-tafsir.json');
    expect(t.nameAr).toBe('my-tafsir');
    expect(t.suras[1][0]).toBe('الم');
    expect(t.suras[1][1]).toBe('');
    expect(t.filled).toBe(1);
  });

  it('rejects non-JSON, wrong shapes and files without any text', () => {
    expect(() => parseTafsirFile('not json', counts)).toThrow('not-json');
    expect(() => parseTafsirFile('[1,2]', counts)).toThrow('bad-format');
    expect(() => parseTafsirFile('{"1:1": ""}', counts)).toThrow('empty');
  });
});
