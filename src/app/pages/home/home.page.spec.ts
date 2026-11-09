import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalController, NavController } from '@ionic/angular';
import { vi } from 'vitest';
import { HomePage } from './home.page';
import { AthkarRepository } from '../../core/services/athkar.repository';
import { ProgressService } from '../../core/services/progress.service';
import { SettingsService } from '../../core/services/settings.service';
import { PrayerService } from '../../core/prayer/prayer.service';
import { OverlayService } from '../../core/services/overlay.service';
import { QuranService } from '../../core/quran/quran.service';
import { AthanService } from '../../core/prayer/athan.service';
import { DEFAULT_PRAYER_SETTINGS, DEFAULT_REMINDER_SETTINGS, prayerTimesFor } from '../../core/prayer/prayer-times';

describe('Home live clock lifecycle', () => {
  let page: HomePage;
  const settings = { ...DEFAULT_PRAYER_SETTINGS, location: { latitude: 30, longitude: 31, name: 'Cairo', source: 'manual' as const } };
  const serviceNow = signal(new Date(2026, 1, 20, 12));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(serviceNow());
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    TestBed.configureTestingModule({ providers: [
      { provide: AthkarRepository, useValue: { homeCategories: signal([]) } },
      { provide: ProgressService, useValue: {} },
      { provide: SettingsService, useValue: { settings: signal({ language: 'en' }) } },
      { provide: PrayerService, useValue: { now: serviceNow, prayer: signal(settings), reminders: signal(DEFAULT_REMINDER_SETTINGS) } },
      { provide: OverlayService, useValue: {} },
      { provide: QuranService, useValue: { ready: signal(true) } },
      { provide: AthanService, useValue: { settings: signal({ ramadan: { imsakMinutes: 10 } }) } },
      { provide: NavController, useValue: {} },
      { provide: ModalController, useValue: {} },
    ] });
    page = TestBed.runInInjectionContext(() => new HomePage());
  });

  afterEach(() => {
    page.ngOnDestroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('pauses for another tab and a hidden document without changing the shared clock', () => {
    const target = new Date(+serviceNow() + 10_000);
    expect(vi.getTimerCount()).toBe(0);
    page.ionViewDidEnter();
    vi.advanceTimersByTime(1000);
    expect(page.countdown(target)).toBe('0:00:09');
    expect(serviceNow().getSeconds()).toBe(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(3000);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(page.countdown(target)).toBe('0:00:06');
    page.ionViewWillLeave();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    page.ionViewDidEnter();
    page.ngOnDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('moves both Ramadan and prayer targets at Maghrib without a minute tick', () => {
    const maghrib = prayerTimesFor(settings, serviceNow())!.times.maghrib;
    vi.setSystemTime(new Date(+maghrib - 1000));
    page.ionViewDidEnter();
    expect(page.ramadan()?.untilIftar).toBe(true);
    expect(page.countdown(page.ramadan()!.target)).toBe('0:00:01');
    vi.advanceTimersByTime(1000);
    expect(page.next()?.name).toBe('isha');
    expect(page.recent()).toMatchObject({ name: 'maghrib', elapsedMin: 0 });
    expect(page.ramadan()?.untilIftar).toBe(false);
    expect(+page.ramadan()!.target).toBeGreaterThan(+maghrib);
  });
});
