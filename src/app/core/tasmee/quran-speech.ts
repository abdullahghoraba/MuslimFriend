import { SpeechCallbacks } from '../../native/speech';
import { SAMPLE_RATE, StreamResampler } from './qasr-features';

/** The offline Quran recogniser (qasr.worker.ts): download state, and listening in phrases with live words. */

const DOWNLOADED_KEY = 'tasmeeQasrReady';

/**
 * Cuts the microphone into phrases at the reciter's pauses, and hands out the phrase so far while it is being
 * recited (for live words). The recogniser needs this: it was trained on one ayah at a time, so it reads a phrase
 * best, writes words said twice in one stretch of audio only once, and loses words in very long stretches.
 *
 * Voice detection works on 20 ms frames against the room's background level, measured as the quietest twentieth of
 * the last 30 seconds (so speech from the very first moment, a fan or traffic do not raise it), with a fixed level for the
 * first moments. A breath is not voice: it is a hiss (the signal crosses zero thousands of times a second, where a
 * recited vowel crosses it a few hundred times) and softer than the recitation, so a breath between two ayat leaves
 * the pause a pause (two ayat in one phrase would lose words). A pause of [pauseSec] ends a phrase; a phrase longer
 * than [maxSec] is cut at its quietest moment (between two words) in its last seconds, never in the middle of a word.
 */
export class PhraseSplitter {
  /** Samples of the phrase being recited (with a little audio from before it began). */
  private buf: Float32Array;
  private length = 0;
  private speaking = false;
  /** Voiced frames in a row (speech starts after a few, so a click is not a phrase). */
  private onset = 0;
  private silentFor = 0;
  private voicedSec = 0;
  private sinceUpdate = 0;
  /** Energies of the last 8 s of 20 ms frames (background level). */
  // 30 s: a long ayah read without a pause fills 8 s with voice, whose quietest tenth (a soft madd) then passed for
  // the background, and the end of the ayah for a pause (its last seconds were lost). 30 s hold the pauses between ayat.
  private readonly history = new Float32Array(1500);
  private historyCount = 0;
  private floorValue = 0;
  private sinceFloor = 0;
  /** Level of the recitation (slowly falling peak of the voiced frames). */
  private speech = 0;
  /** Samples of the current 20 ms frame. */
  private readonly frame: Float32Array;
  private frameFill = 0;
  /** Samples at the start of the phrase that repeat the end of the phrase cut before it. */
  private lead = 0;
  /** How much of a cut phrase's end the next phrase starts with (a word cut in two is then whole in one of them). */
  static readonly OVERLAP_SEC = 3;
  /** Audio kept from before speech starts. */
  private readonly preRoll: Float32Array;
  private preFill = 0;

  /** Input level 0..1 (for the microphone meter). */
  level = 0;

  constructor(
    /**
     * [cut]: the phrase was cut for its length (no pause): the recitation goes on, maybe mid-word, in the next one.
     * [lead]: samples at the start of this phrase that are the end of the cut phrase before it (see cutLong).
     */
    private readonly onPhrase: (audio: Float32Array, final: boolean, cut?: boolean, lead?: number) => void,
    private readonly rate = SAMPLE_RATE,
    private readonly pauseSec = 0.55,
    private readonly maxSec = 14,
    private readonly updateSec = 1.2,
  ) {
    this.frame = new Float32Array(Math.round(rate * 0.02));
    this.preRoll = new Float32Array(Math.round(rate * 0.3));
    this.buf = new Float32Array(Math.round(rate * (maxSec + 2)));
  }

  /** Lowest level counted as voice (about -54 dBFS): a phone's gain control keeps a reciter far above it. */
  static readonly MIN_VOICE = 0.002;
  /** Zero crossings per second above which a sound is a hiss rather than a voiced sound. */
  static readonly HISS = 2800;
  /** Within a phrase, a hiss this loud (a share of the voice) is a fricative being said, not a pause. */
  static HISS_IN_PHRASE = 0.12;

