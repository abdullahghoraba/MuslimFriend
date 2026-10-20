import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { TranslateService } from '@ngx-translate/core';
import { AthkarOverlay, FallbackReason } from '../../native/athkar-overlay';
import { SettingsService } from './settings.service';
import { TasbihService } from './tasbih.service';

interface FloatingSettings {
  enabled: boolean;
  /** Tasbih counter mirrored by the bubble; 0 = the first counter. */
  counterId: number;
}

const KEY = 'floatingCounter';

/**
 * Floating tasbih counter shown over other apps (e.g. while browsing Facebook).
 * Taps on the bubble are stored natively and merged into the tasbih counter on app resume;
 * changes made in the app (count, target, name, reset) are pushed back to the bubble.
 */
@Injectable({ providedIn: 'root' })
export class FloatingCounterService {
  private readonly tasbih = inject(TasbihService);
  private readonly settings = inject(SettingsService);
  private readonly translate = inject(TranslateService);

  private readonly state = signal<FloatingSettings>({ enabled: false, counterId: 0 });
  readonly floating = this.state.asReadonly();
  private loaded = false;

  constructor() {
    // Keep the bubble in step with the counter shown in the app.
    effect(() => {
      const counters = this.tasbih.counters();
      const s = this.state();
      if (!this.loaded || !s.enabled || !counters.length) return;
      untracked(() => void this.push());
    });
  }

  async load(): Promise<void> {
    const { value } = await Preferences.get({ key: KEY });
    if (value) {
      try {
        this.state.set({ enabled: false, counterId: 0, ...JSON.parse(value) });
      } catch {
        /* keep defaults */
      }
    }
    this.loaded = true;
  }

  /** Merges taps made on the bubble into the counters. Call on app start/resume. */
  async sync(): Promise<void> {
    if (!this.loaded) await this.load();
    const { counts } = await AthkarOverlay.takeBubbleCounts({ clear: true });
    if (counts.length) await this.tasbih.load();
    for (const c of counts) await this.tasbih.applyExternal(c.counterId, c.delta, c.reset);
    if (this.state().enabled) await this.push();
  }

  /** User action (foreground): shows the bubble for [counterId]. Returns false if overlay permission is missing. */
  async enable(counterId: number): Promise<{ ok: boolean; needsPermission: boolean; fallbackReason: FallbackReason }> {
    const { granted } = await AthkarOverlay.checkOverlayPermission();
    if (!granted) return { ok: false, needsPermission: true, fallbackReason: null };
    await this.save({ enabled: true, counterId });
    const result = await this.push(true);
    return { ok: result?.running ?? false, needsPermission: false, fallbackReason: result?.fallbackReason ?? null };
  }

  async disable(): Promise<void> {
    await this.save({ ...this.state(), enabled: false });
    await AthkarOverlay.setBubble({ enabled: false });
  }

  async setCounter(counterId: number): Promise<void> {
    await this.save({ ...this.state(), counterId });
    if (this.state().enabled) await this.push();
  }

  private async push(forceStart = false) {
    const counters = this.tasbih.counters();
    const counter = counters.find((c) => c.id === this.state().counterId) ?? counters[0];
    if (!counter) return undefined;
    return AthkarOverlay.setBubble({
      enabled: this.state().enabled || forceStart,
      counterId: counter.id,
      name: counter.name || this.translate.instant('tasbih.defaultName'),
      count: counter.count,
      target: counter.target,
      language: this.settings.settings().language,
    });
  }

  private async save(s: FloatingSettings): Promise<void> {
    this.state.set(s);
    await Preferences.set({ key: KEY, value: JSON.stringify(s) });
  }
}
