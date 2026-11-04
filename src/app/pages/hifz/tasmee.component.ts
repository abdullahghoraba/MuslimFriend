import { Component, OnDestroy, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { LocalDatePipe } from '../../shared/local-date.pipe';
import { KeepAwake } from '@capacitor-community/keep-awake';
import {
  IonButton, IonIcon, IonLabel, IonProgressBar, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonToggle, NavController,
} from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { HeardSource, WordResult, alignRecitation, alignWithCost, bestAlternative, heardWords, rescue, score, wordKey } from '../../core/tasmee/align';
import { forcedGap, modelLetters } from '../../core/tasmee/ctc-score';
import { TasmeeEngine, TasmeeService, dropOpenings } from '../../core/tasmee/tasmee.service';
import { QuranSpeech } from '../../core/tasmee/quran-speech';
import { PhoneSpeech, PhraseReading, SpeechCallbacks } from '../../native/speech';
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

/** A finished phrase: its text, and with the offline recogniser its words' frames and letter probabilities. */
interface Final {
  text: string;
  reading?: PhraseReading;
}

/**
 * Tasmee' (تسميع), the Hifz page's second tab: recite from memory and the app listens and corrects you, word by word:
 * the words you say correctly appear, a wrong word is shown in red with the right one, a skipped word in orange. Two
 * free engines: Google's (the phone's) speech recognition, biased toward the ayat and choosing among its guesses the
 * one that fits them, or a Quran-trained model on the phone (offline, one 36 MB download; quran-speech.ts), whose
 * mistakes get a second look against the audio itself (align.ts rescue()). A mistake is announced only from
 * finished phrases: a live reading can stop in the middle of a word. Words only (which word was said), not tajweed.
 */
@Component({
  selector: 'app-tasmee',
  imports: [
    TranslatePipe, LocalDatePipe, IonButton, IonIcon, IonSelect, IonSelectOption, IonToggle, IonSegment, IonSegmentButton, IonLabel,
    IonProgressBar,
  ],
  templateUrl: './tasmee.component.html',
  styleUrl: './tasmee.component.scss',
})
export class TasmeeComponent implements OnInit, OnDestroy {
  /** The ayat to recite (a hifz plan's portion, the mushaf's selection); the reader can change them here. */
  readonly startSura = input<number | undefined>(undefined);
  readonly startFrom = input<number | undefined>(undefined);
  readonly startTo = input<number | undefined>(undefined);

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
  readonly finals = signal<Final[]>([]);
  readonly partial = signal('');
  readonly error = signal<string | null>(null);
  /** The mistake being shown (stop-on-mistake mode): a run of wrong / skipped words. */
  readonly correction = signal<{ from: number; to: number; skipped: boolean; heard?: string } | null>(null);
  readonly correctionText = computed(() => {
    const c = this.correction();
    return c ? this.words().slice(c.from, c.to + 1).map((w) => w.text).join(' ') : '';
  });
  readonly offlineReady = signal(QuranSpeech.downloaded());
  readonly downloading = signal<number | null>(null);
  /** Microphone level 0..1 while listening (shows that it hears you). */
  readonly level = signal(0);
  /** Listening for a while and the microphone hears nothing. */
  readonly quiet = signal(false);
  private lastSound = 0;

  private engine: PhoneSpeech | QuranSpeech | null = null;
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

  /** The words heard so far (with where each came from, to check its audio), without the isti'adha and basmala. */
  private heard(withPartial: boolean, finals = this.finals()): { texts: string[]; sources: (HeardSource | undefined)[] } {
    const texts: string[] = [];
    const sources: (HeardSource | undefined)[] = [];
    finals.forEach((f, phrase) => {
      if (f.reading) {
        for (const w of f.reading.words) {
          texts.push(w.text);
          sources.push({ phrase, start: w.start, end: w.end });
        }
      } else {
        for (const w of heardWords(f.text)) {
          texts.push(w);
          sources.push(undefined);
        }
      }
    });
    if (withPartial && this.partial() !== '…') {
      for (const w of heardWords(this.partial())) {
        texts.push(w);
        sources.push(undefined);
      }
    }
    const kept = dropOpenings(texts, this.words().slice(0, 4).map((w) => w.text));
    return { texts: kept, sources: sources.slice(texts.length - kept.length) };
  }

  /** How much less likely the written words are than the offline recogniser's own reading of those frames. */
  private readonly audioGap = (phrase: number, from: number, to: number, words: string[]): number => {
    const r = this.finals()[phrase]?.reading;
    return r ? forcedGap(r.lp, r.frames, r.vocab, from, to, words.map(modelLetters)) : Infinity;
  };

  private resultsOf(withPartial: boolean): WordResult[] {
    const expected = this.words().map((w) => w.text);
    const done = this.state() === 'done';
    const { texts, sources } = this.heard(withPartial);
    return rescue(alignRecitation(expected, texts, done), expected, sources, this.audioGap, done);
  }

  /** What is shown: the finished phrases and the one being recited. */
  readonly results = computed<WordResult[]>(() => this.resultsOf(true));
  /** What mistakes are announced from: the finished phrases only. */
  private readonly confirmed = computed<WordResult[]>(() => this.resultsOf(false));
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

  constructor() {
    // A new range from the host (another plan's portion): show it, unless a recitation is going on.
    effect(() => {
      const s = Number(this.startSura());
      const f = Number(this.startFrom());
      const t = Number(this.startTo());
      if (!this.quran.ready() || !(s >= 1 && s <= 114)) return;
      untracked(() => {
        if (this.state() === 'listening') return;
        const n = this.quran.sura(s).ayas;
        this.sura.set(s);
        this.from.set(Math.min(n, Math.max(1, f || 1)));
        this.to.set(Math.min(n, Math.max(this.from(), t || n)));
        this.reset();
        this.state.set('idle');
      });
    });
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.tasmee.load(), this.quran.load().catch(() => undefined)]);
  }

  ngOnDestroy(): void {
    void this.engine?.stop();
    void KeepAwake.allowSleep().catch(() => undefined);
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
    await this.tasmee.setPrefs({ engine: v === 'offline' ? 'offline' : 'phone' });
  }

  /** Downloads the Quran model (once). */
  async downloadModel(): Promise<void> {
    this.downloading.set(0);
    this.error.set(null);
    try {
      // A dropped connection on a big download is common: try again twice (finished files stay in the cache).
      for (let attempt = 1; ; attempt++) {
        try {
          await QuranSpeech.prepare((f) => this.downloading.set(f));
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
      this.offlineReady.set(true);
    } catch (e) {
      console.warn('[tasmee] model download failed', e);
      this.error.set('download');
    } finally {
      this.downloading.set(null);
    }
  }

  async removeModel(): Promise<void> {
    await QuranSpeech.remove();
    this.offlineReady.set(false);
    await this.tasmee.setPrefs({ engine: 'phone' });
  }

  async start(): Promise<void> {
    if (this.state() === 'listening') return;
    if (this.state() === 'done' || this.state() === 'idle') this.reset();
    this.error.set(null);
    const engine: TasmeeEngine = this.tasmee.prefs().engine === 'offline' && this.offlineReady() ? 'offline' : 'phone';
    if (engine === 'phone' && !(await PhoneSpeech.available())) {
      this.error.set('unavailable');
      return;
    }
    const expected = this.words().map((w) => w.text);
    const cb: SpeechCallbacks = {
      onFinal: (t, alternatives, reading) => {
        // Of the recogniser's guesses, the one that fits the ayat from where the reader is.
        const text = alternatives?.length ? bestAlternative(expected, this.position(), alternatives) : t;
        this.finals.update((f) => [...f, { text, reading }]);
        this.partial.set('');
        this.check();
      },
      onJoin: (text, reading, phrases) => {
        // The last phrases read again as one: kept if it confirms more words of the ayat (or as many, fitting better).
        const list = this.finals();
        const covered = (f: Final) => f.reading?.phrase !== undefined && phrases.includes(f.reading.phrase);
        const first = list.findIndex(covered);
        const at = first >= 0 ? first : list.length;
        const candidate = [...list.slice(0, at).filter((f) => !covered(f)), { text, reading }, ...list.slice(at).filter((f) => !covered(f))];
        const fit = (fs: Final[]) => {
          const a = alignWithCost(expected, this.heard(false, fs).texts);
          return { correct: a.results.filter((r) => r.status === 'correct').length, cost: a.cost };
        };
        const now = fit(list);
        const joined = fit(candidate);
        const keep = joined.correct > now.correct || (joined.correct === now.correct && joined.cost < now.cost - 1e-9);
        if (keep) this.finals.set(candidate);
        this.check();
        return keep;
      },
      onPartial: (t) => {
        this.partial.set(t);
        this.check();
      },
      onLevel: (l) => {
        this.level.set(l);
        const now = Date.now();
        if (l > 0.04 || !this.lastSound) this.lastSound = now;
        this.quiet.set(now - this.lastSound > 6000);
      },
      onError: (code) => {
        console.warn('[tasmee] recognition error', code);
        // Network errors: the phone's recogniser needs its offline Arabic pack or the internet.
        if (code === '2' || code === 'network') this.error.set('network');
      },
    };
    try {
      if (engine === 'offline') {
        const e = new QuranSpeech();
        this.engine = e;
        await e.start(cb);
      } else {
        const e = new PhoneSpeech();
        this.engine = e;
        await e.start(cb, this.biasPhrases());
      }
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
    this.level.set(0);
    this.quiet.set(false);
    this.lastSound = 0;
    this.state.set('stopped');
    await KeepAwake.allowSleep().catch(() => undefined);
  }

  /** Finish: the words not recited count as skipped up to where the reader stopped, and the session is saved. */
  async finish(): Promise<void> {
    const engine = this.engine;
    await this.stop();
    // Let the last phrases come back from the offline recogniser (up to ~10 s).
    for (let i = 0; i < 50 && engine instanceof QuranSpeech && engine.busy; i++) await new Promise((r) => setTimeout(r, 200));
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

  /**
   * What the recogniser should expect (Android 13+ favours these): the ayat in plain spelling (no tashkeel), cut
   * into phrases of up to 8 words, from the start of the range (where the reader begins).
   */
  private biasPhrases(): string[] {
    const plain = this.words().map((w) =>
      w.text
        .replace(/\u0648(?=\u0670)/g, '\u0627') // a waw written for an alif (salawat -> salat)
        .replace(/[\u0670\u0671]/g, '\u0627') // dagger alif and alif wasla read as alif
        .replace(/[^\u0621-\u063A\u0641-\u064A]/g, ''),
    );
    const out: string[] = [];
    for (let i = 0; i < plain.length && out.length < 100; i += 8) out.push(plain.slice(i, i + 8).join(' ').trim());
    return out.filter((p) => wordKey(p));
  }

  ayahNumber(n: number): string {
    return this.lang() === 'ar' ? new Intl.NumberFormat('ar-EG').format(n) : String(n);
  }

  /** A newly settled mistake: vibrate, and in stop-on-mistake mode pause and show the right word. */
  private check(): void {
    // A joined reading of the last phrases is on its way: it may take back a mistake, so wait for it.
    if (this.engine instanceof QuranSpeech && this.engine.joining) return;
    const r = this.confirmed();
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
    if (this.state() === 'listening' && r.length && r[r.length - 1].status !== 'pending') void this.finish();
  }
}
