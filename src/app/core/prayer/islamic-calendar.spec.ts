import { daysBetween, hijriOf, occasionsOn, upcomingOccasions } from './islamic-calendar';
import { DEFAULT_PRAYER_SETTINGS, DEFAULT_REMINDER_SETTINGS, PrayerSettings, nightTimes, planReminders, prayerTimesFor } from './prayer-times';

const tanta: PrayerSettings = { ...DEFAULT_PRAYER_SETTINGS, location: { latitude: 30.79, longitude: 31, name: '', source: 'manual' } };

describe('islamic calendar', () => {
  it('reads the Umm al-Qura date and applies the adjustment', () => {
    const day = new Date(2026, 9, 26, 12);
    expect(hijriOf(day)).toEqual({ year: 1448, month: 5, day: 15 });
    expect(hijriOf(day, 1).day).toBe(16);
    expect(hijriOf(day, -2).day).toBe(13);
  });

  it('knows the fixed occasions and which are fasts', () => {
    expect(occasionsOn({ year: 1448, month: 12, day: 9 })).toEqual([{ id: 'arafah', fast: true }]);
    expect(occasionsOn({ year: 1448, month: 10, day: 1 })).toEqual([{ id: 'eidFitr', fast: false }]);
    // 13 Dhu al-Hijjah is a day of Tashreeq, not a white day; white days are skipped in Ramadan.
    expect(occasionsOn({ year: 1448, month: 12, day: 13 }).map((o) => o.id)).toEqual(['tashreeq']);
    expect(occasionsOn({ year: 1448, month: 9, day: 14 })).toEqual([]);
  });

  it('lists a run of days (white days, Tashreeq) once, on its first day', () => {
    const list = upcomingOccasions(new Date(2026, 9, 26, 12), 0, 40);
    expect(list.filter((o) => o.id === 'whiteDays').map((o) => o.hijri.day)).toEqual([15, 13]);
    expect(daysBetween(new Date(2026, 9, 26), list[1].date)).toBe(28);
  });

  it('puts the last third of the night two thirds of the way from Maghrib to Fajr', () => {
    const day = new Date(2026, 9, 26, 12);
    const n = nightTimes(tanta, day)!;
    const maghrib = prayerTimesFor(tanta, day)!.times.maghrib.getTime();
    const fajr = prayerTimesFor(tanta, new Date(2026, 9, 27, 12))!.times.fajr.getTime();
    expect(n.midnight.getTime()).toBeCloseTo(maghrib + (fajr - maghrib) / 2, -3);
    expect(n.lastThird.getTime()).toBeCloseTo(maghrib + (2 * (fajr - maghrib)) / 3, -3);
  });

  it('reminds of a fast the evening before, and of Monday/Thursday only when asked', () => {
    const texts = {
      morningTitle: '', morningBody: '', eveningTitle: '', eveningBody: '', sleepTitle: '', sleepBody: '',
      kahfTitle: '', kahfBody: '', salawatTitle: '', salawatBody: '',
      fasting: (id: string) => ({ title: 'fast:' + id, body: '' }),
    };
    const base = { ...DEFAULT_REMINDER_SETTINGS, morning: { ...DEFAULT_REMINDER_SETTINGS.morning, enabled: false }, evening: { ...DEFAULT_REMINDER_SETTINGS.evening, enabled: false }, fridayKahf: { enabled: false, time: '10:00' }, fridaySalawat: { enabled: false, time: '16:00' } };
    const now = new Date(2026, 9, 26, 8);
    const on = planReminders(tanta, { ...base, fasting: { enabled: true, time: '21:00', mondayThursday: false } }, texts, now, 30);
    // 13 Jumada II 1448 is 23 Nov 2026: the reminder comes on the 22nd at 21:00.
    expect(on.map((r) => [r.title, new Date(r.at).getDate()])).toContainEqual(['fast:whiteDays', 22]);
    expect(on.some((r) => r.title === 'fast:mondayThursday')).toBe(false);
    const mt = planReminders(tanta, { ...base, fasting: { enabled: true, time: '21:00', mondayThursday: true } }, texts, now, 7);
    expect(mt.filter((r) => r.title === 'fast:mondayThursday').length).toBeGreaterThan(0);
  });
});
