import { Component, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { KeepAwake } from '@capacitor-community/keep-awake';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonLabel, IonProgressBar, IonSegment,
  IonSegmentButton, IonSelect, IonSelectOption, IonTitle, IonToggle, IonToolbar, NavController,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { WordResult, alignRecitation, heardWords, score } from '../../core/tasmee/align';
import { TasmeeEngine, TasmeeService, dropOpenings } from '../../core/tasmee/tasmee.service';
import { WhisperSpeech } from '../../core/tasmee/whisper-speech';
import { PhoneSpeech, SpeechCallbacks } from '../../native/speech';
import { QuranService } from '../../core/quran/quran.service';
import { RecitationService } from '../../core/quran/recitation.service';
import { AyahRef, splitBasmala } from '../../core/quran/quran-utils';
import { ayahWords } from '../../core/quran/mushaf-layout';
import { HapticsService } from '../../core/services/haptics.service';
import { SettingsService } from '../../core/services/settings.service';

/** One word of the ayat being recited. */
interface Word {
  text: string;
  ref: AyahRef;
  /** Last word of its ayah (the ayah's number follows). */
  end: boolean;
}

/**
 * Tasmee' (تسميع): recite from memory and the app listens and corrects you, word by word: the words you say
 * correctly appear, a wrong word is shown in red with the right one, a skipped word in orange. Two free engines: the
 * phone's own speech recognition, or Tarteel's Quran-trained Whisper on the phone (offline, one download).
 * Words only (which word was said), not tajweed.
 */
@Component({
  selector: 'app-tasmee',
  imports: [
    TranslatePipe, DatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonButton, IonIcon,
    IonSelect, IonSelectOption, IonToggle, IonSegment, IonSegmentButton, IonLabel, IonProgressBar,
  ],
  templateUrl: './tasmee.page.html',
  styleUrl: './tasmee.page.scss',
})
export class TasmeePage implements OnDestroy {
  /** ?sura=&from=&to= (from the mushaf or a hifz plan). */
  readonly suraParam = input<string | undefined>(undefined, { alias: 'sura' });
  readonly fromParam = input<string | undefined>(undefined, { alias: 'from' });
  readonly toParam = input<string | undefined>(undefined, { alias: 'to' });

  readonly tasmee = inject(TasmeeService);
  readonly quran = inject(QuranService);
  private readonly recitation = inject(RecitationService);
  private readonly haptics = inject(HapticsService);
  private readonly settings = inject(SettingsService);
  readonly nav = inject(NavController);

  readonly lang = computed(() => this.settings.settings().language);
  readonly sura = signal(1);
  readonly from = signal(1);
  readonly to = signal(7);

  readonly state = signal<'idle' | 'listening' | 'stopped' | 'done'>('idle');
  readonly finals = signal<string[]>([]);
  readonly partial = signal('');
  readonly error = signal<string | null>(null);
  /** The mistake being shown (stop-on-mistake mode): a run of wrong / skipped words. */
  readonly correction = signal<{ from: number; to: number; skipped: boolean; heard?: string } | null>(null);
  readonly correctionText = computed(() => {
    const c = this.correction();
    return c ? this.words().slice(c.from, c.to + 1).map((w) => w.text).join(' ') : '';
  });
  readonly whisperReady = signal(WhisperSpeech.downloaded());
  readonly downloading = signal<number | null>(null);

  private engine: PhoneSpeech | WhisperSpeech | null = null;
  private notified = new Set<number>();

  readonly suraOptions = computed(() => (this.quran.ready() ? this.quran.suras : []));
  readonly ayahNumbers = computed(() => (this.quran.ready() ? Array.from({ length: this.quran.sura(this.sura()).ayas }, (_, i) => i + 1) : []));

  readonly words = computed<Word[]>(() => {
    if (!this.quran.ready()) return [];
    const out: Word[] = [];
    for (let aya = this.from(); aya <= this.to(); aya++) {
      const ref = { sura: this.sura(), aya };
      const a = this.quran.ayah(ref);
      const ws = ayahWords(splitBasmala(a, a.text).text);
      ws.forEach((text, i) => out.push({ text, ref, end: i === ws.length - 1 }));
    }
    return out;
  });

  readonly heard = computed(() => {
    const all = heardWords([...this.finals(), this.partial() === '…' ? '' : this.partial()].join(' '));
    return dropOpenings(all, this.words().slice(0, 4).map((w) => w.text));
  });

  readonly results = computed<WordResult[]>(() => alignRecitation(this.words().map((w) => w.text), this.heard(), this.state() === 'done'));
  /** Index of the next word to recite. */
  readonly position = computed(() => {
    const r = this.results();
    let last = -1;
    r.forEach((x, i) => x.status !== 'pending' && (last = i));
    return last + 1;
  });
  readonly progress = computed(() => (this.words().length ? this.position() / this.words().length : 0));
  readonly mistakes = computed(() =>
    this.results()
      .map((r, i) => ({ r, w: this.words()[i], i }))
      .filter((x) => x.r.status === 'wrong' || x.r.status === 'skipped'),
  );
  readonly scorePct = computed(() => Math.round(score(this.results()) * 100));
  readonly best = computed(() => this.tasmee.best(this.sura(), this.from(), this.to()));

  async ionViewWillEnter(): Promise<void> {
    await Promise.all([this.tasmee.load(), this.quran.load().catch(() => undefined)]);
    const s = Number(this.suraParam());
    if (s >= 1 && s <= 114) {
      const n = this.quran.sura(s).ayas;
      this.sura.set(s);
      this.from.set(Math.min(n, Math.max(1, Number(this.fromParam()) || 1)));
      this.to.set(Math.min(n, Math.max(this.from(), Number(this.toParam()) || n)));
    }
  }

  ionViewWillLeave(): void {
    void this.stop();
  }

  ngOnDestroy(): void {
    void this.engine?.stop();
  }

  setSura(v: unknown): void {
    const s = Number(v) || 1;
    this.sura.set(s);
    this.from.set(1);
    this.to.set(Math.min(this.quran.sura(s).ayas, 10));
    this.reset();
  }

  setFrom(v: unknown): void {
    this.from.set(Number(v) || 1);
    if (this.to() < this.from()) this.to.set(this.from());
    this.reset();
  }

  setTo(v: unknown): void {
    this.to.set(Math.max(this.from(), Number(v) || 1));
    this.reset();
  }

  async setEngine(v: unknown): Promise<void> {
    await this.tasmee.setPrefs({ engine: v === 'whisper' ? 'whisper' : 'phone' });
  }

  /** Downloads Tarteel's model (once). */
  async downloadWhisper(): Promise<void> {
    this.downloading.set(0);
    this.error.set(null);
    try {
      // A dropped connection on a big download is common: try again twice (finished files stay in the cache).
      for (let attempt = 1; ; attempt++) {
        try {
          await WhisperSpeech.prepare((f) => this.downloading.set(f));
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
      this.whisperReady.set(true);
    } catch (e) {
      console.warn('[tasmee] model download failed', e);
      this.error.set('download');
    } finally {
      this.downloading.set(null);
    }
  }

  async removeWhisper(): Promise<void> {
    await WhisperSpeech.remove();
    this.whisperReady.set(false);
    await this.tasmee.setPrefs({ engine: 'phone' });
  }

  async start(): Promise<void> {
    if (this.state() === 'listening') return;
    if (this.state() === 'done' || this.state() === 'idle') this.reset();
    this.error.set(null);
    const engine: TasmeeEngine = this.tasmee.prefs().engine === 'whisper' && this.whisperReady() ? 'whisper' : 'phone';
    if (engine === 'phone' && !(await PhoneSpeech.available())) {
      this.error.set('unavailable');
      return;
    }
    const cb: SpeechCallbacks = {
      onFinal: (t) => {
        this.finals.update((f) => [...f, t]);
        this.partial.set('');
        this.check();
      },
      onPartial: (t) => {
        this.partial.set(t);
        this.check();
      },
      onError: (code) => {
        console.warn('[tasmee] recognition error', code);
        // Network errors: the phone's recogniser needs its offline Arabic pack or the internet.
        if (code === '2' || code === 'network') this.error.set('network');
      },
    };
    try {
      this.engine = engine === 'whisper' ? new WhisperSpeech() : new PhoneSpeech();
      await this.engine.start(cb);
      this.state.set('listening');
      await KeepAwake.keepAwake().catch(() => undefined);
    } catch (e) {
      this.engine = null;
      const code = (e as { code?: string; name?: string })?.code ?? (e as { name?: string })?.name;
      this.error.set(code === 'DENIED' || code === 'NotAllowedError' ? 'denied' : 'unavailable');
    }
  }

  /** Pause (keeps what was recited). */
  async stop(): Promise<void> {
    if (this.state() !== 'listening') return;
    await this.engine?.stop();
    this.engine = null;
    this.state.set('stopped');
    await KeepAwake.allowSleep().catch(() => undefined);
  }

  /** Finish: the words not recited count as skipped up to where the reader stopped, and the session is saved. */
  async finish(): Promise<void> {
    const engine = this.engine;
    await this.stop();
    // Let the last phrases come back from the offline recogniser (up to ~10 s).
    for (let i = 0; i < 50 && engine instanceof WhisperSpeech && engine.busy; i++) await new Promise((r) => setTimeout(r, 200));
    const reached = this.position();
    this.state.set('done');
    const r = this.results().slice(0, Math.max(reached, 1));
    await this.tasmee.save({
      at: Date.now(),
      sura: this.sura(),
      from: this.from(),
      to: this.to(),
      score: score(r),
      words: r.length,
      mistakes: this.mistakes()
        .filter((m) => m.i < reached)
        .map((m) => ({ aya: m.w.ref.aya, word: m.w.text, heard: m.r.heard, kind: m.r.status as 'wrong' | 'skipped' })),
    });
  }

  reset(): void {
    this.finals.set([]);
    this.partial.set('');
    this.correction.set(null);
    this.notified.clear();
    if (this.state() !== 'listening') this.state.set('idle');
  }

  /** Recites the ayah of a mistake with the chosen reciter. */
  async listen(ref: AyahRef): Promise<void> {
    if (this.state() === 'listening') await this.stop();
    await this.recitation.play(ref, ref);
  }

  openInMushaf(ref: AyahRef): void {
    void this.nav.navigateForward(['/mushaf', this.quran.pageOf(ref)], { queryParams: ref });
  }

  async continueAfterCorrection(): Promise<void> {
    this.correction.set(null);
    await this.start();
  }

  /** Visible text of a word: hidden until reached in memorisation mode. */
  shown(i: number): boolean {
    return !this.tasmee.prefs().hideText || this.results()[i]?.status !== 'pending' || this.state() === 'done';
  }

  ayahNumber(n: number): string {
    return this.lang() === 'ar' ? new Intl.NumberFormat('ar-EG').format(n) : String(n);
  }

  /** A newly settled mistake: vibrate, and in stop-on-mistake mode pause and show the right word. */
  private check(): void {
    const r = this.results();
    for (let i = 0; i < r.length; i++) {
      const x = r[i];
      if ((x.status === 'wrong' || x.status === 'skipped') && x.settled && !this.notified.has(i)) {
        this.notified.add(i);
        this.haptics.target();
        // The whole run of mistaken words around it (a skipped phrase, a wrong word or two).
        const bad = (k: number) => r[k]?.status === 'wrong' || r[k]?.status === 'skipped';
        let from = i;
        let to = i;
        while (bad(from - 1)) from--;
        while (bad(to + 1)) to++;
        for (let k = from; k <= to; k++) this.notified.add(k);
        if (this.tasmee.prefs().stopOnMistake && this.state() === 'listening') {
          const heard = r.slice(from, to + 1).map((y) => y.heard).filter(Boolean).join(' ');
          this.correction.set({ from, to, skipped: r.slice(from, to + 1).every((y) => y.status === 'skipped'), heard: heard || undefined });
          void this.stop();
        }
        break;
      }
    }
    // Whole range recited: finish by itself.
    if (this.state() === 'listening' && r.length && r[r.length - 1].status !== 'pending' && !this.partial()) void this.finish();
  }
}
