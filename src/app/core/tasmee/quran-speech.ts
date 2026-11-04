import { SpeechCallbacks } from '../../native/speech';
import { SAMPLE_RATE, resample } from './qasr-features';

/** The offline Quran recogniser (qasr.worker.ts): download state, and listening in phrases with live words. */

const DOWNLOADED_KEY = 'tasmeeQasrReady';

/**
 * Cuts the microphone into phrases at the reciter's pauses (energy-based voice detection that follows the room's
 * background level), and hands out the phrase so far while it is being recited (for live words).
 */
export class PhraseSplitter {
  private frames: Float32Array[] = [];
  private speaking = false;
  private silentFor = 0;
  private length = 0;
  private floor = -1;
  private sinceUpdate = 0;
  private readonly preRoll: Float32Array[] = [];

  constructor(
    private readonly onPhrase: (audio: Float32Array, final: boolean) => void,
    private readonly rate = SAMPLE_RATE,
    private readonly pauseSec = 0.6,
    private readonly maxSec = 18,
    private readonly updateSec = 1.2,
  ) {}

  /** Input level 0..1 of the last frame (for the microphone meter). */
  level = 0;

  push(frame: Float32Array): void {
    let sum = 0;
    for (const v of frame) sum += v * v;
    const rms = Math.sqrt(sum / frame.length);
    this.level = Math.min(1, rms * 8);
    // The background level follows the quietest moments (quickly down, slowly up); speech is well above it.
    if (this.floor < 0) this.floor = Math.min(rms, 0.01);
    this.floor = rms < this.floor ? this.floor * 0.7 + rms * 0.3 : this.floor * 0.995 + rms * 0.005;
    const voice = rms > Math.max(0.0025, this.floor * 2.5);
    const sec = frame.length / this.rate;
    if (!this.speaking) {
      this.preRoll.push(frame);
      if (this.preRoll.length > Math.ceil(0.35 / sec)) this.preRoll.shift();
      if (!voice) return;
      this.speaking = true;
      this.frames = [...this.preRoll];
      this.length = this.frames.reduce((n, f) => n + f.length, 0);
      this.preRoll.length = 0;
      this.silentFor = 0;
      this.sinceUpdate = 0;
      return;
    }
    this.frames.push(frame);
    this.length += frame.length;
    this.silentFor = voice ? 0 : this.silentFor + sec;
    this.sinceUpdate += sec;
    const seconds = this.length / this.rate;
    if ((this.silentFor >= this.pauseSec && seconds >= 0.6) || seconds >= this.maxSec) this.flush();
    else if (this.sinceUpdate >= this.updateSec && this.silentFor < this.pauseSec) {
      this.sinceUpdate = 0;
      this.onPhrase(this.joined(), false);
    }
  }

  private joined(): Float32Array {
    const out = new Float32Array(this.length);
    let at = 0;
    for (const f of this.frames) {
      out.set(f, at);
      at += f.length;
    }
    return out;
  }

  /** Sends the phrase (a pause, or the reader pressed stop). */
  flush(): void {
    if (this.speaking && this.length / this.rate >= 0.4) this.onPhrase(this.joined(), true);
    this.frames = [];
    this.length = 0;
    this.speaking = false;
    this.silentFor = 0;
  }
}

type WorkerOut = { type: string; text?: string; message?: string; id?: number; loaded?: number; total?: number };

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

  async start(cb: SpeechCallbacks): Promise<void> {
    const worker = QuranSpeech.getWorker();
    const finals = new Map<number, number>(); // id -> phrase
    const partials = new Map<number, number>();
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const id = e.data.id ?? 0;
      if (finals.has(id)) {
        finals.delete(id);
        this.pendingFinals.delete(id);
        if (e.data.type === 'text' && e.data.text) cb.onFinal(e.data.text);
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
    const rate = this.ctx.sampleRate;
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.splitter = new PhraseSplitter((audio, final) => {
      const pcm = resample(audio, rate, SAMPLE_RATE);
      if (final) {
        const id = this.nextId++;
        finals.set(id, this.phrase);
        this.pendingFinals.add(id);
        this.partialPhrase = this.phrase; // its live reads are now out of date
        this.phrase++;
        worker.postMessage({ type: 'transcribe', id, audio: pcm }, [pcm.buffer]);
      } else if (!this.partialId && !this.pendingFinals.size) {
        const id = this.nextId++;
        this.partialId = id;
        partials.set(id, this.phrase);
        worker.postMessage({ type: 'transcribe', id, audio: pcm }, [pcm.buffer]);
      }
    }, rate);
    // ScriptProcessor: simple, and needs no extra script file (the app's security policy allows none from blobs).
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => this.splitter?.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
    if (cb.onLevel) this.meter = setInterval(() => cb.onLevel?.(this.splitter?.level ?? 0), 120);
  }

  async stop(): Promise<void> {
    this.splitter?.flush();
    clearInterval(this.meter);
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => undefined);
    this.node = undefined;
    this.ctx = undefined;
    this.stream = undefined;
  }
}
