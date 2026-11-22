import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { LocalDatePipe } from '../../shared/local-date.pipe';
import { KeepAwake } from '@capacitor-community/keep-awake';
import {
  IonButton, IonIcon, IonLabel, IonProgressBar, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonToggle, NavController,
} from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HeardSource, WordResult, alignRecitation, alignWithCost, bestAlternative, heardWords, rescue, score, similarity, wordKey } from '../../core/tasmee/align';
import { forcedGap, modelLetters } from '../../core/tasmee/ctc-score';
import { TasmeeCheck, TasmeeEngine, TasmeeService, dropOpenings } from '../../core/tasmee/tasmee.service';
import { QuranSpeech } from '../../core/tasmee/quran-speech';
import { TajweedError, TajweedPart, TajweedPrefs, TajweedReply, TajweedService, leftOut, pauseArtifact, quietestIn, silenceIn, splitAtPauses } from '../../core/tasmee/tajweed.service';

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
  /** Its place in the ayah (0-based). */
  n: number;
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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

  // ---- Tajweed check (after a tasmee' with the offline engine, which keeps each phrase's audio) ----
  private readonly tajweed = inject(TajweedService);
  private readonly translate = inject(TranslateService);
  readonly tajweedState = signal<'idle' | 'notice' | 'waking' | 'checking' | 'done' | 'failed'>('idle');
  readonly tajweedDone = signal(0);
  readonly tajweedTotal = signal(0);
  /** Phrases the server could not check (the result covers the others). */
  readonly tajweedFailed = signal(0);
  /** The mistakes found, by word (index in words()). */
  readonly tajweedIssues = signal<Map<number, TajweedError[]>>(new Map());
  readonly tajweedList = computed(() =>
    [...this.tajweedIssues().entries()].sort((a, b) => a[0] - b[0]).map(([i, errors]) => ({ i, w: this.words()[i], errors })),
  );
  readonly tajweedPrefs = signal<TajweedPrefs | null>(null);
  /** The words (indexes in words()) the server has checked and answered for: how much of the recitation was checked. */
  readonly tajweedChecked = signal<Set<number>>(new Set());
  /** Harakat (or harakat and tajweed) chosen. */
  readonly checkOn = computed(() => this.tasmee.prefs().check !== 'words');
  /**
   * Chosen, but it cannot run: it needs the Quran AI (which keeps each phrase's audio), not downloaded yet or not the
   * engine chosen. Said plainly, before and while reciting: before, only the words were checked and nothing said so.
   */
  readonly checkMissing = computed(() => this.checkOn() && !(this.tasmee.prefs().engine === 'offline' && this.offlineReady()));
  /** Phrases whose audio can be checked: their words, read once and in order. */
  readonly tajweedPhrases = computed(() => this.phrasesForTajweed());
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
      ws.forEach((text, i) => out.push({ text, ref, end: i === ws.length - 1, n: i }));
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

  /** The words as the offline recogniser heard them (the finished phrases and the one being recited). */
  private readonly aligned = computed<WordResult[]>(() => this.resultsOf(true));
  /** Words the recogniser wrote but the tajweed server found not said at all (see leftOut). */
  readonly omitted = signal<Set<number>>(new Set());
  /** What is shown: the words heard, with those the tajweed check found left out. */
  readonly results = computed<WordResult[]>(() => {
    const omitted = this.omitted();
    return this.aligned().map((r, i) => (omitted.has(i) && r.status !== 'skipped' ? { ...r, status: 'skipped' as const } : r));
  });
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
  /**
   * A long range (a page or more, up to a whole sura): the ayat scroll inside their own card, which follows the word
   * to recite, and the controls stay at the bottom, instead of one page several screens tall.
   */
  readonly long = computed(() => this.words().length > 120);
  readonly mistakes = computed(() =>
    this.results()
      .map((r, i) => ({ r, w: this.words()[i], i }))
      .filter((x) => x.r.status === 'wrong' || x.r.status === 'skipped'),
  );
  /**
   * The score: the words, and when the reader chose to be checked on harakat (or harakat and tajweed), a word said
   * right but with such a mistake counts as a mistake too.
   */
  readonly scorePct = computed(() => {
    const results = this.results();
    let s = score(results);
    if (this.tasmee.prefs().check !== 'words' && results.length) {
      const marked = [...this.tajweedIssues().keys()].filter((i) => results[i]?.status === 'correct').length;
      s = Math.max(0, s - marked / results.length);
    }
    return Math.round(s * 100);
  });
  readonly best = computed(() => this.tasmee.best(this.sura(), this.from(), this.to()));

  constructor() {
    // A long range follows the reciter: the word to say next is kept about a third of the way down its card.
    effect(() => {
      const i = this.position();
      if (!this.long()) return;
      requestAnimationFrame(() => {
        const card = this.host.nativeElement.querySelector<HTMLElement>('.recital.long');
        const word = card?.querySelector<HTMLElement>(`[data-i="${Math.min(i, this.words().length - 1)}"]`);
        if (!card || !word) return;
        const top = word.offsetTop - card.clientHeight / 3;
        if (Math.abs(card.scrollTop - top) > word.offsetHeight) card.scrollTo({ top: Math.max(0, top), behavior: i ? 'smooth' : 'auto' });
      });
    });
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
    this.tajweedPrefs.set(await this.tajweed.prefs());
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
    this.reachedAt.set(Math.max(reached, 1));
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
    // Checked on harakat (or harakat and tajweed): what was not checked while reciting is checked now.
    if (this.checkOn() && !this.checkMissing()) void this.checkTajweed();
  }

  reset(): void {
    this.openWord.set(null);
    this.tajweedState.set('idle');
    this.tajweedIssues.set(new Map());
    this.tajweedChecked.set(new Set());
    this.omitted.set(new Set());
    this.tajweedSent.clear();
    this.tajweedTotal.set(0);
    this.tajweedDone.set(0);
    this.tajweedFailed.set(0);
    this.finals.set([]);
    this.partial.set('');
    this.correction.set(null);
    this.notified.clear();
    if (this.state() !== 'listening') this.state.set('idle');
  }

  /**
   * Each finished phrase with its audio and the words it covers ([sura, aya, first, last] parts), when its words were
   * read once and in order (a phrase where the reciter went back has no single reference to compare with).
   */
  private phrasesForTajweed(): { audio: Float32Array; parts: TajweedPart[]; open: boolean }[] {
    const results = this.aligned();
    const words = this.words();
    const { sources } = this.heard(false);
    const byPhrase = new Map<number, number[]>();
    results.forEach((r, k) => {
      if (!r.h || (r.status !== 'correct' && r.status !== 'wrong')) return;
      const src = sources[r.h[0]];
      if (!src) return;
      const list = byPhrase.get(src.phrase) ?? [];
      if (!list.includes(k)) list.push(k);
      byPhrase.set(src.phrase, list);
    });
    const out: { audio: Float32Array; parts: TajweedPart[]; open: boolean }[] = [];
    const finals = this.finals();
    // A phrase cut for its length (a long ayah read without a pause) goes on in the next one, maybe in the middle of a
    // word: the two are put back together as recited, so the check hears whole words.
    const groups: number[][] = [];
    for (const ph of [...byPhrase.keys()].sort((a, b) => a - b)) {
      const prev = groups[groups.length - 1];
      if (prev?.includes(ph)) continue;
      const last = prev?.[prev.length - 1];
      if (prev && last === ph - 1 && finals[last]?.reading?.cut) prev.push(ph);
      else groups.push([ph]);
      // Its continuation belongs to it even when no word was heard in it (the rest of a word, its madd...).
      const g = groups[groups.length - 1];
      while (finals[g[g.length - 1]]?.reading?.cut && finals[g[g.length - 1] + 1]?.reading?.audio) g.push(g[g.length - 1] + 1);
    }
    for (const group of groups) {
      const readings = group.map((ph) => finals[ph]?.reading);
      if (readings.some((r) => !r?.audio || !r.frames)) continue;
      const list = [...new Set(group.flatMap((ph) => byPhrase.get(ph) ?? []))].sort((a, b) => a - b);
      if (!list.length) continue;
      const offsets: number[] = [];
      let total = 0;
      for (const r of readings) {
        offsets.push(total);
        total += r!.audio!.length;
      }
      if (total < 0.3 * 16000) continue;
      const audio = new Float32Array(total);
      readings.forEach((r, i) => audio.set(r!.audio!, offsets[i]));
      // Each word's place in that audio, in samples.
      const at = (src: { phrase: number; start: number; end: number } | undefined, edge: 'start' | 'end') => {
        const i = src ? group.indexOf(src.phrase) : -1;
        if (!src || i < 0) return 0;
        const r = readings[i]!;
        return offsets[i] + (src[edge] * r.audio!.length) / r.frames;
      };
      // Every word heard in this audio (the ayat's and any other: a word said twice, the isti'adha...), in samples.
      const heardSpans = readings.flatMap((r, i) =>
        r!.words.map((w) => ({ start: offsets[i] + (w.start * r!.audio!.length) / r!.frames, end: offsets[i] + (w.end * r!.audio!.length) / r!.frames })),
      );
      // The ayat's words in runs read in order: a skipped word or a word said again splits the phrase there, and each
      // run is checked on its own audio (before, the whole phrase was left unchecked).
      const runs: number[][] = [];
      for (const k of list) {
        const run = runs[runs.length - 1];
        if (run && k === run[run.length - 1] + 1) run.push(k);
        else runs.push([k]);
      }
      for (const run of runs) {
        // A word's heard words are h = [from, to): it ends where the heard word before [to] ends.
        const spans = run.map((k) => {
          const h = results[k].h;
          return { start: at(h ? sources[h[0]] : undefined, 'start'), end: at(h ? sources[h[1] - 1] : undefined, 'end') };
        });
        const first = spans[0].start;
        const lastEnd = spans[spans.length - 1].end;
        if (!(lastEnd > first)) continue;
        // The run's audio: from the quietest moment after the word heard before it to the quietest before the word heard
        // after it, so no other word is in it, and none of its own is cut (a word goes on after its last letter's frame).
        const before = heardSpans.filter((h) => h.end <= first + 1).reduce((m, h) => Math.max(m, h.end), -1);
        const after = heardSpans.filter((h) => h.start >= lastEnd - 1).reduce((m, h) => Math.min(m, h.start), Infinity);
        const from = before >= 0 ? quietestIn(audio, before, first) : 0;
        const to = after < Infinity ? quietestIn(audio, lastEnd, after) : total;
        // Every word heard in it must be one of the run's (a word may be heard in two pieces where a phrase was cut).
        if (heardSpans.filter((h) => h.start >= from - 1 && h.end <= to + 1).length > run.length + group.length) continue;
        // Cut where the reciter paused (waqf): each part then ends at a stop, as the server expects; read as one
        // breath, a stop's sukun or longer madd would be counted as mistakes. A part still too long for the server
        // (20 s) is cut between words.
        const local = spans.map((s) => ({ start: s.start - from, end: s.end - from }));
        for (const p of splitAtPauses(local, to - from, to - from, 0.3, 18 * 16000, (a, b) => {
          const at = silenceIn(audio, from + a, from + b);
          return at < 0 ? -1 : at - from;
        })) {
          if (p.to - p.from > 20 * 16000 || p.to - p.from < 0.3 * 16000) continue;
          const parts: TajweedPart[] = [];
          for (const k of run.slice(p.first, p.last + 1)) {
            const w = words[k];
            const last = parts[parts.length - 1];
            if (last && last[1] === w.ref.aya) last[3] = w.n;
            else parts.push([w.ref.sura, w.ref.aya, w.n, w.n]);
          }
          out.push({ audio: audio.subarray(from + p.from, from + p.to), parts, open: !!readings[readings.length - 1]?.cut && from + p.to >= total });
        }
      }
    }
    return out;
  }

  /** Phrases already sent to the tajweed server in this tasmee' (by the words they cover). */
  private readonly tajweedSent = new Set<string>();
  private tajweedSending: Promise<void> | null = null;
  private tajweedAgain = false;
  private tajweedAwake: Promise<boolean> | null = null;

  /**
   * While reciting, with harakat (or harakat and tajweed) chosen: each phrase is checked as soon as it has ended (the
   * reader paused), and its findings show above its words while the reader goes on.
   */
  private readonly liveTajweed = effect(() => {
    if (this.state() !== 'listening' || this.tasmee.prefs().check === 'words' || !this.tajweedPrefs()?.noticeSeen) return;
    this.tajweedPhrases();
    untracked(() => void this.sendTajweed(false));
  });

  /** Sends the phrases not checked yet (while reciting, not one that goes on in the next phrase); merges what comes back. */
  private sendTajweed(final: boolean): Promise<void> {
    if (this.tajweedSending) {
      this.tajweedAgain = true;
      return this.tajweedSending;
    }
    this.tajweedSending = (async () => {
      do {
        this.tajweedAgain = false;
        const key = (x: { parts: TajweedPart[] }) => JSON.stringify(x.parts);
        const phrases = this.tajweedPhrases().filter((x) => !this.tajweedSent.has(key(x)) && (final || !x.open));
        if (!phrases.length) continue;
        this.tajweedAwake ??= this.tajweed.wake();
        if (!(await this.tajweedAwake)) {
          this.tajweedAwake = null;
          this.tajweedFailed.update((n) => n + phrases.length);
          return;
        }
        phrases.forEach((x) => this.tajweedSent.add(key(x)));
        this.tajweedTotal.update((n) => n + phrases.length);
        const replies = await this.tajweed.check(phrases);
        this.tajweedDone.update((n) => n + phrases.length);
        this.applyTajweed(phrases, replies);
      } while (this.tajweedAgain);
    })().finally(() => (this.tajweedSending = null));
    return this.tajweedSending;
  }

  /** The server's findings for [phrases], on the words they cover (replacing earlier findings on those words). */
  private applyTajweed(phrases: { parts: TajweedPart[] }[], replies: (TajweedReply | null)[]): void {
    const words = this.words();
    const results = this.results();
    const issues = new Map(this.tajweedIssues());
    const checked = new Set(this.tajweedChecked());
    const omitted = new Set(this.omitted());
    let failed = 0;
    replies.forEach((reply, n) => {
      const covered = words
        .map((w, k) => ({ w, k }))
        .filter(({ w }) => phrases[n].parts.some(([s, a, f, l]) => w.ref.sura === s && w.ref.aya === a && w.n >= f && w.n <= l));
      covered.forEach(({ k }) => {
        issues.delete(k);
        omitted.delete(k);
      });
      if (!reply) {
        failed++;
        return;
      }
      covered.forEach(({ k }) => checked.add(k));
      const at = (e: TajweedError) => words.findIndex((w) => w.ref.aya === e.aya && w.n === e.word && w.ref.sura === phrases[n].parts[0][0]);
      // A word whose letters were all found missing was left out (the recogniser wrote it anyway).
      const deleted = new Map<number, string[]>();
      for (const e of reply.errors) {
        const k = at(e);
        if (k >= 0 && e.kind === 'delete' && e.type !== 'tashkeel') deleted.set(k, [...(deleted.get(k) ?? []), e.expected]);
      }
      for (const [k, letters] of deleted) if (leftOut(words[k].text, letters)) omitted.add(k);
      for (const e of reply.errors) {
        const k = at(e);
        // The server's mushaf and the app's split the ayah the same way; if a word differs, it is not shown.
        if (k < 0 || (e.wordText && similarity(wordKey(e.wordText), wordKey(words[k].text)) < 0.7)) continue;
        // A word left out has no letters to correct.
        if (omitted.has(k)) continue;
        // A letter said wrongly is shown only if the word check heard a wrong word too: when the word was recognised
        // as said right, a changed letter is most often the tajweed model mishearing (madd, ghunnah, harakat stay).
        if (e.type === 'normal' && results[k]?.status === 'correct') continue;
        // How a reciter pauses mid-phrase (sukun at a stop, madd 'arid...) is not a mistake.
        if (e.type !== 'normal' && pauseArtifact(e, words[k].text, words[k + 1]?.text)) continue;
        // Checked on harakat only: the tajweed rules (madd, ghunnah, qalqalah...) are not shown.
        if (this.tasmee.prefs().check === 'tashkeel' && e.type === 'tajweed') continue;
        issues.set(k, [...(issues.get(k) ?? []), e]);
      }
    });
    this.tajweedIssues.set(issues);
    this.tajweedChecked.set(checked);
    this.omitted.set(omitted);
    this.tajweedFailed.update((n) => n + failed);
  }

  /** A word's findings in a few words, written above it in the ayat (the rule's name, or «حركة» / «حرف»). */
  tajweedShort(errors: TajweedError[]): string {
    const ar = this.lang() === 'ar';
    const labels = errors.map((e) =>
      e.type === 'tajweed'
        ? (ar ? e.rules[0]?.ar : e.rules[0]?.en) || this.translate.instant(/[ۦۥ]|اا/.test((e.expected ?? '') + (e.heard ?? '')) ? 'tasmee.tjMadd' : 'tasmee.tjRule')
        : e.type === 'tashkeel' ? this.translate.instant('tasmee.tjHaraka') : this.translate.instant('tasmee.tjLetter'));
    return [...new Set(labels)].slice(0, 2).join(' · ');
  }

  async checkTajweed(): Promise<void> {
    const prefs = await this.tajweed.prefs();
    this.tajweedPrefs.set(prefs);
    // The model's licence: the reader is told it is AI (and can be wrong) before the first use.
    if (!prefs.noticeSeen) {
      this.tajweedState.set('notice');
      return;
    }
    // Nothing could be checked (no phrase heard clearly enough, in order): said so, not «no mistakes».
    if (!this.tajweedPhrases().length && !this.tajweedSent.size) {
      this.tajweedState.set('done');
      return;
    }
    this.tajweedState.set(this.tajweedAwake ? 'checking' : 'waking');
    this.tajweed.progress = undefined;
    // What was checked while reciting stays; what is left is checked now.
    await this.sendTajweed(true);
    if (this.tajweedSending) await this.tajweedSending;
    const total = this.tajweedTotal();
    this.tajweedState.set(total && this.tajweedFailed() >= total ? 'failed' : 'done');
  }

  async acceptTajweedNotice(): Promise<void> {
    await this.tajweed.setPrefs({ noticeSeen: true });
    await this.checkTajweed();
  }

  async setMadd(key: 'monfasel' | 'mottasel' | 'aared', v: unknown): Promise<void> {
    await this.tajweed.setPrefs({ [key]: Number(v) });
    this.tajweedPrefs.set(await this.tajweed.prefs());
  }

  /** A number of counts (harakat): in Arabic with the right form (حركة واحدة، حركتان، ٣ حركات). */
  harakat(n: number, subject = false): string {
    if (this.lang() !== 'ar') return String(n);
    if (n === 1) return 'حركة واحدة';
    if (n === 2) return subject ? 'حركتان' : 'حركتين';
    return `${this.ayahNumber(n)} حركات`;
  }

  /** What a tajweed mistake was, in words. */
  tajweedText(e: TajweedError): { title: string; detail: string } {
    const ar = this.lang() === 'ar';
    const rule = e.rules[0] ? (ar ? e.rules[0].ar : e.rules[0].en) : '';
    const t = (key: string, params?: object) => this.translate.instant('tajweed.' + key, params);
    if (e.type === 'tajweed' && e.expectedLen != null && e.heardLen != null && e.expectedLen !== e.heardLen) {
      return { title: rule || t('madd'), detail: t('length', { heard: this.harakat(e.heardLen), expected: this.harakat(e.expectedLen) }) };
    }
    // A madd (its length is written as that many letters) not made at all.
    const madd = (x: string) => (x.match(/[اۦۥىو]/g) ?? []).length;
    if (e.type === 'tajweed' && /^[اۦۥىو]+$/.test(e.expected ?? '') && !madd(e.heard ?? '')) {
      return { title: rule || t('madd'), detail: t('noMadd', { expected: this.harakat(madd(e.expected), false) }) };
    }
    if (e.type === 'tajweed') {
      return { title: rule || t('rule'), detail: e.kind === 'delete' ? t('missing') : e.kind === 'insert' ? t('extra') : t('notRight') };
    }
    return {
      title: e.type === 'tashkeel' ? t('haraka') : t('letter'),
      detail: e.expected || e.heard ? t('expectedHeard', { expected: e.expected || '—', heard: e.heard || '—' }) : '',
    };
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
  /**
   * In memorisation mode a word appears once it is recited. While reciting, a word counted as skipped stays hidden
   * (it shows at the end, with the mistakes), and after a jump (two or more words skipped) the words heard further on
   * appear only once four in a row were said there: the ayat repeat phrases (al-Baqarah 3 and 4 both begin «الذين
   * يؤمنون»), and a phrase matched one ayah too far must not uncover that ayah before it is recited.
   */
  shown(i: number): boolean {
    if (!this.tasmee.prefs().hideText) return true;
    // Before starting, the ayat chosen are shown (to look at them once more); they hide when the reciting starts.
    if (this.state() === 'idle') return true;
    // A hint: the next word, for a moment.
    if (i === this.peek()) return true;
    // Finished: what was recited is shown (to see the mistakes), not the ayat after where the reader stopped.
    if (this.state() === 'done') return i < this.reachedAt();
    const results = this.results();
    const status = results[i]?.status;
    if (!status || status === 'pending' || status === 'skipped') return false;
    // The run of heard words this one belongs to, and the skipped words before that run.
    let start = i;
    while (start > 0 && results[start - 1].status !== 'skipped' && results[start - 1].status !== 'pending') start--;
    let skipped = 0;
    for (let k = start - 1; k >= 0 && results[k].status === 'skipped'; k--) skipped++;
    if (skipped < 2) return true;
    let run = 0;
    for (let k = start; k < results.length && (results[k].status === 'correct' || results[k].status === 'wrong'); k++) run++;
    return run >= 4;
  }

  /** A hint asked for while reciting from memory: the word to say next, shown for a moment. */
  readonly peek = signal<number | null>(null);
  private peekTimer?: ReturnType<typeof setTimeout>;

  hint(): void {
    clearTimeout(this.peekTimer);
    this.peek.set(this.position());
    this.peekTimer = setTimeout(() => this.peek.set(null), 2500);
  }

  /** The word whose mistake is shown in the sheet (tapped in the ayat). */
  readonly openWord = signal<number | null>(null);

  /** A tapped word: its mistake (the word said, or left out) and its harakat/tajweed findings, in a sheet over the ayat. */
  tapWord(i: number): void {
    if (this.hasMistake(i)) this.openWord.set(i);
  }

  private hasMistake(i: number): boolean {
    const status = this.results()[i]?.status;
    const issue = status === 'wrong' || status === 'skipped' || this.tajweedIssues().has(i);
    return issue && (this.shown(i) || this.state() === 'done');
  }

  /** The words with a mistake, in order (the sheet goes from one to the next). */
  readonly mistakeWords = computed(() => this.results().map((_, i) => i).filter((i) => this.hasMistake(i)));

  stepWord(d: 1 | -1): void {
    const list = this.mistakeWords();
    const next = list[list.indexOf(this.openWord() ?? -1) + d];
    if (next !== undefined) this.openWord.set(next);
  }

  /**
   * A haraka or letter mistake as the right letter beside the one heard (دُ and دَ), when both are a plain letter with
   * its harakat; the server's own marks (qalqalah ڇ, ghunnah ں, a madd's length as repeated letters) are said in words.
   */
  letterPair(e: TajweedError): { right: string; heard: string } | null {
    if (e.type === 'tajweed' || !e.expected || !e.heard) return null;
    const plain = /^[ء-ي][ً-ْ]{0,2}$/;
    if (!plain.test(e.expected) || !plain.test(e.heard)) return null;
    // A letter heard with no vowel was said with a sukun: shown with one, so it reads as a haraka like the other.
    const mark = (x: string) => (x.length === 1 ? x + 'ْ' : x);
    return { right: mark(e.expected), heard: mark(e.heard) };
  }


  /** Where the reader had got to when the tasmee' ended. */
  readonly reachedAt = signal(0);

  /** What counts as a mistake. Choosing harakat or tajweed shows that they are checked by AI (the line under it). */
  async setCheck(check: TasmeeCheck): Promise<void> {
    // Harakat and tajweed are checked on the recitation's audio, which only the Quran AI keeps: choosing them chooses
    // it (its download button shows if it is not on the phone yet).
    await this.tasmee.setPrefs(check === 'words' ? { check } : { check, engine: 'offline' });
    if (check !== 'words') await this.tajweed.setPrefs({ noticeSeen: true });
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
    // Whole range recited: finish by itself, once the phrase with the last word has ended (the reader paused). The
    // live words show the last word while it is still being said: stopping then cut its end off the audio, and the
    // harakat/tajweed check found its shadda or madd missing.
    // With the Quran AI: until the reader pauses (a word seen early may still be going on, its end not yet recorded).
    const reciting = this.partial().replace('…', '').trim().length > 0 || (this.engine instanceof QuranSpeech && this.engine.speaking);
    if (this.state() === 'listening' && r.length && r[r.length - 1].status !== 'pending' && !reciting) void this.finish();
  }
}
