import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { AppSettings, DEFAULT_SETTINGS, ReaderPosition } from '../models';

const SETTINGS_KEY = 'settings';
const READER_POSITION_KEY = 'readerPosition';

/** App settings persisted in Capacitor Preferences and exposed as a signal. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly state = signal<AppSettings>(DEFAULT_SETTINGS);
  readonly settings = this.state.asReadonly();

  async load(): Promise<AppSettings> {
    const { value } = await Preferences.get({ key: SETTINGS_KEY });
    if (value) {
      try {
        this.state.set({ ...DEFAULT_SETTINGS, ...JSON.parse(value) });
      } catch {
        this.state.set(DEFAULT_SETTINGS);
      }
    }
    return this.state();
  }

  async update(patch: Partial<AppSettings>): Promise<void> {
    this.state.update((s) => ({ ...s, ...patch }));
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(this.state()) });
  }

  async getReaderPosition(): Promise<ReaderPosition | null> {
    const { value } = await Preferences.get({ key: READER_POSITION_KEY });
    return value ? (JSON.parse(value) as ReaderPosition) : null;
  }

  async setReaderPosition(categoryId: string, index: number): Promise<void> {
    const position: ReaderPosition = { categoryId, index, updatedAt: Date.now() };
    await Preferences.set({ key: READER_POSITION_KEY, value: JSON.stringify(position) });
  }

  async reset(): Promise<void> {
    await Preferences.clear();
    this.state.set(DEFAULT_SETTINGS);
  }
}
