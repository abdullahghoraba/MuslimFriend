export type Language = 'ar' | 'en';
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
}

/** A dhikr as stored in SQLite: built-in content plus user state, or a custom dhikr. */
export interface Dhikr extends DhikrContent {
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
