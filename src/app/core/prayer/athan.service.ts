import { Injectable, InjectionToken, computed, effect, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { TranslateService } from '@ngx-translate/core';
import { AthanEvent, AthanNative, AthanSound, AthanPluginMethods, AthanStopWay } from '../../native/athan-plugin';
import { PrayerService } from './prayer.service';
import { PrayerSettings, prayerTimesFor } from './prayer-times';

export const ATHAN_PLUGIN = new InjectionToken<AthanPluginMethods>('ATHAN_PLUGIN', {
  providedIn: 'root',
  factory: () => AthanNative,
});

export const ATHAN_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type AthanPrayer = (typeof ATHAN_PRAYERS)[number];
export interface PrayerAthanSettings {
  mode: 'athan' | 'notify' | 'off';
  sound: AthanSound;
  preMinutes: number;
  iqamaMinutes: number;
}
export interface AthanSettings {
  enabled: boolean;
  perPrayer: Record<AthanPrayer, PrayerAthanSettings>;
  sunrise: { notify: boolean };
  volume: number;
  silentDuringPrayer: boolean;
  silentMinutes: number;
  customSounds: { name: string; path: string }[];
  /** Stop the playing athan by turning the phone over, shaking it, or pressing a volume button. */
  stopOn: Record<AthanStopWay, boolean>;
}
export function stopWays(settings: AthanSettings): AthanStopWay[] {
  return (['flip', 'shake', 'volume'] as const).filter((w) => settings.stopOn[w]);
}
export function defaultAthanSettings(): AthanSettings {
  return {
    enabled: false,
    perPrayer: Object.fromEntries(
      ATHAN_PRAYERS.map((p) => [
        p,
        { mode: 'athan', sound: 'tone', preMinutes: 0, iqamaMinutes: 0 },
      ]),
    ) as AthanSettings['perPrayer'],
    sunrise: { notify: false },
    volume: 0.8,
    silentDuringPrayer: false,
    silentMinutes: 20,
    customSounds: [],
    stopOn: { flip: true, shake: true, volume: true },
  };
}
type Text = (key: string, params?: Record<string, unknown>) => string;
export function buildAthanEvents(
  prayer: PrayerSettings,
  settings: AthanSettings,
  t: Text,
  now = new Date(),
  days = 7,
): AthanEvent[] {
  if (!settings.enabled || !prayer.location) return [];
  const events: AthanEvent[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + i);
    const times = prayerTimesFor(prayer, date)!.times;
    const key =
      String(date.getFullYear()) +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0');
    for (const name of ATHAN_PRAYERS) {
      const s = settings.perPrayer[name];
      if (s.mode === 'off') continue;
      const add = (kind: AthanEvent['kind'], minutes: number, sound: AthanSound) => {
        const at = times[name].getTime() + minutes * 60000;
        const params = {
          prayer: t('prayers.' + name),
          minutes: new Intl.NumberFormat(t('locale').startsWith('ar') ? 'ar-EG' : 'en').format(
            Math.abs(minutes),
          ),
        };
        events.push({
          id: 'athan-' + name + '-' + key + '-' + kind,
          prayer: name,
          kind,
          at,
          sound,
          volume: settings.volume,
          title: t(kind + 'Title', {
            ...params,
            duration: t(
              Math.abs(minutes) >= 3 && Math.abs(minutes) <= 10 ? 'minutesFew' : 'minutes',
              { count: params.minutes },
            ),
          }),
          body: t(kind + 'Body', params),
          ...(sound !== 'none' && stopWays(settings).length ? { stopOn: stopWays(settings) } : {}),
          ...(kind === 'athan' && settings.silentDuringPrayer && settings.silentMinutes > 0
            ? { silentMinutes: settings.silentMinutes }
            : {}),
        });
      };
      add('athan', 0, s.mode === 'notify' ? 'none' : s.sound);
      if (s.preMinutes > 0) add('pre', -s.preMinutes, 'system');
      if (s.iqamaMinutes > 0) add('iqama', s.iqamaMinutes, 'system');
    }
    if (settings.sunrise.notify)
      events.push({
        id: 'athan-sunrise-' + key,
        prayer: 'sunrise',
        kind: 'athan',
        at: times.sunrise.getTime(),
        title: t('sunriseTitle'),
        body: t('sunriseBody'),
        sound: 'none',
        volume: settings.volume,
      });
  }
  return events
    .filter((e) => Number.isFinite(e.at) && e.at > now.getTime())
    .sort((a, b) => a.at - b.at);
}

