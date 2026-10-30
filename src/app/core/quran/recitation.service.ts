import { Injectable, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { AudioFocusService } from '../audio/audio-focus.service';
import { AyahRef } from './quran-utils';
import { QuranService } from './quran.service';

export interface Reciter {
  /** EveryAyah folder name. */
  id: string;
  nameAr: string;
  nameEn: string;
}

/** Hafs reciters on EveryAyah (verse-by-verse MP3s); every folder checked to serve 1:1, 2:255 and 114:6. */
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
  { id: 'Alafasy_128kbps', nameAr: 'مشاري راشد العفاسي', nameEn: 'Mishary Rashid Alafasy' },
  { id: 'Abdurrahmaan_As-Sudais_192kbps', nameAr: 'عبد الرحمن السديس', nameEn: 'Abdurrahman As-Sudais' },
  { id: 'Hudhaify_128kbps', nameAr: 'علي الحذيفي', nameEn: 'Ali Al-Hudhaifi' },
  { id: 'Salah_Al_Budair_128kbps', nameAr: 'صلاح البدير', nameEn: 'Salah Al-Budair' },
  { id: 'Abdullaah_3awwaad_Al-Juhaynee_128kbps', nameAr: 'عبد الله عواد الجهني', nameEn: 'Abdullah Al-Juhani' },
  { id: 'Khaalid_Abdullaah_al-Qahtaanee_192kbps', nameAr: 'خالد القحطاني', nameEn: 'Khalid Al-Qahtani' },
  { id: 'Muhammad_Ayyoub_128kbps', nameAr: 'محمد أيوب', nameEn: 'Muhammad Ayyub' },
  { id: 'Ali_Jaber_64kbps', nameAr: 'علي جابر', nameEn: 'Ali Jaber' },
  { id: 'Abdullah_Basfar_192kbps', nameAr: 'عبد الله بصفر', nameEn: 'Abdullah Basfar' },
  { id: 'Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net', nameAr: 'أحمد بن علي العجمي', nameEn: 'Ahmed Al-Ajmi' },
  { id: 'Hani_Rifai_192kbps', nameAr: 'هاني الرفاعي', nameEn: 'Hani Ar-Rifai' },
  { id: 'Nasser_Alqatami_128kbps', nameAr: 'ناصر القطامي', nameEn: 'Nasser Al-Qatami' },
  { id: 'Fares_Abbad_64kbps', nameAr: 'فارس عباد', nameEn: 'Fares Abbad' },
  { id: 'Abdullah_Matroud_128kbps', nameAr: 'عبد الله المطرود', nameEn: 'Abdullah Al-Matrood' },
  { id: 'Salaah_AbdulRahman_Bukhatir_128kbps', nameAr: 'صلاح بو خاطر', nameEn: 'Salah Bukhatir' },
  { id: 'Akram_AlAlaqimy_128kbps', nameAr: 'أكرم العلاقمي', nameEn: 'Akram Al-Alaqimy' },
  { id: 'Yaser_Salamah_128kbps', nameAr: 'ياسر سلامة', nameEn: 'Yaser Salamah' },
  { id: 'khalefa_al_tunaiji_64kbps', nameAr: 'خليفة الطنيجي', nameEn: 'Khalifa At-Tunaiji' },
  { id: 'Ali_Hajjaj_AlSuesy_128kbps', nameAr: 'علي حجاج السويسي', nameEn: 'Ali Hajjaj As-Suwaisi' },
  { id: 'Sahl_Yassin_128kbps', nameAr: 'سهل ياسين', nameEn: 'Sahl Yassin' },
  { id: 'Ahmed_Neana_128kbps', nameAr: 'أحمد نعينع', nameEn: 'Ahmed Neana' },
  { id: 'Muhammad_AbdulKareem_128kbps', nameAr: 'محمد عبد الكريم', nameEn: 'Muhammad Abdulkareem' },
  { id: 'Husary_128kbps_Mujawwad', nameAr: 'محمود خليل الحصري (مجود)', nameEn: 'Al-Husary (Mujawwad)' },
  { id: 'Ayman_Sowaid_64kbps', nameAr: 'أيمن سويد', nameEn: 'Ayman Suwayd' },
  { id: 'aziz_alili_128kbps', nameAr: 'عزيز عليلي', nameEn: 'Aziz Alili' },
  { id: 'Karim_Mansoori_40kbps', nameAr: 'كريم منصوري', nameEn: 'Karim Mansoori' },
  { id: 'Parhizgar_48kbps', nameAr: 'شهريار برهيزكار', nameEn: 'Shahriar Parhizgar' },
];

const AUDIO_BASE = 'https://everyayah.com/data';
const PREFS_KEY = 'recitation';

