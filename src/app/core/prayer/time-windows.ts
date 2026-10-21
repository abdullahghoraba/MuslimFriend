import { DayTimes, DEFAULT_HOME_CARDS, HomeCardSettings, PrayerName } from './prayer-times';

/** What the Home "now" card suggests. */
export type NowSuggestion = 'kahf' | 'morning' | 'evening';

const at = (now: Date, hour: number, minute = 0): Date =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);

/** Stand-in times when no location is set (no prayer times). */
const FALLBACK: Record<PrayerName, [number, number]> = {
  fajr: [4, 0], sunrise: [6, 0], dhuhr: [12, 0], asr: [15, 0], maghrib: [18, 0], isha: [19, 30],
};

/**
 * Suggestions for the current moment, most relevant first (each can be switched off in [cards]):
 * - Surat al-Kahf from Maghrib on Thursday until Maghrib on Friday (the Islamic Friday starts at Thursday's sunset);
 * - morning athkar from Fajr until the chosen end (default Dhuhr);
 * - evening athkar from the chosen start (default Asr) until the chosen end (default midnight).
 */
export function nowSuggestions(now: Date, today: DayTimes | null, cards: HomeCardSettings = DEFAULT_HOME_CARDS): NowSuggestion[] {
  const time = (p: PrayerName): Date => today?.times[p] ?? at(now, ...FALLBACK[p]);
  const midnight = at(now, 24);
  const day = now.getDay(); // 4 = Thursday, 5 = Friday
  const maghrib = time('maghrib');
  const out: NowSuggestion[] = [];
  if (cards.kahf && ((day === 4 && now >= maghrib) || (day === 5 && now < maghrib))) out.push('kahf');

  const morningEnd = time(cards.morningUntil);
  const eveningStart = time(cards.eveningFrom);
  let eveningEnd = cards.eveningUntil === 'midnight' ? midnight : time(cards.eveningUntil);
  if (eveningEnd <= eveningStart) eveningEnd = midnight; // e.g. "from Maghrib until Maghrib"
  if (cards.morning && now >= time('fajr') && now < morningEnd) out.push('morning');
  else if (cards.evening && now >= eveningStart && now < eveningEnd) out.push('evening');
  return out;
}
