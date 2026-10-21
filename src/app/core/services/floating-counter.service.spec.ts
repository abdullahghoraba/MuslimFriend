import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { vi } from 'vitest';
import { AthkarOverlay } from '../../native/athkar-overlay';
import { FloatingCounterService } from './floating-counter.service';
import { SettingsService } from './settings.service';
import { TasbihService } from './tasbih.service';

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(async () => ({ value: null })), set: vi.fn(async () => {}) },
}));

// Uses the browser stand-in of the native plugin, which keeps the bubble state like the Android side.
describe('FloatingCounterService', () => {
  const counters = signal([{ id: 1, name: 'x', count: 3, target: 33 }]);
  let service: FloatingCounterService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: TasbihService, useValue: { counters, load: vi.fn(), applyExternal: vi.fn() } },
        { provide: SettingsService, useValue: { settings: signal({ language: 'ar' }) } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
      ],
    });
    service = TestBed.inject(FloatingCounterService);
    await service.load();
  });

  it('shows the bubble when the user enables it', async () => {
    await service.enable(1);
    expect((await AthkarOverlay.getBubble()).enabled).toBe(true);
  });

  it('never re-shows a bubble the user closed outside the app', async () => {
    await service.enable(1);
    // User taps ✕ on the bubble: the native side turns itself off.
    await AthkarOverlay.setBubble({ enabled: false });
    await service.setLook({ sizeDp: 80 });
    await service.setCounter(1);
    counters.set([{ id: 1, name: 'x', count: 4, target: 33 }]);
    TestBed.tick();
    await service.sync();
    expect((await AthkarOverlay.getBubble()).enabled).toBe(false);
    expect(service.floating().enabled).toBe(false);
  });
});
