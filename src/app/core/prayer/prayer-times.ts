import { CalculationMethod, CalculationParameters, Coordinates, HighLatitudeRule, Madhab, PrayerTimes } from 'adhan';
import { NativeReminder } from '../../native/athkar-overlay';

type AdhanMethodId = keyof typeof CalculationMethod;

/**
 * Official methods that the adhan library doesn't ship, by their published Fajr/Isha angles
 * (Isha as minutes after Maghrib when the authority uses a fixed interval) and Maghrib offsets.
 */
const EXTRA_METHODS = {
  Gulf: () => new CalculationParameters(null, 19.5, 0, 90),
  Jordan: () => withAdjustments(new CalculationParameters(null, 18, 18), { maghrib: 5 }),
  Algeria: () => withAdjustments(new CalculationParameters(null, 18, 17), { maghrib: 3 }),
  Morocco: () => withAdjustments(new CalculationParameters(null, 19, 17), { dhuhr: 5, maghrib: 5 }),
  Tunisia: () => new CalculationParameters(null, 18, 18),
  Malaysia: () => withAdjustments(new CalculationParameters(null, 20, 18), { dhuhr: 1 }),
  Indonesia: () => withAdjustments(new CalculationParameters(null, 20, 18), { fajr: 2, dhuhr: 2, asr: 2, maghrib: 2, isha: 2 }),
  Russia: () => new CalculationParameters(null, 16, 15),
  France: () => new CalculationParameters(null, 12, 12),
  France15: () => new CalculationParameters(null, 15, 15),
  France18: () => new CalculationParameters(null, 18, 18),
  // Shia Ithna-Ashari (Leva Institute, Qum): Maghrib when the sun is 4° below the horizon.
  Jafari: () => new CalculationParameters(null, 16, 14, 0, 4),
} satisfies Record<string, () => CalculationParameters>;

function withAdjustments(p: CalculationParameters, adj: Partial<CalculationParameters['methodAdjustments']>): CalculationParameters {
  p.methodAdjustments = { ...p.methodAdjustments, ...adj };
  return p;
}

export type MethodId = AdhanMethodId | keyof typeof EXTRA_METHODS;

export const METHOD_IDS: MethodId[] = [
  'Egyptian', 'UmmAlQura', 'MuslimWorldLeague', 'Karachi', 'Dubai', 'Kuwait', 'Qatar', 'Gulf', 'Jordan',
  'Algeria', 'Morocco', 'Tunisia', 'Turkey', 'Tehran', 'Jafari', 'Singapore', 'Malaysia', 'Indonesia',
  'Russia', 'France', 'France15', 'France18', 'NorthAmerica', 'MoonsightingCommittee',
];

