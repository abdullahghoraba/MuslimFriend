/** App languages: each one's own name (shown the same in every language) and writing direction. */
export const LANGUAGES = [
  { code: 'ar', name: 'العربية', rtl: true },
  { code: 'en', name: 'English', rtl: false },
  { code: 'ur', name: 'اردو', rtl: true },
  { code: 'fa', name: 'فارسی', rtl: true },
  { code: 'tr', name: 'Türkçe', rtl: false },
  { code: 'id', name: 'Bahasa Indonesia', rtl: false },
  { code: 'ms', name: 'Bahasa Melayu', rtl: false },
  { code: 'bn', name: 'বাংলা', rtl: false },
  { code: 'hi', name: 'हिन्दी', rtl: false },
  { code: 'fr', name: 'Français', rtl: false },
  { code: 'es', name: 'Español', rtl: false },
  { code: 'de', name: 'Deutsch', rtl: false },
  { code: 'ru', name: 'Русский', rtl: false },
  { code: 'pt', name: 'Português', rtl: false },
  { code: 'zh', name: '中文', rtl: false },
  { code: 'sw', name: 'Kiswahili', rtl: false },
  { code: 'ha', name: 'Hausa', rtl: false },
  { code: 'uz', name: 'Oʻzbekcha', rtl: false },
] as const;
export type Language = (typeof LANGUAGES)[number]['code'];
export const isLanguage = (x: unknown): x is Language => LANGUAGES.some((l) => l.code === x);
export const isRtl = (lang: string): boolean => LANGUAGES.some((l) => l.code === lang && l.rtl);
/** Locale for Intl formatting in [lang], always with 0-9 digits. */
export const intlLocale = (lang: string): string => {
  const base = lang.split('-')[0];
  return (base === 'ar' ? 'ar-EG' : isLanguage(base) ? base : 'en') + '-u-nu-latn';
};
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Category {
  id: string;
  icon: string;
  nameAr: string;
  nameEn: string;
  isUser?: boolean;
  showOnHome?: boolean;
}

/** A dhikr as shipped in the bundled dataset (public/assets/data/athkar.json). */
export interface DhikrContent {
  id: string;
  categoryId: string;
  /** Arabic text with full tashkeel. Quran items are verbatim Tanzil Uthmani text. */
  textAr: string;
  transliteration: string;
  meaningEn: string;
  repeatCount: number;
  virtueAr: string;
  virtueEn: string;
  /** e.g. "Sahih Muslim 2723" */
  sourceRef: string;
  grade: string;
  /** False until a qualified reviewer has verified the item against its source. */
  reviewed: boolean;
  isQuran: boolean;
  quranRef?: string;
}

export interface ContentDataset {
  contentVersion: number;
  quranAttribution: string;
  categories: Category[];
  items: DhikrContent[];
  /** Arabic wording of the English source references and grades, keyed by the English text. */
  refsAr?: { sources: Record<string, string>; grades: Record<string, string> };
}

/** A dhikr as stored in SQLite: built-in content plus user state, or a custom dhikr. */
export interface Dhikr extends DhikrContent {
  originalRepeatCount: number;
  repeatOverridden: boolean;
  hidden: boolean;
  isCustom: boolean;
  includeInOverlay: boolean;
  sortOrder: number;
}

export const CUSTOM_CATEGORY_ID = 'custom';

export interface CustomDhikrInput {
  textAr: string;
  meaningEn: string;
  repeatCount: number;
  includeInOverlay: boolean;
}

export interface TasbihCounter {
  id: number;
  name: string;
  /** 0 means open-ended (no target). */
  target: number;
  count: number;
  sortOrder: number;
}

export interface ReaderPosition {
  categoryId: string;
  index: number;
  updatedAt: number;
}

export interface AppSettings {
  language: Language;
  theme: ThemeMode;
  /** Multiplier for the dhikr text size, 0.8 – 2.0. */
  fontScale: number;
  haptics: boolean;
  onboardingDone: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ar',
  theme: 'system',
  fontScale: 1,
  haptics: true,
  onboardingDone: false,
};
