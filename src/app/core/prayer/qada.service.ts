import { Injectable, computed, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

const KEY = 'qadaCounts';
/** The five prayers (kept here, not imported from the athan service, to avoid a circular import). */
export const QADA_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type QadaPrayer = (typeof QADA_PRAYERS)[number];
export type QadaCounts = Record<QadaPrayer, number>;
const EMPTY: QadaCounts = { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
/** Highest count per prayer (about 55 years of daily prayers). */
export const QADA_MAX = 20000;

/** Missed (qada) prayers still owed, per prayer, kept on the device only. */
@Injectable({ providedIn: 'root' })
export class QadaService {
  private readonly state = signal<QadaCounts>(EMPTY);
  readonly counts = this.state.asReadonly();
  readonly total = computed(() => QADA_PRAYERS.reduce((sum, p) => sum + this.state()[p], 0));
  readonly ready = this.load();

  private async load(): Promise<void> {
    const { value } = await Preferences.get({ key: KEY });
    if (!value) return;
    try {
      const saved = JSON.parse(value) as Partial<QadaCounts>;
      this.state.set(Object.fromEntries(QADA_PRAYERS.map((p) => [p, clamp(saved[p])])) as QadaCounts);
    } catch {
      /* Keep zeros for damaged storage. */
    }
  }

  async set(prayer: QadaPrayer, count: number): Promise<void> {
    await this.ready;
    this.state.update((s) => ({ ...s, [prayer]: clamp(count) }));
    await Preferences.set({ key: KEY, value: JSON.stringify(this.state()) });
  }

  /** One prayed (−1) or one more owed (+1). */
  add(prayer: QadaPrayer, delta: number): Promise<void> {
    return this.set(prayer, this.state()[prayer] + delta);
  }

  /** Adds [days] of all five prayers, e.g. for a stretch of days that were missed. */
  async addDays(days: number): Promise<void> {
    await this.ready;
    const n = Math.max(0, Math.floor(days));
    this.state.update((s) => Object.fromEntries(QADA_PRAYERS.map((p) => [p, clamp(s[p] + n)])) as QadaCounts);
    await Preferences.set({ key: KEY, value: JSON.stringify(this.state()) });
  }
}

function clamp(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(QADA_MAX, Math.max(0, v)) : 0;
}
