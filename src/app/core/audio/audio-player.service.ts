import { Injectable, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { AudioCatalogService, FullReciter, Moshaf, Radio } from './audio-catalog.service';
import { AudioFocusService } from './audio-focus.service';
import { QuranService } from '../quran/quran.service';

export type NowPlaying =
  | { kind: 'sura'; reciter: FullReciter; moshaf: Moshaf; sura: number }
  | { kind: 'radio'; radio: Radio };

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
  readonly canDownload = Capacitor.isNativePlatform();
  private loaded = false;

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
    void Preferences.set({ key: LAST_KEY, value: JSON.stringify({ reciter: reciter.id, moshaf: moshaf.id, sura }) });
    await this.start(await this.suraSource(moshaf, sura));
  }

  async playRadio(radio: Radio): Promise<void> {
    this.now.set({ kind: 'radio', radio });
    await this.start(radio.url);
  }

  toggle(): void {
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
    this.token++;
    this.release();
    this.now.set(null);
    this.playing.set(false);
    this.loading.set(false);
    this.position.set(0);
    this.duration.set(0);
    this.setSleep(0);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  }

  /** Next (+1) or previous (-1) sura of the same recording. */
  step(delta: 1 | -1): void {
    const now = this.now();
    if (now?.kind !== 'sura') return;
    const list = this.catalog.suras(now.moshaf);
    const i = list.indexOf(now.sura) + delta;
    if (i >= 0 && i < list.length) void this.playSura(now.reciter, now.moshaf, list[i]);
  }

  hasStep(delta: 1 | -1): boolean {
    const now = this.now();
    if (now?.kind !== 'sura') return false;
    const list = this.catalog.suras(now.moshaf);
    const i = list.indexOf(now.sura) + delta;
    return i >= 0 && i < list.length;
  }

  seek(seconds: number): void {
    if (this.audio && Number.isFinite(seconds)) this.audio.currentTime = seconds;
  }

  /** Stops playback after [minutes] (0 cancels). */
  setSleep(minutes: number): void {
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
    if (!this.canDownload || this.download()) return false;
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
      await this.refreshDownloaded(m);
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

