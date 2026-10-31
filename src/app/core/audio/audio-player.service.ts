import { Injectable, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { AudioCatalogService, FullReciter, Moshaf, Radio } from './audio-catalog.service';
import { AudioFocusService } from './audio-focus.service';
import { QuranService } from '../quran/quran.service';
import { NativeAudio, QuranAudioItem, QuranAudioState } from '../../native/quran-audio';

export type NowPlaying =
  | { kind: 'sura'; reciter: FullReciter; moshaf: Moshaf; sura: number }
  | { kind: 'radio'; radio: Radio };

/** How a whole-recording download ended: null when every sura was tried. */
export interface DownloadAllResult {
  downloaded: number;
  failed: number;
  stopped: 'cancelled' | 'failing' | 'busy' | null;
}

interface Favorites {
  reciters: number[];
  radios: number[];
}

const FAV_KEY = 'listenFavorites';
const LAST_KEY = 'listenLast';
const suraFile = (sura: number) => `${String(sura).padStart(3, '0')}.mp3`;
const folder = (m: Moshaf) => `listen/${m.id}`;

/**
 * Plays whole suras by any reciter of the catalogue (next sura follows on its own) and live Quran radios.
 * Streams over https only when the user presses play; suras the user downloaded play offline.
 * On Android the native player plays the whole recording as a queue, so it goes on with the screen off.
 */
@Injectable({ providedIn: 'root' })
export class AudioPlayerService {
  private readonly catalog = inject(AudioCatalogService);
  private readonly focus = inject(AudioFocusService);
  private readonly quran = inject(QuranService);
  private audio?: HTMLAudioElement;
  private token = 0;
  private sleepTimer?: ReturnType<typeof setTimeout>;

  readonly now = signal<NowPlaying | null>(null);
  readonly playing = signal(false);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly position = signal(0);
  readonly duration = signal(0);
  readonly repeatSura = signal(false);
  /** When the sleep timer stops playback (epoch ms), or null. */
  readonly sleepAt = signal<number | null>(null);
  readonly favorites = signal<Favorites>({ reciters: [], radios: [] });
  /** Sura download in progress: moshaf id, sura, fraction done. */
  readonly download = signal<{ moshaf: number; sura: number; progress: number } | null>(null);
  /** Downloaded suras by moshaf id. */
  readonly downloaded = signal<Record<number, number[]>>({});
  /** Whole-recording download in progress: moshaf id, suras done of total, failures so far. */
  readonly queue = signal<{ moshaf: number; done: number; total: number; failed: number } | null>(null);
  private stopQueue = false;
  readonly canDownload = Capacitor.isNativePlatform();
  private loaded = false;
  private readonly native = inject(NativeAudio).enabled;
  private readonly nativePlayer = inject(NativeAudio).player;
  /** The item just asked for: older native states still on their way are ignored until it plays. */
  private pendingGroup?: string;

  constructor() {
    if (this.native) void this.nativePlayer.addListener('state', (s) => this.onNative(s));
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const { value } = await Preferences.get({ key: FAV_KEY });
      if (value) this.favorites.set({ reciters: [], radios: [], ...JSON.parse(value) });
    } catch {
      /* none yet */
    }
  }

  /** The last reciter and recording the user listened to, to open the list where they left it. */
  async last(): Promise<{ reciter: number; moshaf: number; sura: number } | null> {
    const { value } = await Preferences.get({ key: LAST_KEY });
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  async playSura(reciter: FullReciter, moshaf: Moshaf, sura: number): Promise<void> {
    this.now.set({ kind: 'sura', reciter, moshaf, sura });
    this.saveLast(reciter, moshaf, sura);
    if (this.native) {
      const items = await this.suraItems(reciter, moshaf);
      await this.startNative(items, Math.max(0, items.findIndex((i) => i.group === String(sura))), false);
    } else {
      await this.start(await this.suraSource(moshaf, sura));
    }
  }

  async playRadio(radio: Radio): Promise<void> {
    this.now.set({ kind: 'radio', radio });
    if (this.native) {
      const item = { url: radio.url, title: this.catalog.radioName(radio), album: 'رفيق المسلم', group: 'radio:' + radio.id };
      await this.startNative([item], 0, true);
    } else {
      await this.start(radio.url);
    }
  }

  toggle(): void {
    if (this.native) {
      if (!this.now()) return;
      if (!this.playing()) this.focus.claim('listen', () => this.stop());
      void this.nativePlayer.toggle();
      return;
    }
    const audio = this.audio;
    if (!audio) return;
    if (audio.paused) {
      // A live stream resumes at the live point, not where it was paused.
      if (this.now()?.kind === 'radio') {
        void this.restart();
        return;
      }
      this.focus.claim('listen', () => this.stop());
      void audio.play().catch(() => this.fail());
    } else {
      audio.pause();
    }
  }

  stop(): void {
    if (this.native) {
      if (this.now()) void this.nativePlayer.stop();
      this.reset();
      return;
    }
    this.token++;
    this.release();
    this.reset();
    this.setSleep(0);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  }

  private reset(): void {
    this.pendingGroup = undefined;
    this.now.set(null);
    this.playing.set(false);
    this.loading.set(false);
    this.position.set(0);
    this.duration.set(0);
    this.sleepAt.set(null);
  }

  /** Next (+1) or previous (-1) sura of the same recording. */
  step(delta: 1 | -1): void {
    const now = this.now();
    if (now?.kind !== 'sura') return;
    const list = this.catalog.suras(now.moshaf);
    const i = list.indexOf(now.sura) + delta;
    if (i < 0 || i >= list.length) return;
    if (this.native) {
      // The queue already holds the whole recording.
      this.now.set({ ...now, sura: list[i] });
      this.pendingGroup = String(list[i]);
      this.saveLast(now.reciter, now.moshaf, list[i]);
      void (delta > 0 ? this.nativePlayer.next() : this.nativePlayer.previous());
    } else {
      void this.playSura(now.reciter, now.moshaf, list[i]);
    }
  }

  hasStep(delta: 1 | -1): boolean {
    const now = this.now();
    if (now?.kind !== 'sura') return false;
    const list = this.catalog.suras(now.moshaf);
    const i = list.indexOf(now.sura) + delta;
    return i >= 0 && i < list.length;
  }

  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    if (this.native) void this.nativePlayer.seek({ position: seconds });
    else if (this.audio) this.audio.currentTime = seconds;
  }

  setRepeatSura(on: boolean): void {
    this.repeatSura.set(on);
    if (this.native && this.now()?.kind === 'sura') void this.nativePlayer.setRepeat({ repeat: on ? 'one' : 'off' });
  }

  /** Stops playback after [minutes] (0 cancels). */
  setSleep(minutes: number): void {
    if (this.native) {
      // Natively, so it stops on time even with the screen off.
      this.sleepAt.set(minutes > 0 ? Date.now() + minutes * 60_000 : null);
      void this.nativePlayer.setSleep({ minutes });
      return;
    }
    clearTimeout(this.sleepTimer);
    this.sleepTimer = undefined;
    this.sleepAt.set(minutes > 0 ? Date.now() + minutes * 60_000 : null);
    if (minutes > 0) this.sleepTimer = setTimeout(() => this.stop(), minutes * 60_000);
  }

  isFavorite(kind: 'reciters' | 'radios', id: number): boolean {
    return this.favorites()[kind].includes(id);
  }

  async toggleFavorite(kind: 'reciters' | 'radios', id: number): Promise<void> {
    const fav = this.favorites();
    const list = fav[kind].includes(id) ? fav[kind].filter((x) => x !== id) : [...fav[kind], id];
    this.favorites.set({ ...fav, [kind]: list });
    await Preferences.set({ key: FAV_KEY, value: JSON.stringify(this.favorites()) });
  }

  // ---- Downloads (native only) ------------------------------------------------------------------

  async refreshDownloaded(m: Moshaf): Promise<void> {
    if (!this.canDownload) return;
    let suras: number[] = [];
    try {
      const { files } = await Filesystem.readdir({ path: folder(m), directory: Directory.Data });
      suras = files.map((f) => f.name).filter((n) => /^\d{3}\.mp3$/.test(n)).map((n) => Number(n.slice(0, 3)));
    } catch {
      /* nothing downloaded */
    }
    this.downloaded.update((d) => ({ ...d, [m.id]: suras }));
  }

  isDownloaded(m: Moshaf, sura: number): boolean {
    return this.downloaded()[m.id]?.includes(sura) ?? false;
  }

  async downloadSura(m: Moshaf, sura: number): Promise<boolean> {
    if (!this.canDownload || this.download() || this.queue()) return false;
    return this.fetchSura(m, sura);
  }

  /** The suras of [m] not on the phone yet, and their total size in bytes (0 when the server would not say). */
  async missing(m: Moshaf): Promise<{ suras: number[]; bytes: number }> {
    await this.refreshDownloaded(m);
    const suras = this.catalog.suras(m).filter((s) => !this.isDownloaded(m, s));
    const sizes: number[] = [];
    // Only the headers: a few requests at a time.
    for (let i = 0; i < suras.length; i += 8) {
      sizes.push(...(await Promise.all(suras.slice(i, i + 8).map((s) =>
        fetch(m.server + suraFile(s), { method: 'HEAD' }).then((r) => Number(r.headers.get('content-length')) || 0, () => 0)))));
    }
    return { suras, bytes: sizes.reduce((a, b) => a + b, 0) };
  }

  /**
   * Downloads every sura of [m] not on the phone yet, one after another, each retried once. Stops after the
   * current sura when cancelled, or after 3 failures in a row (offline, or the phone is full).
   */
  async downloadAll(m: Moshaf, suras?: number[]): Promise<DownloadAllResult> {
    if (!this.canDownload || this.download() || this.queue()) return { downloaded: 0, failed: 0, stopped: 'busy' };
    const todo = suras ?? (await this.missing(m)).suras;
    this.stopQueue = false;
    let downloaded = 0, failed = 0, inARow = 0;
    this.queue.set({ moshaf: m.id, done: 0, total: todo.length, failed: 0 });
    try {
      for (const [i, sura] of todo.entries()) {
        if (this.stopQueue) return { downloaded, failed, stopped: 'cancelled' };
        const ok = (await this.fetchSura(m, sura)) || (!this.stopQueue && (await this.fetchSura(m, sura)));
        if (ok) {
          downloaded++;
          inARow = 0;
        } else {
          failed++;
          if (++inARow >= 3) return { downloaded, failed, stopped: 'failing' };
        }
        this.queue.set({ moshaf: m.id, done: i + 1, total: todo.length, failed });
      }
      return { downloaded, failed, stopped: null };
    } finally {
      this.queue.set(null);
      await this.refreshDownloaded(m);
    }
  }

  /** Stops the whole-recording download once the sura being saved is done. */
  cancelDownloadAll(): void {
    this.stopQueue = true;
  }

  /** Removes every downloaded sura of [m]. */
  async deleteAll(m: Moshaf): Promise<void> {
    await Filesystem.rmdir({ path: folder(m), directory: Directory.Data, recursive: true }).catch(() => {});
    await this.refreshDownloaded(m);
  }

  private async fetchSura(m: Moshaf, sura: number): Promise<boolean> {
    this.download.set({ moshaf: m.id, sura, progress: 0 });
    const url = m.server + suraFile(sura);
    const partial = `${folder(m)}/${suraFile(sura)}.part`;
    const listener = await Filesystem.addListener('progress', (p) => {
      if (p.url === url && p.contentLength > 0) this.download.set({ moshaf: m.id, sura, progress: p.bytes / p.contentLength });
    });
    try {
      await Filesystem.downloadFile({ url, path: partial, directory: Directory.Data, recursive: true, progress: true });
      // Renamed only once complete, so a cut-off download is never played as a whole sura.
      await Filesystem.rename({ from: partial, to: `${folder(m)}/${suraFile(sura)}`, directory: Directory.Data });
      this.downloaded.update((d) => ({ ...d, [m.id]: [...new Set([...(d[m.id] ?? []), sura])] }));
      return true;
    } catch {
      await Filesystem.deleteFile({ path: partial, directory: Directory.Data }).catch(() => {});
      return false;
    } finally {
      await listener.remove();
      this.download.set(null);
    }
  }

  async deleteSura(m: Moshaf, sura: number): Promise<void> {
    await Filesystem.deleteFile({ path: `${folder(m)}/${suraFile(sura)}`, directory: Directory.Data }).catch(() => {});
    await this.refreshDownloaded(m);
  }

  // ---- Playback --------------------------------------------------------------------------------

  private saveLast(reciter: FullReciter, moshaf: Moshaf, sura: number): void {
    void Preferences.set({ key: LAST_KEY, value: JSON.stringify({ reciter: reciter.id, moshaf: moshaf.id, sura }) });
  }

  /** Every sura of the recording, downloaded ones from the phone. */
  private async suraItems(reciter: FullReciter, m: Moshaf): Promise<QuranAudioItem[]> {
    await this.refreshDownloaded(m);
    await this.quran.load().catch(() => {});
    const saved = new Set(this.downloaded()[m.id] ?? []);
    const dir = saved.size ? (await Filesystem.getUri({ path: folder(m), directory: Directory.Data })).uri : '';
    const artist = this.catalog.reciterName(reciter);
    const album = this.catalog.moshafName(m);
    return this.catalog.suras(m).map((sura) => ({
      url: saved.has(sura) ? `${dir}/${suraFile(sura)}` : m.server + suraFile(sura),
      title: this.quran.ready() ? this.quran.sura(sura).name : String(sura),
      artist,
      album,
      group: String(sura),
    }));
  }

  private async startNative(items: QuranAudioItem[], index: number, live: boolean): Promise<void> {
    this.focus.claim('listen', () => this.stop());
    this.error.set(false);
    this.loading.set(true);
    this.playing.set(false);
    this.position.set(0);
    this.duration.set(0);
    this.pendingGroup = items[index].group;
    try {
      await this.nativePlayer.play({ session: 'listen', items, index, repeat: !live && this.repeatSura() ? 'one' : 'off', speed: 1, live });
    } catch {
      this.fail();
    }
  }

  /** The native player's state: it moves on to the next sura by itself, stops from the notification or the sleep timer. */
  private onNative(s: QuranAudioState): void {
    const now = this.now();
    if (!now || s.session === 'mushaf') return;
    if (s.index < 0) {
      this.reset();
      return;
    }
    if (this.pendingGroup !== undefined) {
      if (s.group !== this.pendingGroup) return;
      this.pendingGroup = undefined;
    }
    if (s.ended) {
      this.stop();
      return;
    }
    this.playing.set(s.playing);
    this.loading.set(s.buffering);
    this.error.set(s.error);
    this.position.set(s.position);
    this.duration.set(s.duration);
    this.sleepAt.set(s.sleepAt || null);
    const sura = Number(s.group);
    if (now.kind === 'sura' && sura && sura !== now.sura) {
      this.now.set({ ...now, sura });
      this.saveLast(now.reciter, now.moshaf, sura);
    }
  }

  private async suraSource(m: Moshaf, sura: number): Promise<string> {
    if (this.canDownload) {
      try {
        const path = `${folder(m)}/${suraFile(sura)}`;
        await Filesystem.stat({ path, directory: Directory.Data });
        const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
        return Capacitor.convertFileSrc(uri);
      } catch {
        /* not downloaded: stream */
      }
    }
    return m.server + suraFile(sura);
  }

  private restart(): Promise<void> {
    const now = this.now();
    if (now?.kind === 'radio') return this.playRadio(now.radio);
    if (now?.kind === 'sura') return this.playSura(now.reciter, now.moshaf, now.sura);
    return Promise.resolve();
  }

  private async start(src: string, attempt = 0): Promise<void> {
    const token = ++this.token;
    this.focus.claim('listen', () => this.stop());
    this.release();
    this.error.set(false);
    this.loading.set(true);
    this.position.set(0);
    this.duration.set(0);
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = src;
    const live = () => token === this.token;
    audio.onplaying = () => live() && (this.loading.set(false), this.playing.set(true));
    audio.onpause = () => live() && this.playing.set(false);
    audio.onwaiting = () => live() && this.loading.set(true);
    audio.oncanplay = () => live() && this.loading.set(false);
    audio.ondurationchange = () => live() && this.duration.set(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.ontimeupdate = () => live() && this.position.set(audio.currentTime);
    audio.onerror = () => live() && this.retry(src, attempt);
    audio.onended = () => live() && this.ended();
    this.audio = audio;
    this.setMediaSession();
    try {
      await audio.play();
    } catch {
      if (live()) this.retry(src, attempt);
    }
  }

  /** A stream that would not load or dropped: try twice more before showing the error. */
  private retry(src: string, attempt: number): void {
    if (attempt >= 2) {
      this.fail();
      return;
    }
    const token = this.token;
    const resume = this.audio && Number.isFinite(this.audio.duration) ? this.audio.currentTime : 0;
    this.release();
    this.loading.set(true);
    setTimeout(() => {
      if (token !== this.token) return;
      void this.start(src, attempt + 1).then(() => resume && this.seek(resume));
    }, 1500);
  }

  private ended(): void {
    const now = this.now();
    if (now?.kind !== 'sura') {
      // A radio stream that closed: reconnect.
      void this.restart();
      return;
    }
    if (this.repeatSura()) void this.playSura(now.reciter, now.moshaf, now.sura);
    else if (this.hasStep(1)) this.step(1);
    else this.stop();
  }

  private fail(): void {
    this.loading.set(false);
    this.playing.set(false);
    this.error.set(true);
  }

  private release(): void {
    const audio = this.audio;
    if (!audio) return;
    audio.onplaying = audio.onpause = audio.onwaiting = audio.oncanplay = audio.ondurationchange = null;
    audio.ontimeupdate = audio.onerror = audio.onended = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    this.audio = undefined;
  }

  private setMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const now = this.now();
    if (!now) return;
    const ms = navigator.mediaSession;
    ms.metadata =
      now.kind === 'radio'
        ? new MediaMetadata({ title: this.catalog.radioName(now.radio), album: 'رفيق المسلم' })
        : new MediaMetadata({ title: this.quran.ready() ? this.quran.sura(now.sura).name : String(now.sura), artist: this.catalog.reciterName(now.reciter), album: this.catalog.moshafName(now.moshaf) });
    ms.setActionHandler('play', () => this.toggle());
    ms.setActionHandler('pause', () => this.toggle());
    ms.setActionHandler('stop', () => this.stop());
    const sura = now.kind === 'sura';
    ms.setActionHandler('nexttrack', sura ? () => this.step(1) : null);
    ms.setActionHandler('previoustrack', sura ? () => this.step(-1) : null);
    ms.setActionHandler('seekto', sura ? (d) => this.seek(d.seekTime ?? 0) : null);
  }
}

