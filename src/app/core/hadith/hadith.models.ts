export interface HadithGrade { name: string; grade: string }
export interface SourceHadith {
  hadithnumber: number | string;
  arabicnumber?: number | string;
  text: string;
  grades: HadithGrade[];
  reference: { book: number; hadith: number };
}
export interface HadithEdition {
  metadata: { name: string; sections: Record<string, string> };
  hadiths: SourceHadith[];
}
export interface HadithPackage { version: 1; collection: string; editions: Record<string, HadithEdition> }
export interface HadithCollection {
  id: string; nameAr: string; nameEn: string; count: number; bundled: boolean;
  editions: Record<string, string>;
  sections: { id: number; name: string; count: number }[];
}
export interface HadithPosition { collection: string; number: string; book: number }
export interface Hadith extends HadithPosition {
  arabic: string; translation: string; translationLang: string; grades: HadithGrade[];
  bookName: string; bookHadith: number; arabicNumber: string;
  narrator?: string; authenticitySource?: string;
}
export interface DailyHadith extends HadithPosition {
  narrator: string; authenticitySource: string; texts: Record<string, string>;
}
/** A saved hadith with its own copy of the text (collection 'dorar' for one found in the online encyclopedia). */
export interface HadithBookmark {
  collection: string; number: string; book: number; note: string; updated_at: number;
  arabic: string; translation: string; source: string;
}

/** Like Quran search: discard vocalisation/tatweel and unify alef/hamza variants. */
export function normalizeHadith(text: string): string {
  return text.normalize('NFKD').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0300-\u036fـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Source markup is never rendered as HTML. Decode in an inert document. */
export function hadithText(text: string): string {
  // Most large-collection rows are plain text; avoid thousands of inert documents during search.
  if (!/[<&]/.test(text)) return text.trim();
  const doc = new DOMParser().parseFromString(text.replace(/<br\s*\/?\s*>/gi, '\n'), 'text/html');
  doc.querySelectorAll('script,style,iframe').forEach((n) => n.remove());
  return doc.body.textContent?.trim() ?? '';
}

export type GradeKind = 'sahih' | 'hasan' | 'daif' | 'mawdu' | 'unknown';
export function gradeKind(text: string): GradeKind {
  const t = normalizeHadith(text);
  // Negation and weakness take precedence over a later occurrence of "sahih".
  if (/موضوع|مكذوب|maw[dt]u|fabricat/.test(t)) return 'mawdu';
  // Also a scholar rejecting a grading («تصحيح هذا الحديث بعيد», Ibn Rajab) or naming a defect in the chain.
  if (/ضعيف|لا يصح|لا يثبت|ليس بصحيح|غير صحيح|منكر|باطل|بعيد|فيه نظر|منقطع|انقطاع|مرسل|مجهول|da.?if|weak|not (?:sahih|saheeh|authentic)/.test(t)) return 'daif';
  if (/صحيح|sahih|saheeh/.test(t)) return 'sahih';
  if (/حسن|hasan/.test(t)) return 'hasan';
  return 'unknown';
}
export function gradeColor(text: string): string {
  return ({ sahih: 'success', hasan: 'tertiary', daif: 'warning', mawdu: 'danger', unknown: 'medium' })[gradeKind(text)];
}
export function dailyIndex(date: Date, count: number): number {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return ((day % count) + count) % count;
}
export function hadithLink(h: HadithPosition): string[] {
  // Encyclopedia hadith (HadeethEnc) open on their own page, with the explanation.
  return h.collection === 'enc' ? ['/hadith', 'enc', h.number] : ['/hadith', h.collection, String(h.book), h.number];
}

/** Keep decimal source IDs; an array index is not a hadith reference. */
export function readHadiths(pack: HadithPackage, lang: string): Hadith[] {
  const arabic = pack.editions['ar'];
  if (!arabic) return [];
  const local = new Map((pack.editions[lang]?.hadiths ?? []).map((h) => [String(h.hadithnumber), h]));
  const english = new Map((pack.editions['en']?.hadiths ?? []).map((h) => [String(h.hadithnumber), h]));
  return arabic.hadiths.filter((h) => h.text.trim()).map((h) => {
    const number = String(h.hadithnumber);
    const l = local.get(number), e = english.get(number);
    const translated = lang === 'ar' ? undefined : l?.text.trim() ? l : e?.text.trim() ? e : undefined;
    const grades = [...h.grades, ...(l?.grades ?? []), ...(e?.grades ?? [])];
    return {
      collection: pack.collection, number, book: h.reference.book, bookHadith: h.reference.hadith,
      arabicNumber: String(h.arabicnumber ?? h.hadithnumber), arabic: hadithText(h.text),
      translation: translated ? hadithText(translated.text) : '', translationLang: translated === l ? lang : 'en',
      bookName: (pack.editions[lang] ?? pack.editions['en'] ?? arabic).metadata.sections[String(h.reference.book)] ?? '',
      grades: grades.filter((g, i) => grades.findIndex((x) => x.name === g.name && x.grade === g.grade) === i),
    };
  });
}

export function validateEdition(value: unknown): asserts value is HadithEdition {
  const d = value as HadithEdition | null;
  if (!d || !d.metadata || !d.metadata.sections || !Array.isArray(d.hadiths) || !d.hadiths.length) throw Error('invalid-edition');
  const ids = new Set<string>();
  for (const h of d.hadiths) {
    const id = String(h.hadithnumber);
    if (!/^\d+(\.\d+)?$/.test(id) || ids.has(id) || typeof h.text !== 'string' || !Number.isInteger(h.reference?.book) || !Number.isInteger(h.reference?.hadith) || !Array.isArray(h.grades) || h.grades.some((g) => typeof g.name !== 'string' || typeof g.grade !== 'string')) throw Error('invalid-hadith');
    ids.add(id);
  }
}

/**
 * Grade implied by a bundled hadith's own source line («رواه البخاري ومسلم», «حديث حسن، رواه الترمذي»), when the data
 * gives no graders. Cautious: any «حسن» stays hasan (al-Nawawi's «حسن صحيح» is not upgraded), weakness wins, and a
 * source outside the two Sahihs without a stated grade is unknown (the Dorar lookup gives the scholars' rulings).
 */
export function sourceGradeKind(source: string): GradeKind {
  const t = normalizeHadith(source);
  if (!t) return 'unknown';
  if (/ضعيف|موضوع|منكر/.test(t)) return gradeKind(t);
  if (/حسن/.test(t)) return 'hasan';
  if (/صحيح|البخاري|مسلم|متفق عليه/.test(t)) return 'sahih';
  return 'unknown';
}

/** A saved hadith shown from its own copy of the text (its book need not be downloaded). */
export function bookmarkHadith(b: HadithBookmark, lang: string): Hadith {
  return {
    collection: b.collection, number: b.number, book: b.book, arabic: b.arabic, translation: b.translation,
    translationLang: lang, grades: [], bookName: '', bookHadith: 0, arabicNumber: b.number, authenticitySource: b.source,
  };
}
