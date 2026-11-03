import { SpeechCallbacks } from '../../native/speech';

/** Tarteel's Whisper on the phone: download state, and listening in phrases (see whisper.worker.ts). */

const RATE = 16000;
const DOWNLOADED_KEY = 'tasmeeWhisperReady';

/** Splits the microphone into phrases at the reciter's pauses (energy-based voice detection). */
export class PhraseSplitter {
  private frames: Float32Array[] = [];
  private speaking = false;
  private silentFor = 0;
  private length = 0;
  private floor = 0.004;
  private readonly preRoll: Float32Array[] = [];

  constructor(
    private readonly onPhrase: (audio: Float32Array) => void,
    private readonly rate = RATE,
    private readonly pauseSec = 0.7,
    private readonly maxSec = 20,
  ) {}

  push(frame: Float32Array): void {
    let sum = 0;
    for (const v of frame) sum += v * v;
    const rms = Math.sqrt(sum / frame.length);
    // The background level follows the quietest moments; speech is well above it.
    this.floor = rms < this.floor ? rms : this.floor * 0.999 + rms * 0.001;
    const voice = rms > Math.max(0.012, this.floor * 3);
    const sec = frame.length / this.rate;
    if (!this.speaking) {
      this.preRoll.push(frame);
      if (this.preRoll.length > Math.ceil(0.3 / sec)) this.preRoll.shift();
      if (!voice) return;
      this.speaking = true;
      this.frames = [...this.preRoll];
      this.length = this.frames.reduce((n, f) => n + f.length, 0);
      this.preRoll.length = 0;
      this.silentFor = 0;
      return;
    }
    this.frames.push(frame);
    this.length += frame.length;
    this.silentFor = voice ? 0 : this.silentFor + sec;
    if ((this.silentFor >= this.pauseSec && this.length / this.rate >= 0.8) || this.length / this.rate >= this.maxSec) this.flush();
  }

  /** Sends what is left (the reader pressed stop). */
  flush(): void {
    if (this.speaking && this.length / this.rate >= 0.5) {
      const out = new Float32Array(this.length);
      let at = 0;
      for (const f of this.frames) {
        out.set(f, at);
        at += f.length;
      }
      this.onPhrase(out);
    }
    this.frames = [];
    this.length = 0;
    this.speaking = false;
    this.silentFor = 0;
  }
}

export class WhisperSpeech {
  private static worker?: Worker;
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private node?: ScriptProcessorNode;
  private splitter?: PhraseSplitter;
  private nextId = 1;
  private pending = 0;
  private cb?: SpeechCallbacks;

  static downloaded(): boolean {
    try {
      return localStorage.getItem(DOWNLOADED_KEY) === '1';
    } catch {
      return false;
    }
  }

  private static getWorker(): Worker {
    this.worker ??= new Worker(new URL('./whisper.worker', import.meta.url), { type: 'module' });
    return this.worker;
  }

  /** Downloads (first time) and loads the model; [progress] gets 0..1. */
  static prepare(progress: (fraction: number) => void): Promise<void> {
    const worker = this.getWorker();
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent<{ type: string; loaded?: number; total?: number; message?: string }>) => {
        if (e.data.type === 'progress' && e.data.total) progress(Math.min(1, (e.data.loaded ?? 0) / e.data.total));
        else if (e.data.type === 'ready') {
          worker.removeEventListener('message', onMessage);
          try {
            localStorage.setItem(DOWNLOADED_KEY, '1');
          } catch {
            /* only the label */
          }
          resolve();
        } else if (e.data.type === 'error' && e.data.message !== undefined) {
          worker.removeEventListener('message', onMessage);
          reject(new Error(e.data.message));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'load' });
    });
  }

  /** Removes the downloaded model and runtime. */
  static async remove(): Promise<void> {
    try {
      localStorage.removeItem(DOWNLOADED_KEY);
    } catch {
      /* ignore */
    }
    await Promise.all([caches.delete('transformers-cache'), caches.delete('tasmee-runtime')]).catch(() => undefined);
    this.worker?.terminate();
    this.worker = undefined;
  }

  get busy(): boolean {
    return this.pending > 0;
  }

  async start(cb: SpeechCallbacks): Promise<void> {
    this.cb = cb;
    const worker = WhisperSpeech.getWorker();
    worker.onmessage = (e: MessageEvent<{ type: string; text?: string; message?: string; id?: number }>) => {
      if (e.data.type === 'text') {
        this.pending--;
        if (e.data.text) cb.onFinal(e.data.text);
        cb.onPartial('');
      } else if (e.data.type === 'error' && e.data.id) {
        this.pending--;
        cb.onError(e.data.message ?? 'error');
      }
    };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext({ sampleRate: RATE });
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.splitter = new PhraseSplitter((audio) => {
      this.pending++;
      // While the phrase is being read, show that it was heard.
      cb.onPartial('…');
      worker.postMessage({ type: 'transcribe', id: this.nextId++, audio }, [audio.buffer]);
    });
    // ScriptProcessor: simple, and needs no extra script file (the app's security policy allows none from blobs).
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => this.splitter?.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  async stop(): Promise<void> {
    this.splitter?.flush();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => undefined);
    this.node = undefined;
    this.ctx = undefined;
    this.stream = undefined;
  }
}
