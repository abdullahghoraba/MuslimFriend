import { ChainOptions, RecitationChain, pickMimeType } from './audio-chain';

/** Where a recording's bytes go while it is being made: a file on the phone, or memory in the browser. */
export interface ChunkSink {
  write(chunk: Blob): void;
  /** Resolves when every chunk is stored. */
  close(): Promise<void>;
}

/** What the video shows over the picture: the sura's name and the ayah being recited. */
export interface Caption {
  title: string;
  text: string;
}

export type Facing = 'user' | 'environment';

export interface SessionOptions extends ChainOptions {
  kind: 'audio' | 'video';
  facing: Facing;
}

/** Portrait video, the shape phones show full screen (and WhatsApp status, reels). */
export const VIDEO_W = 720;
export const VIDEO_H = 1280;

/**
 * One recording session: the microphone (and camera) with the sound chain, a live preview, and the recorders.
 * Audio sessions also keep the untouched microphone sound so the reader can compare before and after.
 */
export class StudioSession {
  readonly ctx: AudioContext;
  readonly chain: RecitationChain;
  readonly mime: string;
  /** Video: the canvas the picture and caption are drawn on (also the preview). */
  readonly canvas?: HTMLCanvasElement;
  rawMime = '';

  private camera?: MediaStream;
  private readonly video?: HTMLVideoElement;
  private frame = 0;
  private recorders: MediaRecorder[] = [];
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;

  private constructor(
    private readonly options: SessionOptions,
    private readonly mic: MediaStream,
    ctx: AudioContext,
    chain: RecitationChain,
    private readonly caption: () => Caption | null,
  ) {
    this.ctx = ctx;
    this.chain = chain;
    this.mime = pickMimeType(options.kind, (t) => MediaRecorder.isTypeSupported(t));
    if (options.kind === 'video') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = VIDEO_W;
      this.canvas.height = VIDEO_H;
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
    }
  }

  /** Asks for the microphone (and camera); throws the browser's error when the reader refuses. */
  static async open(options: SessionOptions, caption: () => Caption | null): Promise<StudioSession> {
    // The phone's own processing is turned off: the chain does it better for a reciting voice (echo cancellation
    // and automatic gain cut the long vowels and the endings of the ayat).
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: options.denoise === 'off' ? false : true, channelCount: 1 },
    });
    try {
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      const chain = await RecitationChain.create(ctx, ctx.createMediaStreamSource(mic), options);
      const session = new StudioSession(options, mic, ctx, chain, caption);
      if (options.kind === 'video') await session.startCamera(options.facing);
      return session;
    } catch (e) {
      mic.getTracks().forEach((t) => t.stop());
      throw e;
    }
  }

  get kind(): 'audio' | 'video' {
    return this.options.kind;
  }

  get facing(): Facing {
    return this.options.facing;
  }

  get recording(): boolean {
    return this.recorders.some((r) => r.state !== 'inactive');
  }

  get paused(): boolean {
    return this.recorders.some((r) => r.state === 'paused');
  }

  /** Seconds recorded so far (pauses excluded). */
  elapsed(): number {
    if (!this.startedAt) return 0;
    const now = this.pausedAt || performance.now();
    return Math.max(0, (now - this.startedAt - this.pausedTotal) / 1000);
  }

  async switchCamera(): Promise<void> {
    if (this.options.kind !== 'video') return;
    this.options.facing = this.options.facing === 'user' ? 'environment' : 'user';
    this.camera?.getTracks().forEach((t) => t.stop());
    await this.startCamera(this.options.facing);
  }

  /** Starts recording into [sink] (and the untouched sound into [rawSink], audio sessions only). */
  start(sink: ChunkSink, rawSink?: ChunkSink): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const tracks = [...this.chain.output.stream.getAudioTracks()];
    if (this.canvas) tracks.push(...this.canvas.captureStream(30).getVideoTracks());
    const main = new MediaRecorder(new MediaStream(tracks), {
      mimeType: this.mime || undefined,
      audioBitsPerSecond: 192_000,
      videoBitsPerSecond: this.canvas ? 4_000_000 : undefined,
    });
    this.recorders = [main];
    main.ondataavailable = (e) => e.data.size && sink.write(e.data);
    if (rawSink && this.options.kind === 'audio') {
      this.rawMime = pickMimeType('audio', (t) => MediaRecorder.isTypeSupported(t));
      const raw = new MediaRecorder(this.mic, { mimeType: this.rawMime || undefined, audioBitsPerSecond: 128_000 });
      raw.ondataavailable = (e) => e.data.size && rawSink.write(e.data);
      this.recorders.push(raw);
    }
    // A chunk every second goes straight to storage, so a long recitation never sits in memory.
    for (const r of this.recorders) r.start(1000);
    this.startedAt = performance.now();
    this.pausedAt = 0;
    this.pausedTotal = 0;
  }

  pause(): void {
    for (const r of this.recorders) if (r.state === 'recording') r.pause();
    this.pausedAt = performance.now();
  }

  resume(): void {
    for (const r of this.recorders) if (r.state === 'paused') r.resume();
    if (this.pausedAt) this.pausedTotal += performance.now() - this.pausedAt;
    this.pausedAt = 0;
  }

  /** Stops the recorders; resolves with the length in seconds once the last chunks are handed over. */
  async stop(): Promise<number> {
    const seconds = this.elapsed();
    await Promise.all(
      this.recorders.map((r) => new Promise<void>((resolve) => {
        if (r.state === 'inactive') return resolve();
        r.addEventListener('stop', () => resolve(), { once: true });
        r.stop();
      })),
    );
    this.recorders = [];
    this.startedAt = 0;
    return seconds;
  }

  /** Releases the microphone and camera. */
  close(): void {
    cancelAnimationFrame(this.frame);
    for (const r of this.recorders) if (r.state !== 'inactive') r.stop();
    this.mic.getTracks().forEach((t) => t.stop());
    this.camera?.getTracks().forEach((t) => t.stop());
    this.chain.dispose();
    void this.ctx.close();
  }

  private async startCamera(facing: Facing): Promise<void> {
    this.camera = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    const video = this.video!;
    video.srcObject = this.camera;
    await video.play();
    cancelAnimationFrame(this.frame);
    const g = this.canvas!.getContext('2d')!;
    const draw = () => {
      drawFrame(g, video, this.options.facing === 'user', this.caption());
      this.frame = requestAnimationFrame(draw);
    };
    draw();
  }
}

