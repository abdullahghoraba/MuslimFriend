import { addDays, dateKey } from './date';

describe('dateKey', () => {
  it('zero-pads single-digit months and days', () => {
    expect(dateKey(new Date(2026, 0, 2))).toBe('2026-01-02');
    expect(dateKey(new Date(2026, 10, 12))).toBe('2026-11-12');
  });

  it('uses local calendar components rather than UTC components', () => {
    const local = new Date(2026, 0, 2, 0, 15);
    // Model a local midnight that falls on a different UTC date, independent of host TZ.
    const utc = vi.spyOn(local, 'toISOString').mockReturnValue('2026-01-01T22:15:00.000Z');
    vi.spyOn(local, 'getUTCDate').mockReturnValue(1);
    expect(dateKey(local)).toBe('2026-01-02');
    expect(utc).not.toHaveBeenCalled();
  });

  it('defaults to the current local date', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 8, 7, 23, 59));
      expect(dateKey()).toBe('2026-09-07');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('addDays', () => {
  it.each([
    [2026, 0, 31, 1, '2026-02-01'],
    [2024, 1, 28, 1, '2024-02-29'],
    [2024, 1, 29, 1, '2024-03-01'],
    [2026, 2, 1, -1, '2026-02-28'],
    [2026, 11, 31, 1, '2027-01-01'],
  ])('moves %i/%i/%i by %i days to %s', (year, month, day, days, expected) => {
    const original = new Date(year, month, day, 12, 34, 56);
    const timestamp = original.getTime();
    const result = addDays(original, days);
    expect(dateKey(result)).toBe(expected);
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(34);
    expect(original.getTime()).toBe(timestamp);
    expect(result).not.toBe(original);
  });
});
