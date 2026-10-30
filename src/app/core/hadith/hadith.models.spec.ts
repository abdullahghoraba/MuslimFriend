import { readFileSync } from 'node:fs';
import { HadithPackage, dailyIndex, gradeKind, hadithText, normalizeHadith, readHadiths, sourceGradeKind, validateEdition } from './hadith.models';

describe('Hadith source handling', () => {
  const pack: HadithPackage = { version: 1, collection: 'test', editions: {
    ar: { metadata: { name: 'test', sections: { '1': 'Book' } }, hadiths: [
      { hadithnumber: 1.01, arabicnumber: '1.01', text: 'الأَعْمَالُ<br>بالنِّيَّاتِ', grades: [{ name: 'A', grade: 'Sahih' }], reference: { book: 1, hadith: 1 } },
      { hadithnumber: 2, text: 'الثاني', grades: [], reference: { book: 1, hadith: 2 } },
    ] },
    en: { metadata: { name: 'test', sections: { '1': 'Book' } }, hadiths: [
      { hadithnumber: 2, text: 'Second', grades: [], reference: { book: 1, hadith: 2 } },
      { hadithnumber: '1.01', text: 'Actions &amp; intentions', grades: [{ name: 'B', grade: 'Daif' }], reference: { book: 1, hadith: 1 } },
    ] },
    fr: { metadata: { name: 'test', sections: { '1': 'Livre' } }, hadiths: [
      { hadithnumber: 2, text: 'Deuxième', grades: [], reference: { book: 1, hadith: 2 } },
    ] },
  } };
  it('joins shuffled translations by decimal source ID and falls back per hadith', () => {
    const rows = readHadiths(pack, 'fr');
    expect(rows[0]).toMatchObject({ number: '1.01', arabic: 'الأَعْمَالُ\nبالنِّيَّاتِ', translation: 'Actions & intentions', translationLang: 'en' });
    expect(rows[0].grades).toHaveLength(2);
    expect(rows[1]).toMatchObject({ translation: 'Deuxième', translationLang: 'fr' });
    expect(readHadiths(pack, 'ar')[0].translation).toBe('');
    const onlyArabic = { ...pack, editions: { ar: pack.editions['ar'] } };
    expect(readHadiths(onlyArabic, 'zh')[0].translation).toBe('');
  });
  it('normalizes vocalization, hamza, tatweel and Arabic digits', () => {
    expect(normalizeHadith('إِنَّ الأَعْمَــالَ آية ١٣')).toBe(normalizeHadith('ان الاعمال اية 13'));
    expect(normalizeHadith('مسؤول سئل')).toBe(normalizeHadith('مسوول سيل'));
  });
  it('preserves disagreement and does not call a negated sahih ruling sound', () => {
    expect(gradeKind('ليس بصحيح')).toBe('daif');
    expect(gradeKind('إسناده ضعيف فيه فلان مجهول')).toBe('daif');
    expect(gradeKind('موضوع')).toBe('mawdu');
    expect(gradeKind('Hasan Sahih')).toBe('sahih');
    expect(gradeKind('Hasan')).toBe('hasan');
    // A broken chain (munqati') is one of the kinds of weak hadith.
    expect(gradeKind('منقطع')).toBe('daif');
  });
  it('uses local calendar days without DST or time-of-day drift', () => {
    const morning = new Date(2026, 9, 29, 0, 1), evening = new Date(2026, 9, 29, 23, 59);
    expect(dailyIndex(morning, 9)).toBe(dailyIndex(evening, 9));
    expect(dailyIndex(new Date(2026, 9, 30), 9)).toBe((dailyIndex(morning, 9) + 1) % 9);
  });
  it('rejects duplicate IDs, broken references and invalid grades', () => {
    validateEdition(pack.editions['ar']);
    const bad = structuredClone(pack.editions['ar']); bad.hadiths.push(bad.hadiths[0]);
    expect(() => validateEdition(bad)).toThrow();
    expect(() => validateEdition({ hadiths: [] })).toThrow();
    expect(() => validateEdition({ ...bad, hadiths: [{ ...bad.hadiths[0], grades: [{}] }] })).toThrow();
  });
  it('keeps source content as inert plain text', () => {
    expect(hadithText('<script>alert(1)</script><b>Text</b><br>next &amp; more')).toBe('Text\nnext & more');
  });
});

describe('grade from a bundled hadith\'s source line', () => {
  it('never rates higher than the source says', () => {
    expect(sourceGradeKind('رواه البخاري ومسلم')).toBe('sahih');
    expect(sourceGradeKind('متفق عليه')).toBe('sahih');
    expect(sourceGradeKind('رواه أبو داود · حسن')).toBe('hasan');
    expect(sourceGradeKind('حديث حسن، رواه الترمذي')).toBe('hasan');
    // al-Nawawi's «حسن صحيح» for hadith 41 stays hasan: other scholars weaken it (see the Dorar lookup).
    expect(sourceGradeKind('حديث حسن صحيح، رويناه في كتاب "الحجة" بإسناد صحيح')).toBe('hasan');
    expect(sourceGradeKind('رواه أحمد')).toBe('unknown');
    expect(sourceGradeKind('رواه أبو داود وإسناده ضعيف')).toBe('daif');
    expect(sourceGradeKind('')).toBe('unknown');
  });

  it('gives a hadith of the day for months without repeating, each with narrator and source', () => {
    const daily = JSON.parse(readFileSync('public/assets/hadith/daily.json', 'utf8')) as { narrator: string; authenticitySource: string; texts: Record<string, string> }[];
    expect(daily.length).toBeGreaterThanOrEqual(75);
    for (const d of daily) expect(d.narrator && d.authenticitySource && d.texts['ar']).toBeTruthy();
  });
});

describe('grade of a scholar\'s ruling', () => {
  it('reads rejection and defects as weak even when «صحيح» appears', () => {
    expect(gradeKind('تصحيح هذا الحديث بعيد جداً من وجوه')).toBe('daif');
    expect(gradeKind('إسناده منقطع')).toBe('daif');
    expect(gradeKind('فيه نظر')).toBe('daif');
    expect(gradeKind('إسناده صحيح')).toBe('sahih');
    expect(gradeKind('حسن صحيح')).toBe('sahih');
    expect(gradeKind('حسن')).toBe('hasan');
    expect(gradeKind('رجاله ثقات')).toBe('unknown');
  });
});
