import { DayTimes } from './prayer-times';
import { nowSuggestions, recentPrayer } from './time-windows';

// 2026-10-22 is a Thursday, 2026-10-23 a Friday.
const d = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);
const times = (day: number): DayTimes => ({
  date: d(day, 0),
  times: { fajr: d(day, 5, 10), sunrise: d(day, 6, 30), dhuhr: d(day, 11, 45), asr: d(day, 14, 55), maghrib: d(day, 17, 20), isha: d(day, 18, 40) },
});

describe('nowSuggestions', () => {
  it('suggests morning athkar between Fajr and Dhuhr', () => {
    expect(nowSuggestions(d(21, 5, 10), times(21))).toEqual(['morning']);
    expect(nowSuggestions(d(21, 11, 44), times(21))).toEqual(['morning']);
    expect(nowSuggestions(d(21, 5, 9), times(21))).toEqual([]);
    expect(nowSuggestions(d(21, 12, 0), times(21))).toEqual([]);
  });

  it('suggests evening athkar from Asr until midnight', () => {
    expect(nowSuggestions(d(21, 14, 55), times(21))).toEqual(['evening']);
    expect(nowSuggestions(d(21, 23, 59), times(21))).toEqual(['evening']);
    expect(nowSuggestions(d(21, 0, 30), times(21))).toEqual([]);
  });

  it('suggests al-Kahf from Maghrib on Thursday until Maghrib on Friday', () => {
    expect(nowSuggestions(d(22, 17, 19), times(22))).toEqual(['evening']);
    expect(nowSuggestions(d(22, 17, 20), times(22))).toEqual(['kahf', 'evening']);
    expect(nowSuggestions(d(23, 2, 0), times(23))).toEqual(['kahf']);
    expect(nowSuggestions(d(23, 8, 0), times(23))).toEqual(['kahf', 'morning']);
    expect(nowSuggestions(d(23, 17, 19), times(23))).toEqual(['kahf', 'evening']);
    expect(nowSuggestions(d(23, 17, 20), times(23))).toEqual(['evening']);
  });

  it('follows the chosen windows and switches', () => {
    const cards = { morning: true, morningUntil: 'sunrise', evening: true, eveningFrom: 'maghrib', eveningUntil: 'isha', kahf: false, afterPrayerMinutes: 40 } as const;
    expect(nowSuggestions(d(21, 6, 29), times(21), cards)).toEqual(['morning']);
    expect(nowSuggestions(d(21, 6, 30), times(21), cards)).toEqual([]);
    expect(nowSuggestions(d(21, 16, 0), times(21), cards)).toEqual([]);
    expect(nowSuggestions(d(21, 17, 20), times(21), cards)).toEqual(['evening']);
    expect(nowSuggestions(d(21, 18, 40), times(21), cards)).toEqual([]);
    expect(nowSuggestions(d(23, 8, 0), times(23), cards)).toEqual([]);
    expect(nowSuggestions(d(21, 8, 0), times(21), { ...cards, morning: false })).toEqual([]);
    // An empty range (Maghrib → Maghrib) runs until midnight instead.
    expect(nowSuggestions(d(21, 22, 0), times(21), { ...cards, eveningUntil: 'maghrib' })).toEqual(['evening']);
  });

  it('falls back to clock times without a location', () => {
    expect(nowSuggestions(d(21, 7, 0), null)).toEqual(['morning']);
    expect(nowSuggestions(d(21, 16, 0), null)).toEqual(['evening']);
    expect(nowSuggestions(d(23, 17, 59), null)).toEqual(['kahf', 'evening']);
    expect(nowSuggestions(d(23, 18, 0), null)).toEqual(['evening']);
  });
});

describe('recentPrayer', () => {
  it('shows the time since the last prayer for the chosen minutes, then nothing', () => {
    expect(recentPrayer(d(21, 15, 7), times(21), times(20), 40)).toEqual({ name: 'asr', at: d(21, 14, 55), elapsedMin: 12 });
    expect(recentPrayer(d(21, 15, 35), times(21), times(20), 40)).toBeNull();
    expect(recentPrayer(d(21, 15, 34), times(21), times(20), 50)?.elapsedMin).toBe(39);
    expect(recentPrayer(d(21, 15, 7), times(21), times(20), 0)).toBeNull();
  });
  it("ignores sunrise and finds yesterday's isha after midnight", () => {
    expect(recentPrayer(d(21, 5, 30), times(21), times(20), 40)?.name).toBe('fajr');
    expect(recentPrayer(d(21, 6, 40), times(21), times(20), 120)?.name).toBe('fajr');
    const late = { date: d(20, 0), times: { ...times(20).times, isha: d(20, 23, 50) } };
    expect(recentPrayer(d(21, 0, 10), times(21), late, 40)).toEqual({ name: 'isha', at: d(20, 23, 50), elapsedMin: 20 });
  });
});