  push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; ) {
      const n = Math.min(samples.length - i, this.frame.length - this.frameFill);
      this.frame.set(samples.subarray(i, i + n), this.frameFill);
      this.frameFill += n;
      i += n;
      if (this.frameFill === this.frame.length) {
        this.frameFill = 0;
        this.onFrame(this.frame);
      }
    }
  }

  /** The background level: the quietest tenth of the recent frames. */
  private floor(): number {
    if (this.historyCount < 25) return 0;
    if (this.sinceFloor++ % 10 === 0) {
      const n = Math.min(this.historyCount, this.history.length);
      const sorted = Float32Array.from(this.history.subarray(0, n)).sort();
      this.floorValue = sorted[Math.floor(n * 0.05)];
    }
    return this.floorValue;
  }

  private onFrame(frame: Float32Array): void {
    let mean = 0;
    for (const v of frame) mean += v;
    mean /= frame.length;
    let sum = 0;
    let crossings = 0;
    let prev = frame[0] - mean;
    for (const v of frame) {
      const x = v - mean;
      sum += x * x;
      if ((x >= 0) !== (prev >= 0)) crossings++;
      prev = x;
    }
    const rms = Math.sqrt(sum / frame.length);
    const crossingsPerSec = crossings / (frame.length / this.rate);
    this.level = this.level * 0.6 + Math.min(1, rms * 8) * 0.4;
    this.history[this.historyCount++ % this.history.length] = rms;
    const floor = this.floor();
    const sec = frame.length / this.rate;
    // Hysteresis: speech has to rise well above the background to start, and fall near it to count as a pause.
    const loud = rms > Math.max(PhraseSplitter.MIN_VOICE, floor * (this.speaking ? 2 : 3));
    // A hiss (breath, a fricative on its own) starts a phrase only when it is about as loud as the recitation. Within a
    // phrase, a hiss up to 18 dB below the voice is a fricative of the word being said (Husary's «فَصَلِّ», «خُسْرٍ»:
    // their «ص» / «س» / «خ» about 10 dB below, counted as silence, ended the phrase mid-ayah and left the word alone,
    // misheard without the words around it); a breath is quieter.
    const voice = loud && (crossingsPerSec < PhraseSplitter.HISS || rms > this.speech * (this.speaking ? PhraseSplitter.HISS_IN_PHRASE : 0.35));
    if (voice) this.speech = Math.max(rms, this.speech);
    this.speech *= 0.9995;
    if (!this.speaking) {
      this.keepPreRoll(frame);
      this.onset = voice ? this.onset + 1 : 0;
      if (this.onset < 3) return;
      this.speaking = true;
      this.length = 0;
      this.append(this.preRoll.subarray(0, this.preFill));
      this.preFill = 0;
      this.silentFor = 0;
      this.voicedSec = this.onset * sec;
      this.sinceUpdate = 0;
      return;
    }
    this.append(frame);
    if (voice) {
      this.silentFor = 0;
      this.voicedSec += sec;
    } else this.silentFor += sec;
    this.sinceUpdate += sec;
    if (this.silentFor >= this.pauseSec) this.flush();
    else if (this.length / this.rate >= this.maxSec) this.cutLong();
    else if (this.sinceUpdate >= this.updateSec && this.silentFor < 0.2) {
      this.sinceUpdate = 0;
      this.onPhrase(this.buf.slice(0, this.length), false, false, this.lead);
    }
  }

  private keepPreRoll(frame: Float32Array): void {
    const cap = this.preRoll.length;
    if (this.preFill + frame.length > cap) {
      const keep = cap - frame.length;
      this.preRoll.copyWithin(0, this.preFill - keep, this.preFill);
      this.preFill = keep;
    }
    this.preRoll.set(frame, this.preFill);
    this.preFill += frame.length;
  }

  private append(x: Float32Array): void {
    if (this.length + x.length > this.buf.length) {
      const bigger = new Float32Array((this.length + x.length) * 2);
      bigger.set(this.buf.subarray(0, this.length));
      this.buf = bigger;
    }
    this.buf.set(x, this.length);
    this.length += x.length;
  }

  /**
   * A long phrase without a pause: sends it up to its quietest 250 ms in the last 4 s, and keeps the rest. A quarter
   * of a second is a gap between two words: a shorter window found the silence inside a stop consonant (the closure of
   * «ض», «ت», «ب») and cut a word in two, whose halves the tajweed check then heard as a missing shadda or madd.
   */
  private cutLong(): void {
    const win = Math.round(this.rate * 0.25);
    const hop = win >> 2;
    const from = Math.max(win, this.length - Math.round(this.rate * 4));
    let at = this.length - win;
    let least = Infinity;
    for (let i = from; i + win <= this.length - win; i += hop) {
      let e = 0;
      for (let j = i; j < i + win; j++) e += this.buf[j] * this.buf[j];
      if (e < least) {
        least = e;
        at = i + (win >> 1);
      }
    }
    this.onPhrase(this.buf.slice(0, at), true, true, this.lead);
    // The next phrase starts a little before the cut, so the word the cut fell in is whole in it (the reader of the
    // two phrases drops it from the first, see QuranSpeech).
    const lead = Math.min(at, Math.round(this.rate * PhraseSplitter.OVERLAP_SEC));
    const rest = this.buf.slice(at - lead, this.length);
    this.length = 0;
    this.append(rest);
    this.lead = lead;
    this.voicedSec = rest.length / this.rate;
    this.sinceUpdate = 0;
  }

  /** The reader is in the middle of a phrase (no pause since it began). */
  get active(): boolean {
    return this.speaking;
  }

  /**
   * Sends the phrase (a pause, or the reader pressed stop). A click or a cough (under 0.25 s of voice) is dropped,
   * but not the rest of a cut phrase (it has the word the cut fell in).
   */
  flush(): void {
    if (this.speaking && (this.voicedSec >= 0.25 || this.lead > 0)) {
      // Up to 0.3 s of the pause stays with the phrase (the end of its last word).
      const tail = Math.max(0, this.silentFor - 0.3);
      this.onPhrase(this.buf.slice(0, Math.max(0, this.length - Math.round(tail * this.rate))), true, false, this.lead);
    }
    this.lead = 0;
    this.length = 0;
    this.speaking = false;
    this.onset = 0;
    this.silentFor = 0;
    this.voicedSec = 0;
  }
}