@Injectable({ providedIn: 'root' })
export class AthanService {
  private readonly native = inject(ATHAN_PLUGIN);
  private readonly prayer = inject(PrayerService);
  private readonly translate = inject(TranslateService);
  private readonly state = signal(defaultAthanSettings());
  readonly settings = this.state.asReadonly();
  readonly upcoming = computed(() => {
    const now = this.prayer.now();
    const out: { name: AthanPrayer; at: Date }[] = [];
    for (let i = 0; i < 3; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      const day = prayerTimesFor(this.prayer.prayer(), date);
      if (day)
        for (const name of ATHAN_PRAYERS)
          if (day.times[name] > now) out.push({ name, at: day.times[name] });
    }
    return out.slice(0, 5);
  });
  private loaded?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private audio?: HTMLAudioElement;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private readonly webSounds = new Map<string, string>();
  constructor() {
    effect(() => {
      this.prayer.prayer();
      void this.reschedule().catch((e) => console.warn('[athan]', e));
    });
  }
  load(): Promise<void> {
    return (this.loaded ??= (async () => {
      const { value } = await Preferences.get({ key: 'athanSettings' });
      if (!value) return;
      try {
        const saved = JSON.parse(value);
        const defaults = defaultAthanSettings();
        this.state.set({
          ...defaults,
          ...saved,
          sunrise: { ...defaults.sunrise, ...saved.sunrise },
          stopOn: { ...defaults.stopOn, ...saved.stopOn },
          perPrayer: Object.fromEntries(
            ATHAN_PRAYERS.map((p) => [p, { ...defaults.perPrayer[p], ...saved.perPrayer?.[p] }]),
          ) as AthanSettings['perPrayer'],
        });
      } catch {
        /* Keep defaults for damaged storage. */
      }
    })());
  }
  async update(patch: Partial<AthanSettings>): Promise<void> {
    await this.load();
    this.state.update((s) => ({ ...s, ...patch }));
    const value = JSON.stringify(this.state());
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await Preferences.set({ key: 'athanSettings', value });
        await this.schedule();
      });
    this.queue = task;
    await task;
  }
  async reschedule(): Promise<void> {
    await this.load();
    const task = this.queue.catch(() => {}).then(() => this.schedule());
    this.queue = task;
    await task;
  }
  private async schedule(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    const t: Text = (k, params) => this.translate.instant('athan.' + k, params);
    const now = new Date();
    const prayers: { name: string; at: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      const day = prayerTimesFor(this.prayer.prayer(), date);
      if (day)
        for (const p of ATHAN_PRAYERS)
          prayers.push({ name: t('prayers.' + p), at: day.times[p].getTime() });
    }
    await this.native.setWidgetData({ prayers, nextLabel: t('nextPrayer'), appName: t('appName') });
    const events = buildAthanEvents(this.prayer.prayer(), this.state(), t, now);
    if (!events.length) await this.native.cancelAthan();
    else await this.native.scheduleAthan({ events });
  }
  async importSound(file: File): Promise<AthanSound> {
    const name = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const relative = 'athan/' + name;
    await Filesystem.writeFile({
      path: relative,
      directory: Directory.Data,
      data,
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({ path: relative, directory: Directory.Data });
    const path = uri.startsWith('file://') ? uri.slice(7) : uri;
    if (!Capacitor.isNativePlatform()) this.webSounds.set(path, URL.createObjectURL(file));
    await this.update({ customSounds: [...this.state().customSounds, { name: file.name, path }] });
    return ('file:' + path) as AthanSound;
  }
  async removeSound(path: string): Promise<void> {
    if (!this.state().customSounds.some((s) => s.path === path)) return;
    await this.stopPreview();
    const perPrayer = { ...this.state().perPrayer };
    for (const p of ATHAN_PRAYERS)
      if (perPrayer[p].sound === 'file:' + path) perPrayer[p] = { ...perPrayer[p], sound: 'tone' };
    await this.update({
      perPrayer,
      customSounds: this.state().customSounds.filter((s) => s.path !== path),
    });
    await Filesystem.deleteFile({
      path: 'athan/' + path.split('/').pop(),
      directory: Directory.Data,
    });
    const url = this.webSounds.get(path);
    if (url) URL.revokeObjectURL(url);
    this.webSounds.delete(path);
  }
  async preview(sound: AthanSound): Promise<void> {
    await this.stopPreview();
    if (Capacitor.isNativePlatform()) {
      await this.native.previewAthan({ sound, volume: this.state().volume, stopOn: stopWays(this.state()) });
      return;
    }
    if (!sound.startsWith('file:')) return;
    const path = sound.slice(5);
    let url = this.webSounds.get(path);
    if (!url) {
      const result = await Filesystem.readFile({
        path: 'athan/' + path.split('/').pop(),
        directory: Directory.Data,
      });
      url =
        typeof result.data === 'string'
          ? 'data:audio/*;base64,' + result.data
          : URL.createObjectURL(result.data);
      this.webSounds.set(path, url);
    }
    this.audio = new Audio(url);
    this.audio.volume = this.state().volume;
    await this.audio.play();
    this.previewTimer = setTimeout(() => void this.stopPreview(), 30000);
  }
  async stopPreview(): Promise<void> {
    clearTimeout(this.previewTimer);
    this.audio?.pause();
    this.audio = undefined;
    if (Capacitor.isNativePlatform()) await this.native.stopAthan();
  }
}
