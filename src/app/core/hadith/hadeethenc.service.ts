import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { localDay } from './daily-online';
import { HadithStorage } from './hadith-storage.service';
import { Hadith } from './hadith.models';

/**
 * HadeethEnc.com, the Encyclopedia of Translated Prophetic Hadiths: hadith by topic in 70+ languages (all the app's
 * languages), each with its grade, source, explanation and lessons, in Arabic and in the reader's language.
 * Online (the API allows the app's requests); every hadith opened is kept on the device.
 */
const API = 'https://hadeethenc.com/api/v1';
const DAILY_KEY = 'hadith-daily-enc';

export interface EncCategory {
  id: string;
  title: string;
  count: number;
  parent: string | null;
}

export interface EncHadith {
  id: string;
  lang: string;
  title: string;
  /** The hadith in the reader's language (empty in Arabic). */
  text: string;
  arabic: string;
  grade: string;
  gradeAr: string;
  attribution: string;
  attributionAr: string;
  explanation: string;
  hints: string[];
  wordMeanings: { word: string; meaning: string }[];
}

interface RawCategory { id: string; title: string; hadeeths_count: string; parent_id: string | null }
interface RawHadith {
  id: string; title: string; hadeeth: string; attribution: string; grade: string; explanation: string; hints?: string[];
  hadeeth_ar?: string; attribution_ar?: string; grade_ar?: string; explanation_ar?: string; hints_ar?: string[];
  words_meanings?: { word: string; meaning: string }[]; words_meanings_ar?: { word: string; meaning: string }[];
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\r/g, '').trim() : '');

/** An encyclopedia hadith as a hadith card (collection 'enc', its id as the number). */
export function encHadith(h: EncHadith): Hadith {
  return {
    collection: 'enc', number: h.id, book: 0, arabic: h.arabic, translation: h.lang === 'ar' ? '' : h.text,
    translationLang: h.lang, grades: h.gradeAr ? [{ name: '', grade: h.gradeAr }] : [], bookName: h.title,
    // Source and grade, kept with a saved copy (its grade badge is read from them).
    bookHadith: 0, arabicNumber: h.id, authenticitySource: [h.attributionAr, h.gradeAr].filter(Boolean).join(' · '),
  };
}

@Injectable({ providedIn: 'root' })
export class HadeethEncService {
  private readonly storage = inject(HadithStorage);
  private readonly categories = new Map<string, Promise<EncCategory[]>>();

  /** Every topic in [lang] (about 500, as a tree through [parent]), with the number of hadith translated into it. */
  allCategories(lang: string): Promise<EncCategory[]> {
    let p = this.categories.get(lang);
    if (!p) {
      p = this.get<RawCategory[]>(`/categories/list/?language=${lang}`)
        .then((rows) => {
          const list = rows.map((r) => ({ id: String(r.id), title: clean(r.title), count: Number(r.hadeeths_count) || 0, parent: r.parent_id ? String(r.parent_id) : null }));
          void this.storage.write(`enc-categories-${lang}`, list).catch(() => {});
          return list;
        })
        .catch(async (e: unknown) => {
          this.categories.delete(lang);
          const saved = await this.storage.read<EncCategory[]>(`enc-categories-${lang}`).catch(() => null);
          if (saved?.length) return saved;
          throw e;
        });
      this.categories.set(lang, p);
    }
    return p;
  }

  /** One page of the hadith of a topic: their ids and titles in [lang]. */
  async list(lang: string, category: string, page: number, perPage = 20): Promise<{ items: { id: string; title: string }[]; lastPage: number; total: number }> {
    const r = await this.get<{ data: { id: string; title: string }[]; meta: { last_page: number | string; total_items: number | string } }>(
      `/hadeeths/list/?language=${lang}&category_id=${encodeURIComponent(category)}&page=${page}&per_page=${perPage}`,
    );
    return {
      items: (r.data ?? []).map((x) => ({ id: String(x.id), title: clean(x.title) })),
      lastPage: Number(r.meta?.last_page) || 1,
      total: Number(r.meta?.total_items) || 0,
    };
  }

  /** One hadith in [lang] with its Arabic, grade, source, explanation and lessons (kept for reading offline). */
  async one(lang: string, id: string): Promise<EncHadith> {
    const key = `enc-${lang}-${id}`;
    try {
      const r = await this.get<RawHadith>(`/hadeeths/one/?language=${lang}&id=${encodeURIComponent(id)}`);
      const ar = lang === 'ar';
      const h: EncHadith = {
        id: String(r.id), lang, title: clean(r.title),
        text: clean(r.hadeeth), arabic: clean(ar ? r.hadeeth : r.hadeeth_ar),
        grade: clean(r.grade), gradeAr: clean(ar ? r.grade : r.grade_ar),
        attribution: clean(r.attribution), attributionAr: clean(ar ? r.attribution : r.attribution_ar),
        explanation: clean(r.explanation),
        hints: (r.hints ?? []).map(clean).filter(Boolean),
        wordMeanings: (r.words_meanings ?? []).map((w) => ({ word: clean(w.word), meaning: clean(w.meaning) })).filter((w) => w.word),
      };
      if (!h.arabic) throw Error('incomplete');
      void this.storage.write(key, h).catch(() => {});
      return h;
    } catch (e) {
      const saved = await this.storage.read<EncHadith>(key).catch(() => null);
      if (saved) return saved;
      throw e;
    }
  }

  /**
   * Hadith of the day in the reader's language: a different one each day, moving through every topic. Two small
   * requests a day, kept until the next day. Throws offline.
   */
  async daily(date: Date, lang: string): Promise<EncHadith> {
    const day = localDay(date);
    const { value } = await Preferences.get({ key: DAILY_KEY });
    try {
      const cached = value ? (JSON.parse(value) as { day: number; lang: string; hadith: EncHadith }) : null;
      if (cached?.day === day && cached.lang === lang && cached.hadith?.arabic) return cached.hadith;
    } catch {
      /* fetch again */
    }
    const roots = (await this.allCategories(lang)).filter((c) => !c.parent && c.count > 0);
    const total = roots.reduce((n, c) => n + c.count, 0);
    if (!total) throw Error('no-hadith');
    // A step coprime with the total visits every hadith once before any repeats.
    const step = [7919, 7907, 7901, 7883, 7877].find((p) => total % p !== 0) ?? 1;
    let at = ((day * step) % total + total) % total;
    let root = roots[0];
    for (const c of roots) {
      if (at < c.count) { root = c; break; }
      at -= c.count;
    }
    // Ten at a time from the day's place in the topic; the first short enough to read on Home (not every day the
    // longest narrations).
    const perPage = 10;
    let page = await this.list(lang, root.id, Math.floor(at / perPage) + 1, perPage);
    // The topic's count can differ slightly from its list; then take them from its first page.
    if (!page.items.length) page = await this.list(lang, root.id, 1, perPage);
    const start = at % perPage;
    const order = [...page.items.slice(start), ...page.items.slice(0, start)];
    let hadith: EncHadith | null = null;
    for (const item of order.slice(0, 4)) {
      const h = await this.one(lang, item.id);
      hadith ??= h;
      if (h.arabic.length <= 700) {
        hadith = h;
        break;
      }
    }
    if (!hadith) throw Error('no-hadith');
    await Preferences.set({ key: DAILY_KEY, value: JSON.stringify({ day, lang, hadith }) }).catch(() => {});
    return hadith;
  }

  private async get<T>(path: string): Promise<T> {
    const r = await fetch(API + path, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  }
}