type WorkerOut = {
  type: string; text?: string; message?: string; id?: number; loaded?: number; total?: number;
  words?: { text: string; start: number; end: number }[]; lp?: Float32Array; frames?: number; vocab?: number;
};

export class QuranSpeech {
  private static worker?: Worker;
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private node?: ScriptProcessorNode;
  private splitter?: PhraseSplitter;
  private meter?: ReturnType<typeof setInterval>;
  private nextId = 1;
  /** Final phrases still being read. */
  private pendingFinals = new Set<number>();
  /** A live (partial) read in flight: only one at a time, and it is dropped once its phrase is final. */
  private partialId = 0;
  private phrase = 0;
  private partialPhrase = -1;
  /** The last phrases kept as one reading (joined, or the last phrase alone), with their audio. */
  private group: { phrases: number[]; audio: Float32Array; cut?: boolean } | null = null;
  private readonly joins = new Map<number, { phrases: number[]; audio: Float32Array; cut?: boolean }>();
  /** Up to this much audio is read as one (the recogniser was trained on single ayat, up to about 15 s). */
  static readonly JOIN_SECONDS = 14;

  static downloaded(): boolean {
    try {
      return localStorage.getItem(DOWNLOADED_KEY) === '1';
    } catch {
      return false;
    }
  }

  private static getWorker(): Worker {
    this.worker ??= new Worker(new URL('./qasr.worker', import.meta.url), { type: 'module' });
    return this.worker;
  }

