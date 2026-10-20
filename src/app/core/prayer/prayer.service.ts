import { Injectable, computed, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { TranslateService } from '@ngx-translate/core';
import { AthkarOverlay } from '../../native/athkar-overlay';
import {
  DEFAULT_PRAYER_SETTINGS,
  DEFAULT_REMINDER_SETTINGS,
  PrayerSettings,
  ReminderSettings,
  nextPrayer,
  planReminders,
  prayerTimesFor,
} from './prayer-times';

const PRAYER_KEY = 'prayerSettings';
const REMINDER_KEY = 'reminderSettings';
/** Days of reminders handed to the native scheduler; refreshed on every app start and resume. */
const PLAN_DAYS = 30;

/** Prayer-time settings, today's times and reminder scheduling. Everything is computed on-device. */
@Injectable({ providedIn: 'root' })
export class PrayerService {
  private readonly translate = inject(TranslateService);

  private readonly prayerState = signal<PrayerSettings>(DEFAULT_PRAYER_SETTINGS);
  private readonly reminderState = signal<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  /** Ticks every minute while the app is open so "next prayer" stays current. */
  readonly now = signal(new Date());

  readonly prayer = this.prayerState.asReadonly();
  readonly reminders = this.reminderState.asReadonly();
  readonly today = computed(() => prayerTimesFor(this.prayerState(), this.now()));
  readonly next = computed(() => nextPrayer(this.prayerState(), this.now()));

  private timer?: ReturnType<typeof setInterval>;

  async load(): Promise<void> {
    const [p, r] = await Promise.all([Preferences.get({ key: PRAYER_KEY }), Preferences.get({ key: REMINDER_KEY })]);
    if (p.value) this.prayerState.set(merge(DEFAULT_PRAYER_SETTINGS, p.value));
    if (r.value) this.reminderState.set(merge(DEFAULT_REMINDER_SETTINGS, r.value));
    this.timer ??= setInterval(() => this.now.set(new Date()), 60_000);
  }

  async updatePrayer(patch: Partial<PrayerSettings>): Promise<void> {
    this.prayerState.update((s) => ({ ...s, ...patch }));
    await Preferences.set({ key: PRAYER_KEY, value: JSON.stringify(this.prayerState()) });
    this.now.set(new Date());
    await this.reschedule();
  }

  async updateReminders(patch: Partial<ReminderSettings>): Promise<void> {
    this.reminderState.update((s) => ({ ...s, ...patch }));
    await Preferences.set({ key: REMINDER_KEY, value: JSON.stringify(this.reminderState()) });
    await this.reschedule();
  }

  /** Recomputes the next 30 days of reminders (prayer times shift daily) and hands them to Android. */
  async reschedule(): Promise<number> {
    const t = (k: string) => this.translate.instant(`reminders.notify.${k}`);
    const list = planReminders(this.prayerState(), this.reminderState(), {
      morningTitle: t('morningTitle'), morningBody: t('morningBody'),
      eveningTitle: t('eveningTitle'), eveningBody: t('eveningBody'),
      sleepTitle: t('sleepTitle'), sleepBody: t('sleepBody'),
      kahfTitle: t('kahfTitle'), kahfBody: t('kahfBody'),
      salawatTitle: t('salawatTitle'), salawatBody: t('salawatBody'),
    }, new Date(), PLAN_DAYS);
    if (!list.length) {
      await AthkarOverlay.cancelReminders();
      return 0;
    }
    return (await AthkarOverlay.scheduleReminders({ reminders: list })).scheduled;
  }
}

function merge<T extends object>(defaults: T, json: string): T {
  try {
    const parsed = JSON.parse(json) as Partial<T>;
    const out = { ...defaults } as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) {
      const d = (defaults as Record<string, unknown>)[k];
      out[k] = d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' ? { ...d, ...v } : v;
    }
    return out as T;
  } catch {
    return defaults;
  }
}
