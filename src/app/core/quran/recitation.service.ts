import { Injectable, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { AyahRef } from './quran-utils';
import { QuranService } from './quran.service';

export interface Reciter {
  /** EveryAyah folder name. */
  id: string;
  nameAr: string;
  nameEn: string;
}

/** A curated set of well-known Hafs reciters on EveryAyah (verse-by-verse MP3s). */
export const RECITERS: Reciter[] = [
  { id: 'Muhsin_Al_Qasim_192kbps', nameAr: 'عبد المحسن القاسم', nameEn: 'Abdulmohsen Al-Qasim' },
  { id: 'Abdul_Basit_Murattal_192kbps', nameAr: 'عبد الباسط عبد الصمد (مرتل)', nameEn: 'Abdul Basit (Murattal)' },
  { id: 'Abdul_Basit_Mujawwad_128kbps', nameAr: 'عبد الباسط عبد الصمد (مجود)', nameEn: 'Abdul Basit (Mujawwad)' },
  { id: 'Husary_128kbps', nameAr: 'محمود خليل الحصري', nameEn: 'Mahmoud Khalil Al-Husary' },
  { id: 'Husary_Muallim_128kbps', nameAr: 'الحصري (المعلم)', nameEn: 'Al-Husary (Teacher)' },
  { id: 'Minshawy_Murattal_128kbps', nameAr: 'محمد صديق المنشاوي (مرتل)', nameEn: 'Al-Minshawi (Murattal)' },
  { id: 'Minshawy_Mujawwad_192kbps', nameAr: 'محمد صديق المنشاوي (مجود)', nameEn: 'Al-Minshawi (Mujawwad)' },
  { id: 'Mohammad_al_Tablaway_128kbps', nameAr: 'محمد محمود الطبلاوي', nameEn: 'Mohammad Al-Tablawi' },
  { id: 'Mustafa_Ismail_48kbps', nameAr: 'مصطفى إسماعيل', nameEn: 'Mustafa Ismail' },
  { id: 'Mahmoud_Ali_Al_Banna_32kbps', nameAr: 'محمود علي البنا', nameEn: 'Mahmoud Ali Al-Banna' },
  { id: 'Muhammad_Jibreel_128kbps', nameAr: 'محمد جبريل', nameEn: 'Muhammad Jibreel' },
  { id: 'Saood_ash-Shuraym_128kbps', nameAr: 'سعود الشريم', nameEn: 'Saud Ash-Shuraim' },
  { id: 'MaherAlMuaiqly128kbps', nameAr: 'ماهر المعيقلي', nameEn: 'Maher Al-Muaiqly' },
  { id: 'Yasser_Ad-Dussary_128kbps', nameAr: 'ياسر الدوسري', nameEn: 'Yasser Ad-Dossary' },
  { id: 'Abu_Bakr_Ash-Shaatree_128kbps', nameAr: 'أبو بكر الشاطري', nameEn: 'Abu Bakr Ash-Shatri' },
  { id: 'Ghamadi_40kbps', nameAr: 'سعد الغامدي', nameEn: 'Saad Al-Ghamdi' },
];

const AUDIO_BASE = 'https://everyayah.com/data';
const PREFS_KEY = 'recitation';

export type RepeatMode = 1 | 2 | 3 | 5 | 10 | 0; // 0 = endless

interface RecitationPrefs {
  reciterId: string;
  repeatEach: RepeatMode;
  speed: number;
}

const fileName = (ref: AyahRef) => `${String(ref.sura).padStart(3, '0')}${String(ref.aya).padStart(3, '0')}.mp3`;

/**
 * Verse-by-verse recitation. Audio streams from EveryAyah or plays from a sura the user downloaded
 * (stored in the app's private data folder, available offline). This is the only feature that uses
 * the network, and only when the user plays or downloads; nothing about the user is sent.
 */
@Injectable({ providedIn: 'root' })
export class RecitationService {
  private readonly quran = inject(QuranService);
  private audio?: HTMLAudioElement;
  private prefsLoaded = false;
  private repeatsLeft = 0;
  /** Inclusive end of the current play range (global ayah index). */
  private rangeEnd = 0;
  private rangeStart = 0;
  /** Repeat the whole range when it ends (memorisation). */
  readonly loopRange = signal(false);

  readonly prefs = signal<RecitationPrefs>({ reciterId: RECITERS[0].id, repeatEach: 1, speed: 1 });
  readonly reciter = computed(() => RECITERS.find((r) => r.id === this.prefs().reciterId) ?? RECITERS[0]);
  readonly current = signal<AyahRef | null>(null);
  readonly playing = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Sura download progress: { sura, done, total } while downloading. */
  readonly download = signal<{ reciterId: string; sura: number; done: number; total: number } | null>(null);
  private cancelDownload = false;

  async loadPrefs(): Promise<void> {
    if (this.prefsLoaded) return;
    const { value } = await Preferences.get({ key: PREFS_KEY });
    if (value) {
      try {
        this.prefs.set({ ...this.prefs(), ...JSON.parse(value) });
      } catch {
        /* defaults */
      }
    }
    // A reciter removed from the list falls back to the default one.
    if (!RECITERS.some((r) => r.id === this.prefs().reciterId)) this.prefs.update((p) => ({ ...p, reciterId: RECITERS[0].id }));
    this.prefsLoaded = true;
  }

  async setPrefs(patch: Partial<RecitationPrefs>): Promise<void> {
    this.prefs.update((p) => ({ ...p, ...patch }));
    await Preferences.set({ key: PREFS_KEY, value: JSON.stringify(this.prefs()) });
    if (this.audio && patch.speed) this.audio.playbackRate = patch.speed;
  }

  /** Plays from [from] to [to] (inclusive refs; default: end of the sura). */
  async play(from: AyahRef, to?: AyahRef): Promise<void> {
    await this.loadPrefs();
    await this.quran.load();
    const start = this.quran.ayah(from).index;
    const sura = this.quran.sura(from.sura);
    this.rangeStart = start;
    this.rangeEnd = to ? this.quran.ayah(to).index : sura.start + sura.ayas - 1;
    await this.playIndex(start);
  }

  toggle(): void {
    if (!this.audio || !this.current()) return;
    if (this.audio.paused) {
      void this.audio.play();
      this.playing.set(true);
    } else {
      this.audio.pause();
      this.playing.set(false);
    }
  }

  stop(): void {
    this.audio?.pause();
    this.audio = undefined;
    this.current.set(null);
    this.playing.set(false);
    this.loading.set(false);
  }

  next(): void {
    const cur = this.current();
    if (!cur) return;
    const i = this.quran.ayah(cur).index;
    if (i < 6235) {
      this.rangeEnd = Math.max(this.rangeEnd, i + 1);
      void this.playIndex(i + 1);
    }
  }

  previous(): void {
    const cur = this.current();
    if (!cur) return;
    const i = this.quran.ayah(cur).index;
    if (i > 0) {
      this.rangeStart = Math.min(this.rangeStart, i - 1);
      void this.playIndex(i - 1);
    }
  }

  private async playIndex(index: number): Promise<void> {
    const ref = this.quran.ayahAt(index);
    this.current.set({ sura: ref.sura, aya: ref.aya });
    this.repeatsLeft = this.prefs().repeatEach === 0 ? Infinity : this.prefs().repeatEach - 1;
    this.error.set(null);
    this.loading.set(true);
    const src = await this.sourceFor(ref);
    this.audio?.pause();
    const audio = new Audio(src);
    audio.playbackRate = this.prefs().speed;
    audio.onended = () => this.onEnded(index);
    audio.onerror = () => {
      this.loading.set(false);
      this.playing.set(false);
      this.error.set('network');
    };
    audio.oncanplay = () => this.loading.set(false);
    this.audio = audio;
    this.setMediaSession(ref);
    try {
      await audio.play();
      this.playing.set(true);
    } catch {
      this.playing.set(false);
      this.loading.set(false);
      this.error.set('network');
    }
    // Warm the next file so playback is gapless when streaming.
    if (index + 1 <= this.rangeEnd) void this.sourceFor(this.quran.ayahAt(index + 1)).then((s) => fetchHead(s));
  }

  private onEnded(index: number): void {
    if (this.repeatsLeft > 0) {
      this.repeatsLeft--;
      if (this.audio) {
        this.audio.currentTime = 0;
        void this.audio.play();
      }
      return;
    }
    if (index < this.rangeEnd) {
      void this.playIndex(index + 1);
    } else if (this.loopRange()) {
      void this.playIndex(this.rangeStart);
    } else {
      this.playing.set(false);
      this.current.set(null);
    }
  }

  private async sourceFor(ref: AyahRef): Promise<string> {
    const reciterId = this.prefs().reciterId;
    if (Capacitor.isNativePlatform()) {
      try {
        const { uri } = await Filesystem.getUri({ path: `audio/${reciterId}/${fileName(ref)}`, directory: Directory.Data });
        await Filesystem.stat({ path: `audio/${reciterId}/${fileName(ref)}`, directory: Directory.Data });
        return Capacitor.convertFileSrc(uri);
      } catch {
        /* not downloaded: stream */
      }
    }
    return `${AUDIO_BASE}/${reciterId}/${fileName(ref)}`;
  }

  /** Number of downloaded ayat of [sura] for the current reciter. */
  async downloadedCount(sura: number): Promise<number> {
    if (!Capacitor.isNativePlatform()) return 0;
    try {
      const prefix = String(sura).padStart(3, '0');
      const { files } = await Filesystem.readdir({ path: `audio/${this.prefs().reciterId}`, directory: Directory.Data });
      return files.filter((f) => f.name.startsWith(prefix)).length;
    } catch {
      return 0;
    }
  }

  /** Downloads a whole sura for offline listening (current reciter). */
  async downloadSura(sura: number): Promise<boolean> {
    await this.loadPrefs();
    await this.quran.load();
    const reciterId = this.prefs().reciterId;
    const total = this.quran.sura(sura).ayas;
    this.cancelDownload = false;
    this.download.set({ reciterId, sura, done: 0, total });
    try {
      for (let aya = 1; aya <= total; aya++) {
        if (this.cancelDownload) return false;
        const path = `audio/${reciterId}/${fileName({ sura, aya })}`;
        const exists = await Filesystem.stat({ path, directory: Directory.Data }).then(() => true, () => false);
        if (!exists) {
          const res = await fetch(`${AUDIO_BASE}/${reciterId}/${fileName({ sura, aya })}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await blobToBase64(await res.blob());
          await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
        }
        this.download.set({ reciterId, sura, done: aya, total });
      }
      return true;
    } catch {
      this.error.set('download');
      return false;
    } finally {
      this.download.set(null);
    }
  }

  cancelSuraDownload(): void {
    this.cancelDownload = true;
  }

  async deleteSura(sura: number): Promise<void> {
    const prefix = String(sura).padStart(3, '0');
    const dir = `audio/${this.prefs().reciterId}`;
    try {
      const { files } = await Filesystem.readdir({ path: dir, directory: Directory.Data });
      for (const f of files.filter((x) => x.name.startsWith(prefix))) {
        await Filesystem.deleteFile({ path: `${dir}/${f.name}`, directory: Directory.Data });
      }
    } catch {
      /* nothing downloaded */
    }
  }

  private setMediaSession(ref: AyahRef): void {
    if (!('mediaSession' in navigator)) return;
    const sura = this.quran.sura(ref.sura);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${sura.name} ${ref.aya}`,
      artist: this.reciter().nameAr,
      album: 'رفيق المسلم',
    });
    navigator.mediaSession.setActionHandler('play', () => this.toggle());
    navigator.mediaSession.setActionHandler('pause', () => this.toggle());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Best-effort warm-up of the HTTP cache for the next ayah (ignored when offline). */
function fetchHead(src: string): void {
  if (src.startsWith('http')) fetch(src, { cache: 'force-cache' }).catch(() => {});
}
