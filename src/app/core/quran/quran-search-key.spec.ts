import texts from '../../../../public/assets/quran/text.json';
import metaJson from '../../../../public/assets/quran/meta.json';
import { QuranMeta, globalIndex, normalizeArabic, quranSearchKey, refAt } from './quran-utils';
import { highlight } from '../../pages/quran-search/quran-search.page';

const meta = metaJson as QuranMeta;
const keys = (texts as string[]).map(quranSearchKey);
const find = (q: string) => keys.flatMap((k, i) => (k.includes(quranSearchKey(q)) ? [refAt(meta, i)] : []));
const at = (sura: number, aya: number) => keys[globalIndex(meta, { sura, aya })];

describe('Quran search in everyday spelling', () => {
  it('finds words the mushaf spells differently', () => {
    expect(find('الصلاة')).toContainEqual({ sura: 2, aya: 45 }); // ٱلصَّلَوٰةِ
    expect(find('الزكاة')).toContainEqual({ sura: 2, aya: 43 }); // ٱلزَّكَوٰةَ
    expect(find('الحياة الدنيا')).toContainEqual({ sura: 2, aya: 85 }); // ٱلْحَيَوٰةِ
    expect(find('الكتاب')).toContainEqual({ sura: 2, aya: 2 }); // ٱلْكِتَـٰبُ
    expect(find('الرحمن الرحيم')).toContainEqual({ sura: 1, aya: 3 });
    expect(find('سبع سماوات')).toContainEqual({ sura: 2, aya: 29 }); // سَبْعَ سَمَـٰوَٰتٍ
    expect(find('السماوات والأرض')).toContainEqual({ sura: 2, aya: 164 });
    expect(find('ذلك')).toContainEqual({ sura: 2, aya: 2 }); // ذَٰلِكَ
  });

  it('still finds a word inside a longer one, as before', () => {
    expect(find('الصبر')).toContainEqual({ sura: 2, aya: 45 }); // بِٱلصَّبْرِ
    expect(find('صبر').length).toBeGreaterThan(50);
    expect(at(2, 255)).toContain(quranSearchKey('الحي القيوم'));
  });

  it('highlights the match in the original text with its tashkeel', () => {
    const text = (texts as string[])[globalIndex(meta, { sura: 2, aya: 45 })];
    const parts = highlight(text, [quranSearchKey('الصلاة')]);
    const marked = parts.filter((p) => p.match).map((p) => p.text).join('');
    expect(normalizeArabic(marked)).toBe('لصلوه');
    expect(parts.map((p) => p.text).join('')).toBe(text);
  });
});
