/** Pure Quran helpers (no Angular), shared by the service, search and tests. */

export interface SuraMeta {
  index: number;
  ayas: number;
  /** Global index of the sura's first ayah (0-based). */
  start: number;
  name: string;
  tname: string;
  ename: string;
  type: 'Meccan' | 'Medinan';
  order: number;
}

export interface AyahRef {
  sura: number;
  aya: number;
}

export interface QuranMeta {
  suras: SuraMeta[];
  juz: AyahRef[];
  quarters: AyahRef[];
  pages: AyahRef[];
  sajdas: (AyahRef & { type: string })[];
  sources: {
    text: string;
    metadata: string;
    tafsir: Record<TafsirId, { nameAr: string; nameEn: string; by: string; lang: 'ar' | 'en' }>;
    tafsirNote: string;
  };
}

export type TafsirId = 'muyassar' | 'jalalayn' | 'sahih';
export const TAFSIR_IDS: TafsirId[] = ['muyassar', 'jalalayn', 'sahih'];

export const TOTAL_AYAT = 6236;
export const TOTAL_PAGES = 604;

/** The basmala exactly as it prefixes the first ayah of suras 2–114 (except 9) in the Tanzil Uthmani text. */
// Written with escapes so editors cannot reorder the marks: Tanzil puts shadda (0651) before fatha (064E).
export const BASMALA =
  'بِسْمِ ٱللَّهِ ' +
  'ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';

export function globalIndex(meta: QuranMeta, ref: AyahRef): number {
  return meta.suras[ref.sura - 1].start + ref.aya - 1;
}

export function refAt(meta: QuranMeta, index: number): AyahRef {
  let lo = 0;
  let hi = meta.suras.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (meta.suras[mid].start <= index) lo = mid;
    else hi = mid - 1;
  }
  return { sura: lo + 1, aya: index - meta.suras[lo].start + 1 };
}

/** 1-based number of the division (page/juz/quarter) whose start is the last one at or before [ref]. */
function divisionOf(meta: QuranMeta, starts: AyahRef[], ref: AyahRef): number {
  const g = globalIndex(meta, ref);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (globalIndex(meta, starts[mid]) <= g) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export const pageOf = (meta: QuranMeta, ref: AyahRef) => divisionOf(meta, meta.pages, ref);
export const juzOf = (meta: QuranMeta, ref: AyahRef) => divisionOf(meta, meta.juz, ref);
/** Rub' al-hizb (1–240). Hizb = ceil(quarter / 4). */
export const quarterOf = (meta: QuranMeta, ref: AyahRef) => divisionOf(meta, meta.quarters, ref);

/** Global index range [from, to) of a page. */
export function pageRange(meta: QuranMeta, page: number): [number, number] {
  const from = globalIndex(meta, meta.pages[page - 1]);
  const to = page < meta.pages.length ? globalIndex(meta, meta.pages[page]) : TOTAL_AYAT;
  return [from, to];
}

/** Tanzil writes the basmala of suras 95 and 97 with a shadda on the first letter (بِّسْمِ). */
const BASMALA_SHADDA = BASMALA[0] + 'ّ' + BASMALA.slice(1);

/**
 * Splits the basmala off the first ayah of a sura for display. Nothing is altered: `basmalaText`
 * is the exact prefix found in the text (two spellings occur in Tanzil).
 */
export function splitBasmala(ref: AyahRef, text: string): { basmala: boolean; basmalaText: string; text: string } {
  if (ref.aya === 1 && ref.sura !== 1 && ref.sura !== 9) {
    for (const b of [BASMALA, BASMALA_SHADDA]) {
      if (text.startsWith(b + ' ')) return { basmala: true, basmalaText: b, text: text.slice(b.length + 1) };
    }
  }
  return { basmala: false, basmalaText: '', text };
}

/**
 * Normalises Arabic for search: strips tashkeel and Quranic marks, unifies alef/hamza/yaa/taa-marbuta
 * forms and removes tatweel, so "الرحمن" matches "ٱلرَّحْمَـٰنِ".
 */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]/g, '') // tashkeel, small marks, dagger alef
    .replace(/ـ/g, '') // tatweel
    .replace(/[آأإٱٲٳ]/g, 'ا') // alef forms → ا
    .replace(/ى/g, 'ي') // alef maqsura → ي
    .replace(/ة/g, 'ه') // taa marbuta → ه
    .replace(/[ؤ]/g, 'و') // ؤ → و
    .replace(/[ئ]/g, 'ي') // ئ → ي
    .replace(/۞|۩|[۝]/g, '') // rub el hizb, sajda, end-of-ayah signs
    .replace(/\s+/g, ' ')
    .trim();
}

/** Arabic-Indic digits for ayah numbers. */
export function arabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

/** Deterministic "verse of the day": same verse all day, changes daily, avoids very long verses. */
export function verseOfDayIndex(date: Date, texts: string[]): number {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  let i = (day * 2654435761) % TOTAL_AYAT;
  for (let tries = 0; tries < 50 && (texts[i]?.length ?? 0) > 260; tries++) i = (i + 97) % TOTAL_AYAT;
  return i;
}
