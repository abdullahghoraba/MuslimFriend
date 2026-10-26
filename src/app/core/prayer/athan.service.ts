import { Injectable, InjectionToken, computed, effect, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { TranslateService } from '@ngx-translate/core';
import { AthanEvent, AthanNative, AthanSound, AthanPluginMethods, AthanStopWay } from '../../native/athan-plugin';
import { PrayerService } from './prayer.service';
import { ATHAN_RECORDINGS, AthanRecording, DEFAULT_RECORDING } from './athan-sounds';
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
  /**
   * Sunrise (the end of Fajr): a notice at sunrise, one some minutes before it, and a reminder of the Duha prayer
   * some minutes after it.
   */
  sunrise: { notify: boolean; preMinutes: number; duha: boolean; duhaMinutes: number };
  volume: number;
  silentDuringPrayer: boolean;
  silentMinutes: number;
  /** Sounds on the device: files the user added, and downloaded recordings (recordingId set). */
  customSounds: { name: string; path: string; recordingId?: string }[];
  /** Stop the playing athan by turning the phone over, shaking it, or pressing a volume button. */
  stopOn: Record<AthanStopWay, boolean>;
  /** Spoken reminder («اقتربت صلاة العصر») some minutes before each prayer that isn't off. Off by default. */
  voiceReminder: { enabled: boolean; minutes: number };
  /** The Madinah athan was made the default once (never again, so a later choice of the user stays). */
  defaultRecordingSet: boolean;
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
        { mode: 'athan', sound: 'athan', preMinutes: 0, iqamaMinutes: 0 },
      ]),
    ) as AthanSettings['perPrayer'],
    sunrise: { notify: false, preMinutes: 0, duha: false, duhaMinutes: 20 },
    volume: 0.8,
    silentDuringPrayer: false,
    silentMinutes: 20,
    customSounds: [],
    stopOn: { flip: true, shake: true, volume: true },
    defaultRecordingSet: false,
    voiceReminder: { enabled: false, minutes: 15 },
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
          minutes: new Intl.NumberFormat(t('locale').startsWith('ar') ? 'ar-EG-u-nu-latn' : 'en').format(
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
          ...(kind === 'voice' ? { speech: t('voiceTitle', params) } : {}),
          ...(kind === 'athan' && settings.silentDuringPrayer && settings.silentMinutes > 0
            ? { silentMinutes: settings.silentMinutes }
            : {}),
        });
      };
      add('athan', 0, s.mode === 'notify' ? 'none' : s.sound);
      if (s.preMinutes > 0) add('pre', -s.preMinutes, 'system');
      if (settings.voiceReminder.enabled && settings.voiceReminder.minutes > 0) add('voice', -settings.voiceReminder.minutes, 'voice');
      if (s.iqamaMinutes > 0) add('iqama', s.iqamaMinutes, 'system');
    }
    const sunrise = (kind: AthanEvent['kind'], minutes: number, name: string, sound: AthanSound) => {
      const count = new Intl.NumberFormat(t('locale').startsWith('ar') ? 'ar-EG-u-nu-latn' : 'en').format(Math.abs(minutes));
      const duration = t(Math.abs(minutes) >= 3 && Math.abs(minutes) <= 10 ? 'minutesFew' : 'minutes', { count });
      const title = t(name + 'Title', { duration, minutes: count });
      events.push({
        id: 'athan-sunrise-' + key + (name === 'sunrise' ? '' : '-' + name),
        prayer: 'sunrise',
        kind,
        at: times.sunrise.getTime() + minutes * 60000,
        title,
        body: t(name + 'Body', { duration, minutes: count }),
        sound,
        volume: settings.volume,
        ...(kind === 'voice' ? { speech: title } : {}),
      });
    };
    if (settings.sunrise.notify) sunrise('athan', 0, 'sunrise', 'none');
    if (settings.sunrise.preMinutes > 0) sunrise('pre', -settings.sunrise.preMinutes, 'sunrisePre', 'system');
    if (settings.voiceReminder.enabled && settings.voiceReminder.minutes > 0)
      sunrise('voice', -settings.voiceReminder.minutes, 'sunriseVoice', 'voice');
    if (settings.sunrise.duha && settings.sunrise.duhaMinutes > 0) sunrise('pre', settings.sunrise.duhaMinutes, 'duha', 'system');
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
          voiceReminder: { ...defaults.voiceReminder, ...saved.voiceReminder },
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
    this.ensureDefaultRecording();
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
  /** Which recording is being downloaded right now (for the UI). */
  readonly downloading = signal<string | null>(null);

  /** The playable sound for a downloaded recording, or null when it isn't on the device yet. */
  recordingSound(id: string): AthanSound | null {
    const s = this.state().customSounds.find((c) => c.recordingId === id);
    return s ? ('file:' + s.path) as AthanSound : null;
  }

  /**
   * Downloads an athan recording once and keeps it on the phone (plays offline afterwards).
   * With [useForAll], or when no prayer has a real athan chosen yet, every prayer switches to it.
   */
  async downloadRecording(id: string, useForAll = false): Promise<AthanSound> {
    await this.load();
    const rec = ATHAN_RECORDINGS.find((r) => r.id === id);
    if (!rec) throw new Error('unknown recording');
    let sound = this.recordingSound(id);
    if (!sound || (rec.fajr && !this.recordingSound(rec.fajr.id))) {
      this.downloading.set(id);
      try {
        // The Fajr file first: the recording only counts as downloaded once both are on the phone.
        if (rec.fajr && !this.recordingSound(rec.fajr.id)) await this.saveRecording(rec.fajr.id, rec.fajr.url, rec.fajr.ext, rec.nameAr);
        sound = this.recordingSound(id) ?? (await this.saveRecording(id, rec.url, rec.ext, rec.nameAr));
      } finally {
        this.downloading.set(null);
      }
    }
    const noRealAthan = ATHAN_PRAYERS.every((p) => !this.state().perPrayer[p].sound.startsWith('file:'));
    if (useForAll || noRealAthan) await this.useForAll(sound);
    return sound;
  }

  private async saveRecording(id: string, url: string, ext: AthanRecording['ext'], name: string): Promise<AthanSound> {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const relative = 'athan/rec-' + id + '.' + ext;
    await Filesystem.writeFile({ path: relative, directory: Directory.Data, data, recursive: true });
    const { uri } = await Filesystem.getUri({ path: relative, directory: Directory.Data });
    const path = uri.startsWith('file://') ? uri.slice(7) : uri;
    if (!Capacitor.isNativePlatform()) this.webSounds.set(path, URL.createObjectURL(blob));
    await this.update({
      customSounds: [...this.state().customSounds.filter((c) => c.recordingId !== id), { name, path, recordingId: id }],
    });
    return ('file:' + path) as AthanSound;
  }

  /** The sound Fajr gets when [sound] is used for all prayers: the same muezzin's Fajr athan when there is one. */
  fajrSoundFor(sound: AthanSound): AthanSound {
    const id = this.state().customSounds.find((c) => 'file:' + c.path === sound)?.recordingId;
    const fajr = ATHAN_RECORDINGS.find((r) => r.id === id)?.fajr;
    return (fajr && this.recordingSound(fajr.id)) || sound;
  }

  /** Same athan sound for all five prayers (Fajr gets the muezzin's Fajr athan when there is one). */
  async useForAll(sound: AthanSound): Promise<void> {
    const perPrayer = { ...this.state().perPrayer };
    for (const p of ATHAN_PRAYERS) perPrayer[p] = { ...perPrayer[p], sound: p === 'fajr' ? this.fajrSoundFor(sound) : sound };
    await this.update({ perPrayer });
  }

  private defaultDownload?: Promise<void>;

  /**
   * Makes the Madinah athan the default once: when the athan is on and every prayer still uses the built-in athan,
   * downloads it in the background and switches to it. Retried on the next schedule when offline.
   */
  private ensureDefaultRecording(): void {
    const s = this.state();
    if (s.defaultRecordingSet || !s.enabled || this.defaultDownload || !Capacitor.isNativePlatform()) return;
    this.defaultDownload = (async () => {
      if (ATHAN_PRAYERS.some((p) => this.state().perPrayer[p].sound !== 'athan')) {
        await this.update({ defaultRecordingSet: true }); // the user already picked a sound
        return;
      }
      const sound = await this.downloadRecording(DEFAULT_RECORDING);
      // The user may have picked another sound while it downloaded.
      if (ATHAN_PRAYERS.every((p) => ['athan', sound, this.fajrSoundFor(sound)].includes(this.state().perPrayer[p].sound)))
        await this.useForAll(sound);
      await this.update({ defaultRecordingSet: true });
    })()
      .catch((e) => console.warn('[athan] default recording', e))
      .finally(() => (this.defaultDownload = undefined));
  }

  async removeSound(path: string): Promise<void> {
    if (!this.state().customSounds.some((s) => s.path === path)) return;
    await this.stopPreview();
    const perPrayer = { ...this.state().perPrayer };
    for (const p of ATHAN_PRAYERS)
      if (perPrayer[p].sound === 'file:' + path) perPrayer[p] = { ...perPrayer[p], sound: 'athan' };
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
  async previewVoice(prayer: AthanPrayer): Promise<void> {
    await this.stopPreview();
    if (!Capacitor.isNativePlatform()) return;
    const speech = this.translate.instant('athan.voiceTitle', { prayer: this.translate.instant('athan.prayers.' + prayer) });
    await this.native.previewAthan({ sound: 'voice', volume: this.state().volume, speech });
  }
  async stopPreview(): Promise<void> {
    clearTimeout(this.previewTimer);
    this.audio?.pause();
    this.audio = undefined;
    if (Capacitor.isNativePlatform()) await this.native.stopAthan();
  }
}
