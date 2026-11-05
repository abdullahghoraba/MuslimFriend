import { Injectable, inject, signal } from '@angular/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { AudioFocusService } from '../audio/audio-focus.service';
import { NativeAudio, QuranAudioItem, QuranAudioState } from '../../native/quran-audio';
import { QuranService } from '../quran/quran.service';
import { RECITERS, Reciter } from '../quran/recitation.service';
import { RUQYAH_PASSAGES } from './ruqyah';

const AUDIO_BASE = 'https://everyayah.com/data';
/** The mushaf's reciters whose EveryAyah folder has every ruqyah ayah (all 97 checked; Mustafa Ismail's lacks 41). */
export const RUQYAH_RECITERS: Reciter[] = RECITERS.filter((r) => r.id !== 'Mustafa_Ismail_48kbps');
const PREFS_KEY = 'ruqyah';
const file = (sura: number, aya: number) => `${String(sura).padStart(3, '0')}${String(aya).padStart(3, '0')}.mp3`;

/** One ayah of the ruqyah: [passage] is its place in RUQYAH_PASSAGES. */
export interface RuqyahStep { passage: number; sura: number; aya: number }

/**
 * Plays the ruqyah verses one after another in the chosen sheikh's voice (EveryAyah verse-by-verse files, from the
 * phone when that sura was downloaded in the mushaf). On Android the native player goes on with the screen off.
 */
@Injectable({ providedIn: 'root' })
export class RuqyahPlayerService {
  private readonly quran = inject(QuranService);
  private readonly focus = inject(AudioFocusService);
  private readonly nativeAudio = inject(NativeAudio);
  private audio?: HTMLAudioElement;
  private token = 0;
  private steps: RuqyahStep[] = [];
  /** Native states from before this queue started (another player stopping) are ignored until it sounds. */
  private started = false;

  readonly reciterId = signal(RUQYAH_RECITERS[0].id);
  readonly loop = signal(false);
  readonly current = signal<RuqyahStep | null>(null);
  readonly playing = signal(false);
  readonly loading = signal(false);
  readonly error = signal(false);

  constructor() {
    if (this.nativeAudio.enabled) void this.nativeAudio.player.addListener('state', (s) => this.onNative(s));
    void Preferences.get({ key: PREFS_KEY }).then(({ value }) => {
      try {
        const saved = value ? (JSON.parse(value) as { reciterId?: string; loop?: boolean }) : {};
        if (saved.reciterId && RUQYAH_RECITERS.some((r) => r.id === saved.reciterId)) this.reciterId.set(saved.reciterId);
        if (typeof saved.loop === 'boolean') this.loop.set(saved.loop);
      } catch { /* defaults */ }
    });
  }

  reciter(): Reciter { return RUQYAH_RECITERS.find((r) => r.id === this.reciterId()) ?? RUQYAH_RECITERS[0]; }

  async setReciter(id: string): Promise<void> {
    this.reciterId.set(id);
    await this.save();
    const cur = this.current();
    if (cur) await this.play(cur.passage);
  }

  async setLoop(on: boolean): Promise<void> {
    this.loop.set(on);
    await this.save();
    if (this.nativeAudio.enabled && this.current()) void this.nativeAudio.player.setRepeat({ repeat: on ? 'all' : 'off' });
  }

  private save(): Promise<void> {
    return Preferences.set({ key: PREFS_KEY, value: JSON.stringify({ reciterId: this.reciterId(), loop: this.loop() }) });
  }

  /** Every ayah of the ruqyah, in order. */
  allSteps(): RuqyahStep[] {
    return RUQYAH_PASSAGES.flatMap((p, passage) =>
      Array.from({ length: p.to - p.from + 1 }, (_, k) => ({ passage, sura: p.sura, aya: p.from + k })));
  }

