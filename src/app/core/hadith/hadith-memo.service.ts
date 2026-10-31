import { Injectable, computed, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { addDays, dateKey } from '../util/date';

/** How well one hadith is memorised: [level] steps through REVIEW_DAYS; reviewed again on [due] (YYYY-MM-DD). */
export interface MemoEntry {
  level: number;
  due: string;
}
export type MemoStatus = 'new' | 'learning' | 'memorized';

/** Days until the next review after each successful one: soon at first, then further apart. */
export const REVIEW_DAYS = [1, 3, 7, 14, 30, 60];
/** From this level on a hadith counts as memorised (it was recalled four times in a row, over about 25 days). */
const MEMORIZED_LEVEL = 4;
const KEY = 'hadithMemo';

export interface NawawiHadith {
  number: number;
  arabic: string;
  /** In the reader's language when the collection has it (en, tr, bn, fr), otherwise English. */
  translation: string;
  translationLang: string;
}

/** The next state after a review: remembered moves a step up and further out, forgotten starts over tomorrow. */
export function nextEntry(entry: MemoEntry | undefined, remembered: boolean, today = new Date()): MemoEntry {
  const level = remembered ? Math.min((entry ? entry.level + 1 : 0), REVIEW_DAYS.length - 1) : 0;
  return { level, due: dateKey(addDays(today, remembered ? REVIEW_DAYS[level] : 1)) };
}

export function memoStatus(entry: MemoEntry | undefined): MemoStatus {
  return !entry ? 'new' : entry.level >= MEMORIZED_LEVEL ? 'memorized' : 'learning';
}

/**
 * Memorising the Forty Hadith of an-Nawawi with spaced review. Kept on the phone (and in backups) only.
 */
@Injectable({ providedIn: 'root' })
export class HadithMemoService {
  readonly entries = signal<Record<number, MemoEntry>>({});
  readonly hadith = signal<NawawiHadith[]>([]);
  private loaded?: Promise<void>;

  readonly memorized = computed(() => Object.values(this.entries()).filter((e) => memoStatus(e) === 'memorized').length);
  /** Hadith being learned whose review day has come, in collection order. */
  readonly due = computed(() => {
    const today = dateKey();
    return Object.entries(this.entries())
      .filter(([, e]) => e.due <= today)
      .map(([n]) => Number(n))
      .sort((a, b) => a - b);
  });

  load(lang: string): Promise<void> {
    return (this.loaded ??= (async () => {
      const { value } = await Preferences.get({ key: KEY });
      try {
        if (value) this.entries.set(JSON.parse(value));
      } catch {
        /* start fresh */
      }
      const res = await fetch('assets/hadith/nawawi.json');
      const json = (await res.json()) as { editions: Record<string, { hadiths: { hadithnumber: number; text: string }[] }> };
      const tl = json.editions[lang] && lang !== 'ar' ? lang : 'en';
      const translations = new Map(json.editions[tl].hadiths.map((h) => [h.hadithnumber, h.text]));
      this.hadith.set(json.editions['ar'].hadiths.map((h) => ({
        number: h.hadithnumber, arabic: h.text.trim(), translation: translations.get(h.hadithnumber)?.trim() ?? '', translationLang: tl,
      })));
    })().catch((e) => {
      this.loaded = undefined;
      throw e;
    }));
  }

  status(n: number): MemoStatus {
    return memoStatus(this.entries()[n]);
  }

  /** Starts learning [n]: first review tomorrow. */
  start(n: number): Promise<void> {
    if (this.entries()[n]) return Promise.resolve();
    return this.save({ ...this.entries(), [n]: { level: 0, due: dateKey(addDays(new Date(), 1)) } });
  }

  review(n: number, remembered: boolean): Promise<void> {
    return this.save({ ...this.entries(), [n]: nextEntry(this.entries()[n], remembered) });
  }

  reset(n: number): Promise<void> {
    const next = { ...this.entries() };
    delete next[n];
    return this.save(next);
  }

  private async save(entries: Record<number, MemoEntry>): Promise<void> {
    this.entries.set(entries);
    await Preferences.set({ key: KEY, value: JSON.stringify(entries) });
  }
}
