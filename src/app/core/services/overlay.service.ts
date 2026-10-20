import { Injectable, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { TranslateService } from '@ngx-translate/core';
import { AthkarOverlay, FallbackReason, OverlayConfig, OverlayPoolItem } from '../../native/athkar-overlay';
import { CUSTOM_CATEGORY_ID } from '../models';
import { AthkarRepository } from './athkar.repository';
import { ProgressService } from './progress.service';
import { SettingsService } from './settings.service';

/** App-side overlay settings: the native config plus which categories feed the overlay. */
export interface OverlaySettings extends Omit<OverlayConfig, 'language' | 'notificationTitle' | 'notificationText' | 'actionPause' | 'actionStop'> {
  categories: string[];
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  enabled: false,
  frequencyMinutes: 15,
  displaySeconds: 8,
  position: 'top',
  size: 'medium',
  opacity: 0.95,
  style: 'system',
  quietHoursEnabled: true,
  quietStart: 23 * 60,
  quietEnd: 5 * 60,
  categories: ['tasbih', 'istighfar', 'dua', CUSTOM_CATEGORY_ID],
};

export const FREQUENCY_OPTIONS = [5, 10, 15, 30, 60, 0] as const;

/** Long passages do not fit a glanceable card; they stay in the reader. */
export const MAX_OVERLAY_TEXT_LENGTH = 320;

const STORAGE_KEY = 'overlaySettings';

@Injectable({ providedIn: 'root' })
export class OverlayService {
  private readonly athkar = inject(AthkarRepository);
  private readonly progress = inject(ProgressService);
  private readonly settings = inject(SettingsService);
  private readonly translate = inject(TranslateService);

  private readonly state = signal<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  readonly overlay = this.state.asReadonly();
  readonly running = signal(false);
  readonly pausedUntil = signal(0);
  readonly fallbackReason = signal<FallbackReason>(null);

  async load(): Promise<OverlaySettings> {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (value) {
      try {
        this.state.set({ ...DEFAULT_OVERLAY_SETTINGS, ...JSON.parse(value) });
      } catch {
        this.state.set(DEFAULT_OVERLAY_SETTINGS);
      }
    }
    await this.refreshStatus();
    return this.state();
  }

  async refreshStatus(): Promise<void> {
    const status = await AthkarOverlay.isRunning();
    this.running.set(status.running);
    this.pausedUntil.set(status.pausedUntil);
    this.fallbackReason.set(status.fallbackReason);
  }

  /** Builds the native config, including localized notification texts. */
  nativeConfig(s: OverlaySettings = this.state()): OverlayConfig {
    const { categories: _categories, ...rest } = s;
    return {
      ...rest,
      language: this.settings.settings().language,
      notificationTitle: this.translate.instant('overlay.notificationTitle'),
      notificationText: this.translate.instant('overlay.notificationText'),
      actionPause: this.translate.instant('overlay.pauseHour'),
      actionStop: this.translate.instant('overlay.stop'),
    };
  }

  /** Saves settings and pushes them to the running service. */
  async update(patch: Partial<OverlaySettings>): Promise<void> {
    this.state.update((s) => ({ ...s, ...patch }));
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(this.state()) });
    if ('categories' in patch) await this.syncPool();
    await AthkarOverlay.updateConfig({ config: this.nativeConfig() });
  }

  /** Must be called from a user action while the app is in the foreground (Android FGS rules). */
  async enable(): Promise<{ started: boolean; fallbackReason: FallbackReason }> {
    await this.syncPool();
    this.state.update((s) => ({ ...s, enabled: true }));
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(this.state()) });
    const result = await AthkarOverlay.start({ config: this.nativeConfig() });
    await this.refreshStatus();
    return result;
  }

  async disable(): Promise<void> {
    this.state.update((s) => ({ ...s, enabled: false }));
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(this.state()) });
    await AthkarOverlay.stop();
    await this.refreshStatus();
  }

  async pauseFor(ms: number): Promise<void> {
    await AthkarOverlay.pause({ until: Date.now() + ms });
    await this.refreshStatus();
  }

  /** Pauses until tomorrow at the end of quiet hours (or 06:00 when quiet hours are off). */
  async pauseUntilTomorrow(now = new Date()): Promise<void> {
    const until = new Date(now);
    until.setDate(until.getDate() + 1);
    const minutes = this.state().quietHoursEnabled ? this.state().quietEnd : 6 * 60;
    until.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    await AthkarOverlay.pause({ until: until.getTime() });
    await this.refreshStatus();
  }

  async resume(): Promise<void> {
    await AthkarOverlay.pause({ until: 0 });
    await this.refreshStatus();
  }

  /** Writes the dhikr pool the native service rotates through. */
  async syncPool(): Promise<number> {
    const categories = new Set(this.state().categories);
    const items: OverlayPoolItem[] = (await this.athkar.overlayPool())
      .filter((d) => categories.has(d.categoryId) && d.textAr.length <= MAX_OVERLAY_TEXT_LENGTH)
      .map((d) => ({ id: d.id, text: d.textAr, categoryId: d.categoryId, repeatCount: d.repeatCount }));
    // Duplicate texts (the same dhikr in two categories) would show twice in a row.
    const seen = new Set<string>();
    const unique = items.filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)));
    const { count } = await AthkarOverlay.setPool({ items: unique });
    return count;
  }

  /** Moves "+1" counts taken in the overlay into SQLite (source = overlay). */
  async syncCounters(): Promise<number> {
    const { counts } = await AthkarOverlay.getNativeCounters({ clear: true });
    for (const c of counts) await this.progress.increment(c.dhikrId, c.count, 'overlay', c.date);
    return counts.length;
  }

  async acknowledgeFallback(): Promise<void> {
    await AthkarOverlay.clearFallbackNotice();
    this.fallbackReason.set(null);
  }
}
