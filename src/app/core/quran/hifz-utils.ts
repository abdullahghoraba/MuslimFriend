import { AyahRef } from './quran-utils';
import { addDays, dateKey } from '../util/date';
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60] as const;
export type HifzStatus = 'learning' | 'memorized';
export interface HifzAyah extends AyahRef {
  planId: number;
  status: HifzStatus;
  memorizedOn: string | null;
  lastReview: string | null;
  nextReview: string | null;
  reviews: number;
  step: number;
}
export const ayahKey = (r: AyahRef): string => r.sura + ':' + r.aya;
export function enumerateRange(
  counts: readonly number[],
  from: AyahRef = { sura: 1, aya: 1 },
  to: AyahRef = { sura: counts.length, aya: counts[counts.length - 1] },
): AyahRef[] {
  for (const r of [from, to])
    if (
      !Number.isSafeInteger(r.sura) ||
      !Number.isSafeInteger(r.aya) ||
      r.sura < 1 ||
      r.sura > counts.length ||
      r.aya < 1 ||
      r.aya > counts[r.sura - 1]
    )
      throw new Error('Invalid ayah');
  if (from.sura > to.sura || (from.sura === to.sura && from.aya > to.aya))
    throw new Error('Reversed range');
  const out: AyahRef[] = [];
  for (let sura = from.sura; sura <= to.sura; sura++)
    for (
      let aya = sura === from.sura ? from.aya : 1;
      aya <= (sura === to.sura ? to.aya : counts[sura - 1]);
      aya++
    )
      out.push({ sura, aya });
  return out;
}
export function newPortion(range: AyahRef[], tracked: AyahRef[], dailyNew: number): AyahRef[] {
  const seen = new Set(tracked.map(ayahKey));
  return range.filter((r) => !seen.has(ayahKey(r))).slice(0, dailyNew);
}
export function dueAyahs(rows: HifzAyah[], today = dateKey()): AyahRef[] {
  return rows
    .filter((r) => r.status === 'memorized' && r.nextReview !== null && r.nextReview <= today)
    .sort((a, b) => a.sura - b.sura || a.aya - b.aya)
    .map(({ sura, aya }) => ({ sura, aya }));
}
export function reviewSchedule(
  step: number,
  result: 'good' | 'hard',
  today = new Date(),
): { step: number; nextReview: string } {
  const next = result === 'hard' ? 0 : Math.min(REVIEW_INTERVALS.length - 1, step + 1);
  return { step: next, nextReview: dateKey(addDays(today, REVIEW_INTERVALS[next])) };
}
export function activityStreak(dates: string[], today = new Date()): number {
  const days = new Set(dates);
  let day = today;
  if (!days.has(dateKey(day))) day = addDays(day, -1);
  let count = 0;
  while (days.has(dateKey(day))) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}