export type PrayerName = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export const PRAYER_NAMES: PrayerName[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

export interface PrayerLocation {
  latitude: number;
  longitude: number;
  /** Display name (city) or empty for auto-detected coordinates. */
  name: string;
  source: 'manual' | 'auto';
}

export interface PrayerSettings {
  location: PrayerLocation | null;
  method: MethodId;
  madhab: 'shafi' | 'hanafi';
  /** Manual minute adjustments per prayer. */
  adjustments: Record<PrayerName, number>;
}

export const DEFAULT_PRAYER_SETTINGS: PrayerSettings = {
  location: null,
  method: 'Egyptian',
  madhab: 'shafi',
  adjustments: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
};

export interface DayTimes {
  date: Date;
  times: Record<PrayerName, Date>;
}

export function calculationParams(s: PrayerSettings): CalculationParameters {
  const params = s.method in EXTRA_METHODS
    ? EXTRA_METHODS[s.method as keyof typeof EXTRA_METHODS]()
    : CalculationMethod[(s.method in CalculationMethod ? s.method : 'Egyptian') as AdhanMethodId]();
  params.madhab = s.madhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  // Keeps Fajr/Isha sane at high latitudes in summer.
  params.highLatitudeRule = HighLatitudeRule.recommended(new Coordinates(s.location?.latitude ?? 0, s.location?.longitude ?? 0));
  params.adjustments = { ...params.adjustments, ...s.adjustments };
  return params;
}

/** Prayer times for the local calendar day containing [date]. */
export function prayerTimesFor(s: PrayerSettings, date: Date): DayTimes | null {
  if (!s.location) return null;
  const coords = new Coordinates(s.location.latitude, s.location.longitude);
  const pt = new PrayerTimes(coords, date, calculationParams(s));
  return {
    date,
    times: { fajr: pt.fajr, sunrise: pt.sunrise, dhuhr: pt.dhuhr, asr: pt.asr, maghrib: pt.maghrib, isha: pt.isha },
  };
}

/** The next prayer time after [now] (sunrise included, as it ends Fajr), looking into tomorrow if needed. */
export function nextPrayer(s: PrayerSettings, now = new Date()): { name: PrayerName; at: Date } | null {
  for (let d = 0; d < 2; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    const t = prayerTimesFor(s, day);
    if (!t) return null;
    for (const name of PRAYER_NAMES) {
      if (t.times[name].getTime() > now.getTime()) return { name, at: t.times[name] };
    }
  }
  return null;
}

// ---- Reminder planning -------------------------------------------------------------------

export interface ReminderSettings {
  /** Either [minutesAfterFajr] or a fixed clock [time] (mode 'time', works without a location). */
  morning: { enabled: boolean; mode: 'afterFajr' | 'time'; minutesAfterFajr: number; time: string };
  /** Relative to Asr/Maghrib by [minutes], or the fixed clock [time] when anchor is 'time'. */
  evening: { enabled: boolean; anchor: 'beforeMaghrib' | 'afterAsr' | 'time'; minutes: number; time: string };
  sleep: { enabled: boolean; time: string };
  fridayKahf: { enabled: boolean; time: string };
  fridaySalawat: { enabled: boolean; time: string };
  /** Daily Quran reading (wird / khatmah) reminder. */
  wird: { enabled: boolean; time: string };
  hifz: { enabled: boolean; time: string };
  /** When the Home page shows its "now" shortcut cards (no notification involved). */
  homeCards: HomeCardSettings;
}

export interface HomeCardSettings {
  morning: boolean;
  morningUntil: 'sunrise' | 'dhuhr' | 'asr';
  evening: boolean;
  eveningFrom: 'asr' | 'maghrib';
  eveningUntil: 'maghrib' | 'isha' | 'midnight';
  kahf: boolean;
  /** After a prayer time, the Home card shows the time since it for this many minutes (0 = off). */
  afterPrayerMinutes: number;
}

export const DEFAULT_HOME_CARDS: HomeCardSettings = {
  morning: true, morningUntil: 'dhuhr', evening: true, eveningFrom: 'asr', eveningUntil: 'midnight', kahf: true, afterPrayerMinutes: 40,
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  morning: { enabled: true, mode: 'afterFajr', minutesAfterFajr: 20, time: '06:30' },
  evening: { enabled: true, anchor: 'afterAsr', minutes: 15, time: '17:00' },
  sleep: { enabled: false, time: '22:30' },
  fridayKahf: { enabled: true, time: '10:00' },
  fridaySalawat: { enabled: true, time: '16:00' },
  wird: { enabled: false, time: '20:00' },
  hifz: { enabled: false, time: '18:00' },
  homeCards: DEFAULT_HOME_CARDS,
};

export interface ReminderTexts {
  morningTitle: string; morningBody: string;
  eveningTitle: string; eveningBody: string;
  sleepTitle: string; sleepBody: string;
  kahfTitle: string; kahfBody: string;
  salawatTitle: string; salawatBody: string;
  wirdTitle?: string; wirdBody?: string;
  hifzTitle?: string; hifzBody?: string;
}

export function atTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Builds the reminders for [days] days starting today. Prayer-anchored reminders are skipped
 * when no location is set; fixed-time ones (sleep, Friday) still work.
 */
export function planReminders(
  prayer: PrayerSettings,
  r: ReminderSettings,
  texts: ReminderTexts,
  now = new Date(),
  days = 30,
): NativeReminder[] {
  const out: NativeReminder[] = [];
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  for (let i = 0; i < days; i++) {
    const day = new Date(startOfToday);
    day.setDate(day.getDate() + i);
    const key = dayKey(day);
    const times = prayerTimesFor(prayer, day)?.times;

    const morningFixed = r.morning.mode === 'time';
    if (r.morning.enabled && (times || morningFixed)) {
      const at = morningFixed
        ? atTime(day, r.morning.time).getTime()
        : times!.fajr.getTime() + r.morning.minutesAfterFajr * 60_000;
      out.push({ id: `morning-${key}`, kind: 'morning', title: texts.morningTitle, body: texts.morningBody, at, route: '/category/morning' });
    }
    const eveningFixed = r.evening.anchor === 'time';
    if (r.evening.enabled && (times || eveningFixed)) {
      const at = eveningFixed
        ? atTime(day, r.evening.time).getTime()
        : r.evening.anchor === 'beforeMaghrib'
          ? times!.maghrib.getTime() - r.evening.minutes * 60_000
          : times!.asr.getTime() + r.evening.minutes * 60_000;
      out.push({ id: `evening-${key}`, kind: 'evening', title: texts.eveningTitle, body: texts.eveningBody, at, route: '/category/evening' });
    }
    if (r.sleep.enabled) {
      out.push({
        id: `sleep-${key}`, kind: 'sleep', title: texts.sleepTitle, body: texts.sleepBody,
        at: atTime(day, r.sleep.time).getTime(), route: '/category/sleep',
      });
    }
    if (r.wird?.enabled) {
      out.push({
        id: `wird-${key}`, kind: 'wird', title: texts.wirdTitle ?? '', body: texts.wirdBody ?? '',
        at: atTime(day, r.wird.time).getTime(), route: '/khatmah',
      });
    }
    if (r.hifz?.enabled) {
      out.push({
        id: `hifz-${key}`,
        kind: 'hifz',
        title: texts.hifzTitle ?? '',
        body: texts.hifzBody ?? '',
        at: atTime(day, r.hifz.time).getTime(),
        route: '/hifz',
      });
    }
    // Friday = 5 in JS (Sunday = 0).
    if (day.getDay() === 5) {
      if (r.fridayKahf.enabled) {
        out.push({ id: `kahf-${key}`, kind: 'friday-kahf', title: texts.kahfTitle, body: texts.kahfBody, at: atTime(day, r.fridayKahf.time).getTime() });
      }
      if (r.fridaySalawat.enabled) {
        out.push({ id: `salawat-${key}`, kind: 'friday-salawat', title: texts.salawatTitle, body: texts.salawatBody, at: atTime(day, r.fridaySalawat.time).getTime() });
      }
    }
  }
  return out.filter((x) => x.at > now.getTime()).sort((a, b) => a.at - b.at);
}