  /** Plays the ruqyah from passage [from] (default: the beginning) to the end, again from the start when looping. */
  async play(from = 0): Promise<void> {
    this.focus.claim('ruqyah', () => this.stop());
    const token = ++this.token;
    await this.quran.load();
    this.steps = this.allSteps();
    const start = Math.max(0, this.steps.findIndex((s) => s.passage === from));
    this.current.set(this.steps[start]);
    this.error.set(false);
    this.loading.set(true);
    this.started = false;
    if (this.nativeAudio.enabled) {
      const items = await this.items();
      if (token !== this.token) return;
      try {
        await this.nativeAudio.player.play({ session: 'ruqyah', items, index: start, repeat: this.loop() ? 'all' : 'off', speed: 1, live: false });
      } catch {
        if (token === this.token) { this.loading.set(false); this.error.set(true); }
      }
      return;
    }
    this.playElement(start, token);
  }

  toggle(): void {
    if (!this.current()) { void this.play(); return; }
    if (this.nativeAudio.enabled) {
      if (!this.playing()) this.focus.claim('ruqyah', () => this.stop());
      this.playing.set(!this.playing());
      void this.nativeAudio.player.toggle();
      return;
    }
    if (!this.audio) return;
    if (this.audio.paused) { void this.audio.play(); this.playing.set(true); } else { this.audio.pause(); this.playing.set(false); }
  }

  stop(): void {
    this.token++;
    if (this.nativeAudio.enabled && this.current()) void this.nativeAudio.player.stop();
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = undefined; }
    this.current.set(null);
    this.playing.set(false);
    this.loading.set(false);
  }

  /** The queue: ayat downloaded with the mushaf's player come from the phone, the others stream. */
  private async items(): Promise<QuranAudioItem[]> {
    const reciter = this.reciter();
    const dir = `audio/${reciter.id}`;
    let saved = new Set<string>();
    let base = '';
    try {
      saved = new Set((await Filesystem.readdir({ path: dir, directory: Directory.Data })).files.map((f) => f.name));
      base = (await Filesystem.getUri({ path: dir, directory: Directory.Data })).uri;
    } catch { /* nothing downloaded */ }
    return this.steps.map((s, i) => {
      const name = file(s.sura, s.aya);
      return {
        url: saved.has(name) ? `${base}/${name}` : `${AUDIO_BASE}/${reciter.id}/${name}`,
        title: `الرقية الشرعية · ${this.quran.sura(s.sura).name} ${s.aya}`,
        artist: reciter.nameAr, album: 'رفيق المسلم', group: String(i),
      };
    });
  }

  private onNative(s: QuranAudioState): void {
    if (!this.current()) return;
    if (!this.started) {
      if (s.session !== 'ruqyah' || s.index < 0) return;
      this.started = true;
    }
    if (s.session !== 'ruqyah' && s.index >= 0) return;
    if (s.index < 0 || s.ended) { this.stop(); return; }
    this.playing.set(s.playing);
    this.loading.set(s.buffering);
    this.error.set(s.error);
    const step = this.steps[Number(s.group)];
    if (step && step !== this.current()) this.current.set(step);
  }

  /** In a browser: one audio element, ayah after ayah. */
  private playElement(index: number, token: number): void {
    const step = this.steps[index];
    if (!step) {
      if (this.loop() && this.steps.length) { this.playElement(0, token); return; }
      this.stop();
      return;
    }
    this.current.set(step);
    this.audio ??= new Audio();
    const audio = this.audio;
    audio.src = `${AUDIO_BASE}/${this.reciter().id}/${file(step.sura, step.aya)}`;
    audio.onplaying = () => { if (token === this.token) { this.loading.set(false); this.playing.set(true); } };
    audio.onwaiting = () => { if (token === this.token) this.loading.set(true); };
    audio.onended = () => { if (token === this.token) this.playElement(index + 1, token); };
    audio.onerror = () => { if (token === this.token) { this.loading.set(false); this.error.set(true); this.playing.set(false); } };
    void audio.play().catch(() => { if (token === this.token) { this.loading.set(false); this.playing.set(false); } });
  }
}