/** The camera picture filling the portrait frame (cropped, not stretched), then the caption over its foot. */
export function drawFrame(g: CanvasRenderingContext2D, video: HTMLVideoElement, mirror: boolean, caption: Caption | null): void {
  const { width: W, height: H } = g.canvas;
  const vw = video.videoWidth || W;
  const vh = video.videoHeight || H;
  const scale = Math.max(W / vw, H / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  g.save();
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  // The front camera is shown as in a mirror, as people expect to see themselves.
  if (mirror) {
    g.translate(W, 0);
    g.scale(-1, 1);
  }
  g.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
  g.restore();
  if (caption) drawCaption(g, caption);
}

/** A dark band at the foot of the frame with the ayah (wrapped, centred, right to left) and the sura's name. */
export function drawCaption(g: CanvasRenderingContext2D, caption: Caption): void {
  const { width: W, height: H } = g.canvas;
  const pad = Math.round(W * 0.05);
  const size = Math.round(W * 0.052);
  g.save();
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.font = `${size}px AmiriQuran, Amiri, serif`;
  const lines = wrapText((t) => g.measureText(t).width, caption.text, W - 2 * pad).slice(0, 5);
  const lineH = size * 1.9;
  const band = lines.length * lineH + size * 2.4;
  const top = H - band - H * 0.04;
  const grad = g.createLinearGradient(0, top - size, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.18, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.fillStyle = grad;
  g.fillRect(0, top - size, W, H - top + size);
  g.fillStyle = '#fff';
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 6;
  lines.forEach((line, i) => g.fillText(line, W / 2, top + size * 1.2 + i * lineH));
  g.font = `${Math.round(size * 0.62)}px Amiri, serif`;
  g.fillStyle = '#e0c27a';
  g.fillText(caption.title, W / 2, top + size * 1.2 + lines.length * lineH);
  g.restore();
}

/** Splits [text] into lines no wider than [max] (by whole words). */
export function wrapText(measure: (s: string) => number, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
