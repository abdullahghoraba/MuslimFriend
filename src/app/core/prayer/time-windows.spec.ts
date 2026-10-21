import { DayTimes } from './prayer-times';
import { nowSuggestions } from './time-windows';

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

  it('falls back to clock times without a location', () => {
    expect(nowSuggestions(d(21, 7, 0), null)).toEqual(['morning']);
    expect(nowSuggestions(d(21, 16, 0), null)).toEqual(['evening']);
    expect(nowSuggestions(d(23, 17, 59), null)).toEqual(['kahf', 'evening']);
    expect(nowSuggestions(d(23, 18, 0), null)).toEqual(['evening']);
  });
});
