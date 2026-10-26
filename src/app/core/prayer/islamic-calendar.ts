export interface HijriDate {
  year: number;
  /** 1 = Muharram … 9 = Ramadan … 12 = Dhu al-Hijjah. */
  month: number;
  day: number;
}

const hijriFormat = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' });

/** Moves [date] by whole days, keeping the clock time (so it stays the same local day across DST). */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * The Umm al-Qura date of [date], moved by [offset] days (-2…2) for countries whose month starts a day earlier or
 * later after the crescent is sighted.
 */
export function hijriOf(date: Date, offset = 0): HijriDate {
  const parts = hijriFormat.formatToParts(addDays(date, offset));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: n('year'), month: n('month'), day: n('day') };
}

export type OccasionId =
  | 'newYear' | 'tasua' | 'ashura' | 'ramadan' | 'lastTen' | 'eidFitr' | 'shawwal'
  | 'dhulHijjah' | 'tarwiyah' | 'arafah' | 'eidAdha' | 'tashreeq' | 'whiteDays';

export interface Occasion {
  id: OccasionId;
  /** Recommended (sunnah) fast on this day. */
  fast: boolean;
}

/** The occasions of a Hijri day: fixed dates only (no disputed or moving ones such as Laylat al-Qadr). */
export function occasionsOn(h: HijriDate): Occasion[] {
  const out: Occasion[] = [];
  const add = (id: OccasionId, fast = false) => out.push({ id, fast });
  const { month: m, day: d } = h;
  if (m === 1 && d === 1) add('newYear');
  if (m === 1 && d === 9) add('tasua', true);
  if (m === 1 && d === 10) add('ashura', true);
  if (m === 9 && d === 1) add('ramadan');
  if (m === 9 && d === 21) add('lastTen');
  if (m === 10 && d === 1) add('eidFitr');
  if (m === 10 && d === 2) add('shawwal', true);
  if (m === 12 && d === 1) add('dhulHijjah', true);
  if (m === 12 && d === 8) add('tarwiyah', true);
  if (m === 12 && d === 9) add('arafah', true);
  if (m === 12 && d === 10) add('eidAdha');
  if (m === 12 && d >= 11 && d <= 13) add('tashreeq');
  // The white days (13–15): not in Ramadan (already fasting) nor on 13 Dhu al-Hijjah (a day of Tashreeq).
  if (d >= 13 && d <= 15 && m !== 9 && !(m === 12 && d === 13)) add('whiteDays', true);
  return out;
}

export interface DatedOccasion extends Occasion {
  date: Date;
  hijri: HijriDate;
}

/** Occasions from [from] (its day included) over the next [days] days. Consecutive days of one occasion appear once. */
export function upcomingOccasions(from: Date, offset: number, days = 365): DatedOccasion[] {
  const out: DatedOccasion[] = [];
  const start = new Date(from);
  start.setHours(12, 0, 0, 0);
  let previous = new Set<OccasionId>();
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const hijri = hijriOf(date, offset);
    const today = occasionsOn(hijri);
    for (const o of today) if (!previous.has(o.id)) out.push({ ...o, date, hijri });
    previous = new Set(today.map((o) => o.id));
  }
  return out;
}

/** Whole days from the start of [from]'s day to the start of [to]'s day. */
export function daysBetween(from: Date, to: Date): number {
  const a = new Date(from);
  const b = new Date(to);
  a.setHours(12, 0, 0, 0);
  b.setHours(12, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** [date] (moved by [offset] days) as a Hijri date in [lang], with 0-9 digits. */
export function formatHijri(date: Date, offset: number, lang: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
  const locale = (lang === 'ar' ? 'ar-SA' : lang) + '-u-ca-islamic-umalqura-nu-latn';
  return new Intl.DateTimeFormat(locale, options).format(addDays(date, offset));
}