  private static call(message: object, progress?: (fraction: number) => void): Promise<void> {
    const worker = this.getWorker();
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent<WorkerOut>) => {
        if (e.data.type === 'progress' && e.data.total) progress?.(Math.min(1, (e.data.loaded ?? 0) / e.data.total));
        else if (e.data.type === 'ready') {
          worker.removeEventListener('message', onMessage);
          resolve();
        } else if (e.data.type === 'error' && e.data.id === undefined) {
          worker.removeEventListener('message', onMessage);
          reject(new Error(e.data.message));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage(message);
    });
  }

  /** Downloads (first time) and loads the model; [progress] gets 0..1. */
  static async prepare(progress: (fraction: number) => void): Promise<void> {
    await this.call({ type: 'load' }, progress);
    try {
      localStorage.setItem(DOWNLOADED_KEY, '1');
    } catch {
      /* only the label */
    }
  }

  /** Removes the downloaded model (and the old Whisper model's files, if any). */
  static async remove(): Promise<void> {
    try {
      localStorage.removeItem(DOWNLOADED_KEY);
      localStorage.removeItem('tasmeeWhisperReady');
    } catch {
      /* ignore */
    }
    await this.call({ type: 'remove' }).catch(() => undefined);
    await Promise.all(['transformers-cache', 'tasmee-runtime'].map((c) => caches.delete(c))).catch(() => undefined);
  }

  /** Transcribes 16 kHz audio (tests and checks). */
  static transcribe(audio: Float32Array): Promise<string> {
    const worker = this.getWorker();
    const id = -Math.floor(Math.random() * 1e9) - 1;
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent<WorkerOut>) => {
        if (e.data.id !== id) return;
        worker.removeEventListener('message', onMessage);
        if (e.data.type === 'text') resolve(e.data.text ?? '');
        else reject(new Error(e.data.message));
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'transcribe', id, audio });
    });
  }

  get busy(): boolean {
    return this.pendingFinals.size > 0;
  }

  /** A joined reading of the last phrases is being read (see SpeechCallbacks.onJoin). */
  get joining(): boolean {
    return this.joins.size > 0;
  }

  async start(cb: SpeechCallbacks): Promise<void> {
    const worker = QuranSpeech.getWorker();
    const finals = new Map<number, number>(); // id -> phrase
    const partials = new Map<number, number>();
    const joins = this.joins;
    joins.clear();
    const audioOf = new Map<number, Float32Array>(); // id -> the audio read (kept for the tajweed check)
    const cutOf = new Map<number, boolean>(); // id -> the phrase was cut for its length
    const contextOf = new Map<number, { skip: number; samples: number }>(); // id -> read with this much before it
    const reading = (d: WorkerOut, phrase?: number, audio?: Float32Array, cut?: boolean) => ({
      phrase, words: d.words ?? [], lp: d.lp ?? new Float32Array(0), frames: d.frames ?? 0, vocab: d.vocab ?? 0, audio, cut,
    });
    // A phrase cut for its length: where the next phrase should start (samples of its lead to skip), once it is read.
    let boundary: ReturnType<typeof deferred> | null = null;
    const boundaryOf = new Map<number, ReturnType<typeof deferred>>(); // id of a cut phrase -> its boundary
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const id = e.data.id ?? 0;
      if (joins.has(id)) {
        const join = joins.get(id)!;
        joins.delete(id);
        this.pendingFinals.delete(id);
        const last = join.phrases[join.phrases.length - 1];
        // Kept: the next phrase may be joined to the whole group (if no newer phrase came in the meantime).
        if (e.data.type === 'text' && e.data.text && cb.onJoin?.(e.data.text, reading(e.data, last, join.audio, join.cut), join.phrases)) {
          if (this.group?.phrases[0] === last && this.group.phrases.length === 1) this.group = join;
        }
        if (!this.pendingFinals.size) cb.onPartial('');
      } else if (finals.has(id)) {
        const phrase = finals.get(id)!;
        finals.delete(id);
        this.pendingFinals.delete(id);
        const audio = audioOf.get(id);
        audioOf.delete(id);
        const cut = cutOf.get(id);
        cutOf.delete(id);
        let d = e.data;
        const context = contextOf.get(id);
        contextOf.delete(id);
        if (context) d = trimLead(d, context.skip, context.samples);
        let kept = audio;
        if (cut && audio) {
          // The word the cut fell in is read whole at the start of the next phrase: it is taken off this one, which
          // then ends in the quiet before that word, where the next phrase starts.
          const t = trimCut(d, audio.length);
          d = t.data;
          kept = audio.subarray(0, t.keep);
          if (this.group?.phrases[this.group.phrases.length - 1] === phrase) this.group = { ...this.group, audio: kept };
          boundaryOf.get(id)?.resolve(t.skip);
          boundaryOf.delete(id);
        }
        if (d.type === 'text' && d.text && d.words && d.lp) cb.onFinal(d.text, undefined, reading(d, phrase, kept, cut));
        else if (e.data.type === 'error') cb.onError(e.data.message ?? 'error');
        if (!this.pendingFinals.size) cb.onPartial('');
      } else if (partials.has(id)) {
        const phrase = partials.get(id)!;
        partials.delete(id);
        if (id === this.partialId) this.partialId = 0;
        // Still the phrase being recited: show its words live.
        if (e.data.type === 'text' && phrase === this.phrase && phrase !== this.partialPhrase) cb.onPartial(e.data.text || '…');
      }
    };
    this.stream = await navigator.mediaDevices.getUserMedia({
      // The phone's own noise suppression and gain help in a noisy room; echo cancellation can cut a reciter's voice.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    await this.ctx.resume().catch(() => undefined);
    const source = this.ctx.createMediaStreamSource(this.stream);
    // The microphone (48 kHz on most phones) to the recogniser's 16 kHz as it comes, with a proper low-pass.
    const resampler = new StreamResampler(this.ctx.sampleRate, SAMPLE_RATE);
    this.splitter = new PhraseSplitter((whole, final, cut, lead = 0) => {
      if (final && lead > 0) {
        // The phrase after a cut: it starts where the cut phrase's last whole word ended (known once that is read).
        const id = this.nextId++;
        this.pendingFinals.add(id);
        const wait = boundary?.promise ?? Promise.resolve(lead);
        const mine = cut ? deferred() : null;
        boundary = mine;
        void wait.then((skip) => {
          this.pendingFinals.delete(id);
          // Read from the lead's start, with the words before the cut as context (the model knows a word by the words
          // around it: Husary's «وَيُبَشِّرَ» read alone at a phrase's start was «يوي ر»); those words, already in the
          // cut phrase, are then taken off (trimLead), and the audio kept starts where the cut phrase ends.
          send(whole.slice(Math.min(skip, lead)), cut, mine, whole);
        });
        return;
      }
      if (final) {
        boundary = cut ? deferred() : null;
        send(whole, cut, boundary);
      } else if (!this.partialId && !this.pendingFinals.size) {
        const id = this.nextId++;
        this.partialId = id;
        partials.set(id, this.phrase);
        // A live read only shows the words as they are said: read once, not again where words are missing; the
        // start a phrase has in common with a cut one before it is not shown again.
        worker.postMessage({ type: 'transcribe', id, audio: whole.subarray(lead), quick: true });
      }
    }, SAMPLE_RATE);
    const send = (pcm: Float32Array, cut?: boolean, cutBoundary?: ReturnType<typeof deferred> | null, withContext?: Float32Array) => {
      {
        const id = this.nextId++;
        if (withContext && withContext.length > pcm.length) contextOf.set(id, { skip: withContext.length - pcm.length, samples: withContext.length });
        const phrase = this.phrase;
        finals.set(id, phrase);
        audioOf.set(id, pcm.slice());
        if (cut) cutOf.set(id, true);
        if (cut && cutBoundary) boundaryOf.set(id, cutBoundary);
        this.pendingFinals.add(id);
        this.partialPhrase = phrase; // its live reads are now out of date
        this.phrase++;
        // Also read with the phrases before it, when together they are short enough (see onJoin).
        const before = this.group;
        // Silence between two phrases read as one, except where one was cut mid-speech (it may be mid-word).
        const gap = before?.cut ? 0 : Math.round(SAMPLE_RATE * 0.25);
        this.group = { phrases: [phrase], audio: pcm.slice(), cut };
        // A cut phrase is not joined yet: its last word may be cut in two (it is read whole with the next phrase).
        if (cb.onJoin && before && !cut && before.audio.length + gap + pcm.length <= QuranSpeech.JOIN_SECONDS * SAMPLE_RATE) {
          const audio = new Float32Array(before.audio.length + gap + pcm.length);
          audio.set(before.audio);
          audio.set(pcm, before.audio.length + gap);
          const jid = this.nextId++;
          joins.set(jid, { phrases: [...before.phrases, phrase], audio, cut });
          this.pendingFinals.add(jid);
          worker.postMessage({ type: 'transcribe', id, audio: withContext ?? pcm });
          worker.postMessage({ type: 'transcribe', id: jid, audio: audio.slice() });
          return;
        }
        worker.postMessage({ type: 'transcribe', id, audio: withContext ?? pcm });
      }
    };
    // ScriptProcessor: simple, and needs no extra script file (the app's security policy allows none from blobs).
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => this.splitter?.push(resampler.push(e.inputBuffer.getChannelData(0)));
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
    if (cb.onLevel) this.meter = setInterval(() => cb.onLevel?.(this.splitter?.level ?? 0), 120);
  }

  /** The reader is reciting right now (no pause yet): the phrase is not complete. */
  get speaking(): boolean {
    return this.splitter?.active ?? false;
  }

  async stop(): Promise<void> {
    this.splitter?.flush();
    this.group = null;
    clearInterval(this.meter);
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => undefined);
    this.node = undefined;
    this.ctx = undefined;
    this.stream = undefined;
  }
}

