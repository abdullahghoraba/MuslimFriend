import { SpeechCallbacks } from '../../native/speech';
import { SAMPLE_RATE, StreamResampler } from './qasr-features';

/** The offline Quran recogniser (qasr.worker.ts): download state, and listening in phrases with live words. */

const DOWNLOADED_KEY = 'tasmeeQasrReady';

/**
 * Cuts the microphone into phrases at the reciter's pauses, and hands out the phrase so far while it is being
 * recited (for live words). The recogniser needs this: it was trained on one ayah at a time, so it reads a phrase
 * best, writes words said twice in one stretch of audio only once, and loses words in very long stretches.
 *
 * Voice detection works on 20 ms frames against the room's background level, measured as the quietest tenth of the
 * last 8 seconds (so speech from the very first moment, a fan or traffic do not raise it), with a fixed level for the
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
  private readonly history = new Float32Array(400);
  private historyCount = 0;
  private floorValue = 0;
  private sinceFloor = 0;
  /** Level of the recitation (slowly falling peak of the voiced frames). */
  private speech = 0;
  /** Samples of the current 20 ms frame. */
  private readonly frame: Float32Array;
  private frameFill = 0;
  /** Audio kept from before speech starts. */
  private readonly preRoll: Float32Array;
  private preFill = 0;

  /** Input level 0..1 (for the microphone meter). */
  level = 0;

  constructor(
    private readonly onPhrase: (audio: Float32Array, final: boolean) => void,
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
      this.floorValue = sorted[Math.floor(n * 0.1)];
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
    // A hiss (breath, a fricative on its own) counts only when it is about as loud as the recitation.
    const voice = loud && (crossingsPerSec < PhraseSplitter.HISS || rms > this.speech * 0.35);
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
      this.onPhrase(this.buf.slice(0, this.length), false);
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

  /** A long phrase without a pause: sends it up to its quietest 100 ms in the last 4 s, and keeps the rest. */
  private cutLong(): void {
    const win = Math.round(this.rate * 0.1);
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
    this.onPhrase(this.buf.slice(0, at), true);
    const rest = this.buf.slice(at, this.length);
    this.length = 0;
    this.append(rest);
    this.voicedSec = rest.length / this.rate;
    this.sinceUpdate = 0;
  }

  /** Sends the phrase (a pause, or the reader pressed stop). A click or a cough (under 0.25 s of voice) is dropped. */
  flush(): void {
    if (this.speaking && this.voicedSec >= 0.25) {
      // Up to 0.3 s of the pause stays with the phrase (the end of its last word).
      const tail = Math.max(0, this.silentFor - 0.3);
      this.onPhrase(this.buf.slice(0, Math.max(0, this.length - Math.round(tail * this.rate))), true);
    }
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
  private group: { phrases: number[]; audio: Float32Array } | null = null;
  private readonly joins = new Map<number, { phrases: number[]; audio: Float32Array }>();
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
    const reading = (d: WorkerOut, phrase?: number) => ({ phrase, words: d.words ?? [], lp: d.lp ?? new Float32Array(0), frames: d.frames ?? 0, vocab: d.vocab ?? 0 });
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const id = e.data.id ?? 0;
      if (joins.has(id)) {
        const join = joins.get(id)!;
        joins.delete(id);
        this.pendingFinals.delete(id);
        const last = join.phrases[join.phrases.length - 1];
        // Kept: the next phrase may be joined to the whole group (if no newer phrase came in the meantime).
        if (e.data.type === 'text' && e.data.text && cb.onJoin?.(e.data.text, reading(e.data, last), join.phrases)) {
          if (this.group?.phrases[0] === last && this.group.phrases.length === 1) this.group = join;
        }
        if (!this.pendingFinals.size) cb.onPartial('');
      } else if (finals.has(id)) {
        const phrase = finals.get(id)!;
        finals.delete(id);
        this.pendingFinals.delete(id);
        if (e.data.type === 'text' && e.data.text && e.data.words && e.data.lp) cb.onFinal(e.data.text, undefined, reading(e.data, phrase));
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
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    await this.ctx.resume().catch(() => undefined);
    const source = this.ctx.createMediaStreamSource(this.stream);
    // The microphone (48 kHz on most phones) to the recogniser's 16 kHz as it comes, with a proper low-pass.
    const resampler = new StreamResampler(this.ctx.sampleRate, SAMPLE_RATE);
    this.splitter = new PhraseSplitter((pcm, final) => {
      if (final) {
        const id = this.nextId++;
        const phrase = this.phrase;
        finals.set(id, phrase);
        this.pendingFinals.add(id);
        this.partialPhrase = phrase; // its live reads are now out of date
        this.phrase++;
        // Also read with the phrases before it, when together they are short enough (see onJoin).
        const gap = Math.round(SAMPLE_RATE * 0.25);
        const before = this.group;
        this.group = { phrases: [phrase], audio: pcm.slice() };
        if (cb.onJoin && before && before.audio.length + gap + pcm.length <= QuranSpeech.JOIN_SECONDS * SAMPLE_RATE) {
          const audio = new Float32Array(before.audio.length + gap + pcm.length);
          audio.set(before.audio);
          audio.set(pcm, before.audio.length + gap);
          const jid = this.nextId++;
          joins.set(jid, { phrases: [...before.phrases, phrase], audio });
          this.pendingFinals.add(jid);
          worker.postMessage({ type: 'transcribe', id, audio: pcm }, [pcm.buffer]);
          worker.postMessage({ type: 'transcribe', id: jid, audio: audio.slice() });
          return;
        }
        worker.postMessage({ type: 'transcribe', id, audio: pcm }, [pcm.buffer]);
      } else if (!this.partialId && !this.pendingFinals.size) {
        const id = this.nextId++;
        this.partialId = id;
        partials.set(id, this.phrase);
        worker.postMessage({ type: 'transcribe', id, audio: pcm }, [pcm.buffer]);
      }
    }, SAMPLE_RATE);
    // ScriptProcessor: simple, and needs no extra script file (the app's security policy allows none from blobs).
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => this.splitter?.push(resampler.push(e.inputBuffer.getChannelData(0)));
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
    if (cb.onLevel) this.meter = setInterval(() => cb.onLevel?.(this.splitter?.level ?? 0), 120);
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
