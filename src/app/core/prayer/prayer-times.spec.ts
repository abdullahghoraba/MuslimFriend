import {
  DEFAULT_PRAYER_SETTINGS,
  DEFAULT_REMINDER_SETTINGS,
  PrayerSettings,
  ReminderTexts,
  atTime,
  nextPrayer,
  planReminders,
  prayerTimesFor,
} from './prayer-times';

const cairo: PrayerSettings = {
  ...DEFAULT_PRAYER_SETTINGS,
  location: { latitude: 30.0444, longitude: 31.2357, name: 'Cairo', source: 'manual' },
  method: 'Egyptian',
};

const texts: ReminderTexts = {
  morningTitle: 'm', morningBody: 'm', eveningTitle: 'e', eveningBody: 'e', sleepTitle: 's', sleepBody: 's',
  kahfTitle: 'k', kahfBody: 'k', salawatTitle: 'w', salawatBody: 'w',
};

// A Wednesday at 01:00 local time.
const wed = new Date(2026, 9, 21, 1, 0, 0);

describe('prayerTimesFor', () => {
  it('returns null without a location', () => {
    expect(prayerTimesFor(DEFAULT_PRAYER_SETTINGS, wed)).toBeNull();
  });

  it('orders the six times within the day', () => {
    const t = prayerTimesFor(cairo, wed)!.times;
    const order = [t.fajr, t.sunrise, t.dhuhr, t.asr, t.maghrib, t.isha].map((d) => d.getTime());
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Dhuhr in Cairo is around solar noon (~11:40 UTC in October).
    expect(t.dhuhr.getUTCHours()).toBeGreaterThanOrEqual(9);
    expect(t.dhuhr.getUTCHours()).toBeLessThanOrEqual(10);
  });

  it('Hanafi Asr is later than the standard Asr', () => {
    const std = prayerTimesFor(cairo, wed)!.times.asr.getTime();
    const hanafi = prayerTimesFor({ ...cairo, madhab: 'hanafi' }, wed)!.times.asr.getTime();
    expect(hanafi).toBeGreaterThan(std + 20 * 60_000);
  });

  it('applies manual minute adjustments', () => {
    const base = prayerTimesFor(cairo, wed)!.times.fajr.getTime();
    const adjusted = prayerTimesFor({ ...cairo, adjustments: { ...cairo.adjustments, fajr: 5 } }, wed)!.times.fajr.getTime();
    expect(adjusted - base).toBe(5 * 60_000);
  });
});

describe('nextPrayer', () => {
  it('skips sunrise and rolls over to tomorrow after Isha', () => {
    const t = prayerTimesFor(cairo, wed)!.times;
    expect(nextPrayer(cairo, new Date(t.fajr.getTime() + 60_000))!.name).toBe('dhuhr');
    const late = new Date(t.isha.getTime() + 60_000);
    const n = nextPrayer(cairo, late)!;
    expect(n.name).toBe('fajr');
    expect(n.at.getDate()).not.toBe(late.getDate());
  });
});

describe('planReminders', () => {
  it('plans morning after Fajr and evening after Asr with offsets', () => {
    const list = planReminders(cairo, DEFAULT_REMINDER_SETTINGS, texts, wed, 1);
    const t = prayerTimesFor(cairo, wed)!.times;
    const morning = list.find((r) => r.kind === 'morning')!;
    const evening = list.find((r) => r.kind === 'evening')!;
    expect(morning.at).toBe(t.fajr.getTime() + 20 * 60_000);
    expect(evening.at).toBe(t.asr.getTime() + 15 * 60_000);
    expect(morning.route).toBe('/category/morning');
  });

  it('supports "before Maghrib" for the evening reminder', () => {
    const r = { ...DEFAULT_REMINDER_SETTINGS, evening: { enabled: true, anchor: 'beforeMaghrib' as const, minutes: 30, time: '17:00' } };
    const evening = planReminders(cairo, r, texts, wed, 1).find((x) => x.kind === 'evening')!;
    expect(evening.at).toBe(prayerTimesFor(cairo, wed)!.times.maghrib.getTime() - 30 * 60_000);
  });

  it('supports a fixed clock time for morning and evening, even without a location', () => {
    const r = {
      ...DEFAULT_REMINDER_SETTINGS,
      morning: { enabled: true, mode: 'time' as const, minutesAfterFajr: 20, time: '07:15' },
      evening: { enabled: true, anchor: 'time' as const, minutes: 15, time: '18:45' },
    };
    for (const prayer of [cairo, DEFAULT_PRAYER_SETTINGS]) {
      const list = planReminders(prayer, r, texts, wed, 1);
      const morning = new Date(list.find((x) => x.kind === 'morning')!.at);
      const evening = new Date(list.find((x) => x.kind === 'evening')!.at);
      expect([morning.getHours(), morning.getMinutes()]).toEqual([7, 15]);
      expect([evening.getHours(), evening.getMinutes()]).toEqual([18, 45]);
    }
  });

  it('adds Friday reminders only on Fridays', () => {
    const list = planReminders(cairo, DEFAULT_REMINDER_SETTINGS, texts, wed, 7);
    const friday = list.filter((r) => r.kind === 'friday-kahf');
    expect(friday).toHaveLength(1);
    expect(new Date(friday[0].at).getDay()).toBe(5);
    expect(list.some((r) => r.kind === 'friday-salawat')).toBe(true);
  });

  it('keeps fixed-time reminders without a location and drops past ones', () => {
    const r = { ...DEFAULT_REMINDER_SETTINGS, sleep: { enabled: true, time: '00:30' } };
    const list = planReminders(DEFAULT_PRAYER_SETTINGS, r, texts, wed, 2);
    expect(list.some((x) => x.kind === 'morning' || x.kind === 'evening')).toBe(false);
    // Today's 00:30 is already past at 01:00, so only tomorrow's sleep reminder remains.
    expect(list.filter((x) => x.kind === 'sleep')).toHaveLength(1);
    expect(list.every((x) => x.at > wed.getTime())).toBe(true);
  });

  it('produces unique ids sorted by time over 30 days', () => {
    const list = planReminders(cairo, { ...DEFAULT_REMINDER_SETTINGS, sleep: { enabled: true, time: '22:30' } }, texts, wed, 30);
    expect(new Set(list.map((r) => r.id)).size).toBe(list.length);
    expect(list.map((r) => r.at)).toEqual([...list.map((r) => r.at)].sort((a, b) => a - b));
    expect(list.length).toBeGreaterThan(80);
  });
});

describe('atTime', () => {
  it('sets local hours and minutes', () => {
    const d = atTime(wed, '22:45');
    expect([d.getHours(), d.getMinutes()]).toEqual([22, 45]);
  });
});