/**
 * A phrase read with [skip] samples of audio before it (the end of the cut phrase before, as context; [samples] in
 * all): the words heard in those samples are taken off, and the rest made to start at [skip] (frames and
 * probabilities from there), as if only the phrase itself had been read.
 */
export function trimLead<T extends { text?: string; words?: { text: string; start: number; end: number }[]; lp?: Float32Array; frames?: number; vocab?: number }>(
  d: T, skip: number, samples: number,
): T {
  const frames = d.frames ?? 0;
  const vocab = d.vocab ?? 0;
  if (!frames || !d.lp || skip <= 0) return d;
  const k = Math.min(frames, Math.round(skip / (samples / frames)));
  // A word begun just before the cut but mostly after it is this phrase's: the phrase before heard only its start, and
  // often as part of the word before (Husary's «كَثِيرًا وَنِسَآءً» cut in «نساء»: «كثيران» there, «ونساء» lost).
  // Heard twice at worst, and a word heard again is not a mistake.
  const words = (d.words ?? [])
    .filter((w) => w.start >= k || w.start + w.end > 2 * k)
    .map((w) => ({ ...w, start: Math.max(0, w.start - k), end: w.end - k }));
  return { ...d, words, text: words.map((w) => w.text).join(' '), frames: frames - k, lp: d.lp.slice(k * vocab) };
}

