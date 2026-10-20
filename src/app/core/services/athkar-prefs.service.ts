import { Injectable, computed, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { SettingsService } from './settings.service';

export interface AthkarPrefs {
  readingMode: 'list' | 'single';
  tapTarget: 'card' | 'button';
  autoAdvance: boolean;
  countPastTarget: boolean;
  vibration: 'off' | 'light' | 'strong';
  showSource: boolean;
  showTransliteration: boolean;
  showMeaning: boolean;
}
const defaults = {
  readingMode: 'list', tapTarget: 'card', autoAdvance: true,
  countPastTarget: false, vibration: 'light', showSource: true,
} as const;
/** Missing language-dependent fields follow the language until explicitly changed. */
@Injectable({ providedIn: 'root' })
export class AthkarPrefsService {
  private readonly settings = inject(SettingsService);
  private readonly stored = signal<Partial<AthkarPrefs>>({});
  readonly prefs = computed<AthkarPrefs>(() => ({
    ...defaults,
    showTransliteration: this.settings.settings().language === 'en',
    showMeaning: this.settings.settings().language === 'en',
    ...this.stored(),
  }));
  private pending = Promise.resolve();
  readonly ready = this.load();

  async load(): Promise<void> {
    const { value } = await Preferences.get({ key: 'athkarPrefs' });
    let parsed: unknown;
    try { parsed = value ? JSON.parse(value) : {}; } catch { parsed = {}; }
    const clean: Partial<AthkarPrefs> = {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const data = parsed as Record<string, unknown>;
      for (const key of ['autoAdvance', 'countPastTarget', 'showSource', 'showTransliteration', 'showMeaning'] as const)
        if (typeof data[key] === 'boolean') clean[key] = data[key];
      if (data['readingMode'] === 'list' || data['readingMode'] === 'single') clean.readingMode = data['readingMode'];
      if (data['tapTarget'] === 'card' || data['tapTarget'] === 'button') clean.tapTarget = data['tapTarget'];
      if (['off', 'light', 'strong'].includes(String(data['vibration']))) clean.vibration = data['vibration'] as AthkarPrefs['vibration'];
    }
    this.stored.set(clean);
  }
  async update(patch: Partial<AthkarPrefs>): Promise<void> {
    await this.ready;
    this.stored.update(s => ({ ...s, ...patch }));
    const value = JSON.stringify(this.stored());
    this.pending = this.pending.catch(() => {}).then(() => Preferences.set({ key: 'athkarPrefs', value }));
    await this.pending;
  }
}