export type RepeatMode = 1 | 2 | 3 | 5 | 7 | 10 | 15 | 20 | 0; // 0 = endless

interface RecitationPrefs {
  reciterId: string;
  repeatEach: RepeatMode;
  speed: number;
}

/** One play of one ayah ([rep] counts its repeats). */
interface Step {
  index: number;
  rep: number;
}

/** A step scheduled on the audio clock, linked to the step queued after it. */
interface Slot {
  step: Step;
  end: number;
  ended: boolean;
  next?: Slot;
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
  private readonly focus = inject(AudioFocusService);
  private audio?: HTMLAudioElement;
  /** The next ayah, already buffering so it starts without a gap or a stall. */
  private upcoming?: { index: number; src: string; audio: HTMLAudioElement };
  /** Bumped on every play/stop; events from an older ayah's audio are ignored. */
  private token = 0;
  private ctx?: AudioContext;
  /** True while the gapless engine is the one playing. */
  private gapless = false;
  private sources: AudioBufferSourceNode[] = [];
  private readonly decoded = new Map<string, AudioBuffer>();
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
    const cur = this.current();
    if (!cur) return;
    // A new reciter takes over from the ayah being recited.
    if (patch.reciterId !== undefined) {
      this.decoded.clear();
      void this.playIndex(this.quran.ayah(cur).index);
      return;
    }
    if (patch.speed === undefined) return;
    // 1× plays gaplessly; other speeds need a media element (it keeps the reciter's pitch).
    if (this.audio && patch.speed !== 1) this.audio.playbackRate = patch.speed;
    else void this.playIndex(this.quran.ayah(cur).index);
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
    if (!this.current()) return;
    if (this.gapless && this.ctx) {
      const resume = this.ctx.state !== 'running';
      void (resume ? this.ctx.resume() : this.ctx.suspend());
      this.playing.set(resume);
      return;
    }
    if (!this.audio) return;
    if (this.audio.paused) {
      void this.audio.play();
      this.playing.set(true);
    } else {
      this.audio.pause();
      this.playing.set(false);
    }
  }

  stop(): void {
    this.token++;
    this.stopSources();
    release(this.audio);
    release(this.upcoming?.audio);
    this.audio = undefined;
    this.upcoming = undefined;
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

  private playIndex(index: number): Promise<void> {
    this.focus.claim('mushaf', () => this.stop());
    return this.prefs().speed === 1 && typeof AudioContext !== 'undefined' ? this.playGapless(index) : this.playElement(index);
  }

  // ---- Gapless engine (1×) ----------------------------------------------------------------
  // Each ayah is decoded ahead and started on the audio clock at the exact moment the previous
  // one ends, so the recitation flows like one recording instead of pausing between files.

  private async playGapless(index: number): Promise<void> {
    const token = ++this.token;
    this.stopSources();
    release(this.audio);
    release(this.upcoming?.audio);
    this.audio = undefined;
    this.upcoming = undefined;
    this.gapless = true;
    this.ctx ??= new AudioContext();
    this.error.set(null);
    this.loading.set(true);
    this.showAyah(index);
    // Not awaited: sources scheduled meanwhile simply start once the context runs.
    if (this.ctx.state !== 'running') void this.ctx.resume();
    const buffer = await this.decode(index, token);
    if (!buffer || token !== this.token) return;
    this.playing.set(true);
    this.begin(this.startAt({ index, rep: 0 }, buffer, this.ctx.currentTime + 0.05, token), token);
  }

  private startAt(step: Step, buffer: AudioBuffer, at: number, token: number): Slot {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(at);
    this.sources.push(source);
    const slot: Slot = { step, end: at + buffer.duration, ended: false };
    source.onended = () => {
      this.sources = this.sources.filter((s) => s !== source);
      if (token !== this.token) return;
      slot.ended = true;
      if (slot.next) this.begin(slot.next, token);
      else if (!this.following(step)) this.finish();
      else this.loading.set(true); // the next ayah is still downloading
    };
    return slot;
  }

  /** [slot] is now sounding: show it and get the one after it ready to start on time. */
  private begin(slot: Slot, token: number): void {
    this.loading.set(false);
    this.showAyah(slot.step.index);
    const after = this.following(slot.step);
    if (!after) return;
    void this.decode(after.index, token).then((buffer) => {
      if (!buffer || token !== this.token) return;
      const late = slot.ended;
      slot.next = this.startAt(after, buffer, Math.max(slot.end, this.ctx!.currentTime + 0.02), token);
      if (late) this.begin(slot.next, token);
    });
  }

  /** What plays after [step]: a repeat, the next ayah, the range again, or nothing. */
  private following({ index, rep }: Step): Step | null {
    const reps = this.prefs().repeatEach === 0 ? Infinity : this.prefs().repeatEach;
    if (rep + 1 < reps) return { index, rep: rep + 1 };
    if (index < this.rangeEnd) return { index: index + 1, rep: 0 };
    if (this.loopRange()) return { index: this.rangeStart, rep: 0 };
    return null;
  }

  private async decode(index: number, token: number): Promise<AudioBuffer | null> {
    const src = await this.sourceFor(this.quran.ayahAt(index));
    const cached = this.decoded.get(src);
    if (cached) return cached;
    for (let attempt = 0; ; attempt++) {
      if (token !== this.token) return null;
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await this.ctx!.decodeAudioData(await res.arrayBuffer());
        this.decoded.set(src, buffer);
        // Decoded audio is large; keep only the few ayat around the current one.
        if (this.decoded.size > 4) this.decoded.delete(this.decoded.keys().next().value!);
        return buffer;
      } catch {
        // A dropped connection mid-sura: try again before giving up.
        if (attempt >= 3) {
          if (token === this.token) {
            this.loading.set(false);
            this.playing.set(false);
            this.error.set('network');
          }
          return null;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  private showAyah(index: number): void {
    const ref = this.quran.ayahAt(index);
    const cur = this.current();
    if (cur?.sura === ref.sura && cur.aya === ref.aya) return;
    this.current.set({ sura: ref.sura, aya: ref.aya });
    this.setMediaSession(ref);
  }

  private finish(): void {
    this.playing.set(false);
    this.current.set(null);
  }

  private stopSources(): void {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* not started */
      }
      s.disconnect();
    }
    this.sources = [];
    this.gapless = false;
  }

  // ---- Media element engine (other speeds) -------------------------------------------------

  private async playElement(index: number): Promise<void> {
    const token = ++this.token;
    this.stopSources();
    const ref = this.quran.ayahAt(index);
    this.current.set({ sura: ref.sura, aya: ref.aya });
    this.repeatsLeft = this.prefs().repeatEach === 0 ? Infinity : this.prefs().repeatEach - 1;
    this.error.set(null);
    this.loading.set(true);
    // Stop the previous ayah at once, so two recitations never overlap.
    release(this.audio);
    this.audio = undefined;
    const ready = this.upcoming?.index === index ? this.upcoming : undefined;
    if (!ready) release(this.upcoming?.audio);
    this.upcoming = undefined;
    const src = ready?.src ?? (await this.sourceFor(ref));
    if (token !== this.token) return;
    const audio = ready?.audio ?? newAudio(src);
    audio.playbackRate = this.prefs().speed;
    let retries = 0;
    audio.onended = () => token === this.token && this.onEnded(index, token);
    audio.onerror = () => {
      if (token !== this.token) return;
      // A dropped connection mid-sura: try the same ayah again before giving up.
      if (retries++ < 3 && src.startsWith('http')) {
        const at = audio.currentTime;
        setTimeout(() => {
          if (token !== this.token) return;
          audio.src = src;
          audio.currentTime = at;
          void audio.play().catch(() => {});
        }, 1500);
        return;
      }
      this.loading.set(false);
      this.playing.set(false);
      this.error.set('network');
    };
    audio.onwaiting = () => token === this.token && this.loading.set(true);
    audio.onplaying = () => token === this.token && this.loading.set(false);
    audio.oncanplay = () => token === this.token && this.loading.set(false);
    this.audio = audio;
    this.setMediaSession(ref);
    try {
      await audio.play();
      if (token === this.token) this.playing.set(true);
    } catch {
      // An error event follows a failed load; it decides whether to retry.
      if (token !== this.token || audio.error) return;
      this.playing.set(false);
      this.loading.set(false);
      this.error.set('network');
      return;
    }
    if (index + 1 <= this.rangeEnd) void this.prepare(index + 1, token);
  }

  /** Starts buffering ayah [index] while the current one plays. */
  private async prepare(index: number, token: number): Promise<void> {
    const src = await this.sourceFor(this.quran.ayahAt(index));
    if (token !== this.token) return;
    this.upcoming = { index, src, audio: newAudio(src) };
  }

  private onEnded(index: number, token: number): void {
    if (this.repeatsLeft > 0) {
      this.repeatsLeft--;
      if (this.audio) {
        this.audio.currentTime = 0;
        void this.audio.play().catch(() => token === this.token && this.error.set('network'));
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

function newAudio(src: string): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = src;
  return audio;
}

/** Stops an ayah's audio and frees its connection. */
function release(audio?: HTMLAudioElement): void {
  if (!audio) return;
  audio.onended = audio.onerror = audio.onwaiting = audio.onplaying = audio.oncanplay = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}
