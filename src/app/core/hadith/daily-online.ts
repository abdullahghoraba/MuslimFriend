// Hadith of the day from the two Sahihs (online), a different one each day for decades.
import { normalizeHadith } from './hadith.models';

/** Hadith numbers in fawazahmed0/hadith-api run 1..7563 in both Sahihs (a few are empty or missing). */
export const DAILY_POOL = { bukhari: 7563, muslim: 7563 } as const;
export type DailyCollection = keyof typeof DAILY_POOL;

/** Days since 1970-01-01 in the phone's own calendar (the day changes at local midnight). */
export function localDay(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/**
 * The day's collection and its candidate numbers, best first. Bukhari and Muslim alternate; within each the step
 * (2 × 2971) is coprime with 7563, so no number comes back before 7563 days of that collection (about 41 years).
 */
export function dailyCandidates(day: number, tries = 12): { collection: DailyCollection; numbers: number[] } {
  const collection: DailyCollection = day % 2 === 0 ? 'bukhari' : 'muslim';
  const n = DAILY_POOL[collection];
  const half = Math.floor(day / 2);
  const numbers = Array.from({ length: tries }, (_, k) => ((((half * 2971 + k * 7919) % n) + n) % n) + 1);
  return { collection, numbers };
}

/**
 * A good hadith of the day: the Prophet's words are in it (not only a chain pointing to the previous hadith,
 * «بهذا الإسناد مثله»), and it is short enough to read on Home.
 */
export function isGoodDaily(arabic: string): boolean {
  const t = normalizeHadith(arabic);
  if (t.length < 80 || t.length > 900) return false;
  if (/بهذا الاسناد|بمعني حديث|نحو حديث|مثل حديث|بمثله|بنحوه/.test(t)) return false;
  return /رسول الله صلي الله|النبي صلي الله|قال رسول الله|قال النبي/.test(t);
}
