import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActionSheetController, AlertController, ModalController, NavController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { vi } from 'vitest';
import { CategoryPage } from './category.page';
import { AthkarRepository } from '../../core/services/athkar.repository';
import { AthkarPrefsService } from '../../core/services/athkar-prefs.service';
import { AthkarMeaningService } from '../../core/services/athkar-meaning.service';
import { ProgressService } from '../../core/services/progress.service';
import { SettingsService } from '../../core/services/settings.service';
import { HapticsService } from '../../core/services/haptics.service';
import { ShareService } from '../../core/services/share.service';
import { DatabaseService } from '../../core/db/database.service';
import { createFakeDb } from '../../testing/fake-sql-db';
import { Dhikr } from '../../core/models';

describe('Category daily resume wiring', () => {
  const items = [0, 1, 2].map(i => ({ id: 'morning-' + i, categoryId: 'morning', repeatCount: 3 } as Dhikr));

  afterEach(() => { vi.useRealTimers(); });

  it('resumes despite start=0, preserves partial counts, and resets a cached page next day', async () => {
    const db = await createFakeDb();
    const prefs = signal({ readingMode: 'single', onComplete: 'dim', countPastTarget: false });
    TestBed.configureTestingModule({ providers: [
      { provide: DatabaseService, useValue: db },
      { provide: AthkarRepository, useValue: { byCategory: async () => items, hiddenIn: async () => [] } },
      { provide: AthkarPrefsService, useValue: { prefs, ready: Promise.resolve() } },
      { provide: SettingsService, useValue: { settings: signal({ language: 'en' }), setReaderPosition: vi.fn() } },
      ...[AthkarMeaningService, HapticsService, ShareService, TranslateService, ActionSheetController,
        AlertController, ModalController, NavController, ToastController].map(provide => ({ provide, useValue: {} })),
    ] });
    TestBed.overrideComponent(CategoryPage, { set: { template: '', imports: [] } });
    const progress = TestBed.inject(ProgressService);
    await progress.increment(items[0].id, 3, 'app', '2026-01-31');
    await progress.increment(items[1].id, 1, 'app', '2026-01-31');
    await progress.savePosition('morning', items[1].id, '2026-01-31');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31, 8));
    const fixture = TestBed.createComponent(CategoryPage);
    fixture.componentRef.setInput('id', 'morning');
    fixture.componentRef.setInput('start', '0');
    fixture.detectChanges();
    const page = fixture.componentInstance;
    await page.load();
    expect(page.singleIndex()).toBe(1);
    expect(page.countOf(items[1])).toBe(1);
    page.ionViewWillLeave();
    vi.setSystemTime(new Date(2026, 1, 1, 8));
    await page.load();
    expect(page.singleIndex()).toBe(0);
    expect(page.countOf(items[1])).toBe(0);
    expect(page.allDone()).toBe(false);
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
