import { computed } from '@angular/core';
import { vi } from 'vitest';
import { DEFAULT_PRAYER_SETTINGS, nextPrayer, prayerTimesFor } from '../../core/prayer/prayer-times';
import { recentPrayer } from '../../core/prayer/time-windows';
import { formatCountdown, HomeClock } from './countdown';

describe('Home countdown', () => {
  const now = new Date(2026, 0, 31, 12);
  it.each([
    [3909, 'en', '1:05:09'], [309, 'en', '0:05:09'], [0, 'en', '0:00:00'],
    [-5, 'en', '0:00:00'], [3909, 'ar', '1:05:09'],
    [3909, 'fa', '1:05:09'], [3909, 'ur', '1:05:09'],
  ])('formats %s seconds in %s', (seconds, language, expected) => {
    expect(formatCountdown(new Date(+now + seconds * 1000), now, language)).toBe(expected);
  });

  it('does not round a future target down to zero', () => {
    expect(formatCountdown(new Date(+now + 1), now, 'en')).toBe('0:00:01');
  });

  afterEach(() => vi.useRealTimers());

  it('ticks only when active and immediately catches up on re-entry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const clock = new HomeClock();
    clock.setActive(true);
    clock.setActive(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(+clock.now()).toBe(+now + 1000);
    clock.setActive(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(+clock.now()).toBe(+now + 1000);
    clock.setActive(true);
    expect(+clock.now()).toBe(+now + 61_000);
    clock.setActive(false);
  });

  it('crosses zero into the next prayer and updates since sunrise immediately', () => {
    vi.useFakeTimers();
    const settings = { ...DEFAULT_PRAYER_SETTINGS, location: { latitude: 30, longitude: 31, name: 'Cairo', source: 'manual' as const } };
    const today = prayerTimesFor(settings, now)!;
    const sunrise = today.times.sunrise;
    vi.setSystemTime(new Date(+sunrise - 1000));
    const clock = new HomeClock();
    const next = computed(() => nextPrayer(settings, clock.now()));
    clock.setActive(true);
    expect(next()?.name).toBe('sunrise');
    expect(formatCountdown(next()!.at, clock.now(), 'en')).toBe('0:00:01');
    vi.advanceTimersByTime(1000);
    expect(next()?.name).toBe('dhuhr');
    expect(recentPrayer(clock.now(), today, null, 40)).toMatchObject({ name: 'sunrise', elapsedMin: 0 });
    vi.advanceTimersByTime(60_000);
    expect(recentPrayer(clock.now(), today, null, 40)?.elapsedMin).toBe(1);
    clock.setActive(false);
  });
});
