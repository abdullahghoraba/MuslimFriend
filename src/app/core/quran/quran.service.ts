import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { firstValueFrom } from 'rxjs';
import {
  AyahRef,
  QuranMeta,
  SuraMeta,
  TafsirId,
  globalIndex,
  juzOf,
  normalizeArabic,
  pageOf,
  pageRange,
  quarterOf,
  refAt,
  verseOfDayIndex,
} from './quran-utils';

export interface Ayah extends AyahRef {
  /** Global index 0..6235. */
  index: number;
  text: string;
}

export interface SearchHit extends Ayah {
  page: number;
}

export interface LastRead {
  page: number;
  sura: number;
  aya: number;
  at: number;
}

const LAST_READ_KEY = 'quranLastRead';
const READING_MARK_KEY = 'quranReadingMark';
const AUTO_RESUME_KEY = 'quranAutoResume';

/**
 * Offline Quran: Tanzil Uthmani text, Madani 604-page layout, tafsir/translation on demand.
 * Assets are produced by scripts/build-quran.mjs.
 */
@Injectable({ providedIn: 'root' })
export class QuranService {
  private readonly http = inject(HttpClient);
  private metaData?: QuranMeta;
  private texts: string[] = [];
  private normalized?: string[];
  private loading?: Promise<void>;
  private readonly tafsirCache = new Map<string, string[]>();

  readonly ready = signal(false);
  readonly lastRead = signal<LastRead | null>(null);

  /** Loads metadata and text once (about 1.4 MB). Safe to call repeatedly. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      const [meta, text, last] = await Promise.all([
        firstValueFrom(this.http.get<QuranMeta>('assets/quran/meta.json')),
        firstValueFrom(this.http.get<string[]>('assets/quran/text.json')),
        Preferences.get({ key: LAST_READ_KEY }),
      ]);
      this.metaData = meta;
      this.texts = text;
      if (last.value) {
        try {
          this.lastRead.set(JSON.parse(last.value));
        } catch {
          /* ignore */
        }
      }
      this.ready.set(true);
    })();
    return this.loading;
  }

  get meta(): QuranMeta {
    if (!this.metaData) throw new Error('QuranService.load() first');
    return this.metaData;
  }

  get suras(): SuraMeta[] {
    return this.meta.suras;
  }

  sura(n: number): SuraMeta {
    return this.meta.suras[n - 1];
  }

  ayah(ref: AyahRef): Ayah {
    const index = globalIndex(this.meta, ref);
    return { ...ref, index, text: this.texts[index] };
  }

  ayahAt(index: number): Ayah {
    return { ...refAt(this.meta, index), index, text: this.texts[index] };
  }

  pageAyahs(page: number): Ayah[] {
    const [from, to] = pageRange(this.meta, page);
    const out: Ayah[] = [];
    for (let i = from; i < to; i++) out.push(this.ayahAt(i));
    return out;
  }

  pageOf(ref: AyahRef): number {
    return pageOf(this.meta, ref);
  }

  juzOf(ref: AyahRef): number {
    return juzOf(this.meta, ref);
  }

  /** Rub' number 1–240; hizb = Math.ceil(quarter / 4). */
  quarterOf(ref: AyahRef): number {
    return quarterOf(this.meta, ref);
  }

  /** First page of sura / juz / quarter. */
  suraPage(sura: number): number {
    return this.pageOf({ sura, aya: 1 });
  }

  juzPage(juz: number): number {
    return this.pageOf(this.meta.juz[juz - 1]);
  }

  quarterPage(quarter: number): number {
    return this.pageOf(this.meta.quarters[quarter - 1]);
  }

  isSajda(ref: AyahRef): boolean {
    return this.meta.sajdas.some((s) => s.sura === ref.sura && s.aya === ref.aya);
  }

  /** Tafsir or translation for one ayah (loaded per sura on demand and cached). */
  async tafsir(id: TafsirId, ref: AyahRef): Promise<string> {
    const key = `${id}/${ref.sura}`;
    let list = this.tafsirCache.get(key);
    if (!list) {
      const file = String(ref.sura).padStart(3, '0');
      list = await firstValueFrom(this.http.get<string[]>(`assets/quran/tafsir/${id}/${file}.json`));
      this.tafsirCache.set(key, list);
    }
    return list[ref.aya - 1] ?? '';
  }

  /** Arabic search, ignoring tashkeel and letter-form differences. Results in mushaf order. */
  search(query: string, limit = 200): SearchHit[] {
    const q = normalizeArabic(query);
    if (q.length < 2) return [];
    this.normalized ??= this.texts.map(normalizeArabic);
    const hits: SearchHit[] = [];
    for (let i = 0; i < this.normalized.length && hits.length < limit; i++) {
      if (this.normalized[i].includes(q)) {
        const a = this.ayahAt(i);
        hits.push({ ...a, page: this.pageOf(a) });
      }
    }
    return hits;
  }

  /** Number of matches without the limit (for "n results"). */
  countMatches(query: string): number {
    const q = normalizeArabic(query);
    if (q.length < 2) return 0;
    this.normalized ??= this.texts.map(normalizeArabic);
    return this.normalized.filter((t) => t.includes(q)).length;
  }

  verseOfDay(date = new Date()): Ayah {
    return this.ayahAt(verseOfDayIndex(date, this.texts));
  }

  async setLastRead(page: number, ref: AyahRef): Promise<void> {
    const value: LastRead = { page, sura: ref.sura, aya: ref.aya, at: Date.now() };
    this.lastRead.set(value);
    await Preferences.set({ key: LAST_READ_KEY, value: JSON.stringify(value) });
  }

  // ---- reading mark & resume ------------------------------------------------------------

  /** The ayah the user marked to come back to (set by hand, unlike lastRead which follows the open page). */
  readonly readingMark = signal<LastRead | null>(null);
  /** Open the Quran tab at the last page read, once per app start. */
  readonly autoResume = signal(true);
  private prefsLoaded?: Promise<void>;

  loadReadingPrefs(): Promise<void> {
    return (this.prefsLoaded ??= (async () => {
      const [mark, resume] = await Promise.all([
        Preferences.get({ key: READING_MARK_KEY }),
        Preferences.get({ key: AUTO_RESUME_KEY }),
      ]);
      try {
        if (mark.value) this.readingMark.set(JSON.parse(mark.value));
      } catch {
        /* ignore */
      }
      if (resume.value !== null) this.autoResume.set(resume.value !== 'false');
    })());
  }

  async setReadingMark(page: number, ref: AyahRef | null): Promise<void> {
    if (!ref) {
      this.readingMark.set(null);
      await Preferences.remove({ key: READING_MARK_KEY });
      return;
    }
    const value: LastRead = { page, sura: ref.sura, aya: ref.aya, at: Date.now() };
    this.readingMark.set(value);
    await Preferences.set({ key: READING_MARK_KEY, value: JSON.stringify(value) });
  }

  async setAutoResume(on: boolean): Promise<void> {
    this.autoResume.set(on);
    await Preferences.set({ key: AUTO_RESUME_KEY, value: String(on) });
  }
}
