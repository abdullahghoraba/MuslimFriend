import { DayTimes } from './prayer-times';

/** What the Home "now" card suggests. */
export type NowSuggestion = 'kahf' | 'morning' | 'evening';

const at = (now: Date, hour: number): Date => new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour);

/**
 * Suggestions for the current moment, most relevant first:
 * - Surat al-Kahf from Maghrib on Thursday until Maghrib on Friday (the Islamic Friday starts at Thursday's sunset);
 * - morning athkar from Fajr until Dhuhr;
 * - evening athkar from Asr until midnight.
 * Without a location (no prayer times) fixed clock times stand in: Fajr 04:00, Dhuhr 12:00, Asr 15:00, Maghrib 18:00.
 */
export function nowSuggestions(now: Date, today: DayTimes | null): NowSuggestion[] {
  const t = today?.times;
  const fajr = t?.fajr ?? at(now, 4);
  const dhuhr = t?.dhuhr ?? at(now, 12);
  const asr = t?.asr ?? at(now, 15);
  const maghrib = t?.maghrib ?? at(now, 18);
  const day = now.getDay(); // 4 = Thursday, 5 = Friday
  const out: NowSuggestion[] = [];
  if ((day === 4 && now >= maghrib) || (day === 5 && now < maghrib)) out.push('kahf');
  if (now >= fajr && now < dhuhr) out.push('morning');
  else if (now >= asr) out.push('evening');
  return out;
}