function deferred(): { promise: Promise<number>; resolve: (n: number) => void } {
  let resolve!: (n: number) => void;
  const promise = new Promise<number>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * A phrase cut for its length, as read: the words it ends with that began in the stretch the next phrase starts with
 * (the last OVERLAP_SEC) are taken off: the last may be cut in two, and the model often writes a word cut in two as
 * several pieces (Husary's «أَيْدِيهِمْ» cut: «ايدي ي ه»), so taking off only the last left the others. The next phrase
 * has them all whole, with the words around them. [keep]: samples of the phrase kept (up to the quiet before the
 * first of them); [skip]: samples of the next phrase's lead to skip, so it starts there.
 */
export function trimCut<T extends { text?: string; words?: { text: string; start: number; end: number }[]; lp?: Float32Array; frames?: number; vocab?: number }>(
  d: T, samples: number, rate = SAMPLE_RATE,
): { data: T; keep: number; skip: number } {
  const lead = Math.min(samples, Math.round(PhraseSplitter.OVERLAP_SEC * rate));
  const from = samples - lead;
  const words = d.words ?? [];
  const frames = d.frames ?? 0;
  if (words.length < 2 || !frames || !d.lp) return { data: d, keep: samples, skip: lead };
  const spf = samples / frames;
  // The first word begun in the next phrase's stretch (one word at least is kept).
  let at = words.length;
  while (at > 1 && words[at - 1].start * spf >= from) at--;
  if (at === words.length) return { data: d, keep: samples, skip: lead };
  const first = words[at];
  const prev = words[at - 1];
  // Just after the word before (not before the next phrase's start): the model hears a word a little after it begins,
  // and a cut halfway to that lost a soft start (Husary's «وَيُبَشِّرَ» read from its «بشر»).
  const keepFrame = Math.max(Math.ceil(from / spf), Math.min(first.start - 1, prev.end + 2));
  const keep = Math.min(samples, Math.round(keepFrame * spf));
  const vocab = d.vocab ?? 0;
  const kept = words.slice(0, at);
  return {
    data: { ...d, words: kept, text: kept.map((w) => w.text).join(' '), frames: keepFrame, lp: d.lp.slice(0, keepFrame * vocab) },
    keep,
    skip: keep - from,
  };
}
