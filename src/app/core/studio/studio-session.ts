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
  /** The app's name, shown with its logo in the video's top corner. */
  brand?: string;
}

/** The app's logo and name, drawn small in the top right corner of videos. */
export interface Brand {
  image: HTMLImageElement;
  name: string;
}

const LOGO = 'assets/studio/logo.png';

/** Loads the logo (null if it cannot: the video is then made without it). */
export function loadBrand(name: string): Promise<Brand | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ image, name });
    image.onerror = () => resolve(null);
    image.src = LOGO;
  });
}

/** Portrait video, the shape phones show full screen (and WhatsApp status, reels): 720p, or 1080p when the camera gives it. */
export const VIDEO_W = 720;
export const VIDEO_H = 1280;
export const VIDEO_W_HD = 1080;
export const VIDEO_H_HD = 1920;

/** Bit rate for a frame size: enough for a sharp picture of a face and a room (what phones' own cameras use). */
export const videoBitrate = (width: number) => (width >= VIDEO_W_HD ? 10_000_000 : 6_000_000);

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
  private brand: Brand | null = null;
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
      if (options.kind === 'video') {
        session.brand = options.brand ? await loadBrand(options.brand) : null;
        await session.startCamera(options.facing);
      }
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
      videoBitsPerSecond: this.canvas ? videoBitrate(this.canvas.width) : undefined,
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
    this.cameraRun++;
    for (const r of this.recorders) if (r.state !== 'inactive') r.stop();
    this.mic.getTracks().forEach((t) => t.stop());
    this.camera?.getTracks().forEach((t) => t.stop());
    this.chain.dispose();
    void this.ctx.close();
  }

  private async startCamera(facing: Facing): Promise<void> {
    // Full HD from the camera: the portrait frame is cut from the middle of a landscape picture, so a 720p camera
    // would leave a 405-pixel-wide strip to blow up (blurry). Falls back to whatever the camera gives.
    const want = { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    this.camera = await navigator.mediaDevices.getUserMedia({ video: want }).catch(() =>
      navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } }),
    );
    const track = this.camera.getVideoTracks()[0];
    // Keep the face sharp and well exposed as the reader moves (where the phone supports it).
    await track
      ?.applyConstraints({ advanced: [{ focusMode: 'continuous', exposureMode: 'continuous', whiteBalanceMode: 'continuous' } as MediaTrackConstraintSet] })
      .catch(() => undefined);
    const video = this.video!;
    video.srcObject = this.camera;
    await video.play();
    // 1080p output when the picture has the detail for it; otherwise 720p (no empty upscaling).
    const canvas = this.canvas!;
    const hd = Math.min(video.videoWidth, video.videoHeight) >= 1000;
    canvas.width = hd ? VIDEO_W_HD : VIDEO_W;
    canvas.height = hd ? VIDEO_H_HD : VIDEO_H;
    cancelAnimationFrame(this.frame);
    const g = canvas.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    const mine = ++this.cameraRun;
    // A weak phone that cannot draw the graded picture in time gets the plain one (smooth video comes first).
    let frames = 0;
    let spent = 0;
    let grade = true;
    const overlay = new Overlay();
    const draw = () => {
      const t0 = performance.now();
      drawFrame(g, video, this.options.facing === 'user', overlay.get(canvas.width, canvas.height, this.caption(), this.brand), grade);
      if (grade && frames < 40) {
        spent += performance.now() - t0;
        if (++frames === 40 && spent / frames > 16) grade = false;
      }
    };
    // Each camera frame drawn once, as it arrives (smooth motion, no doubled or dropped frames); older WebViews: every
    // screen refresh.
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) {
      const onFrame = () => {
        if (mine !== this.cameraRun) return;
        draw();
        v.requestVideoFrameCallback!(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
      draw();
    } else {
      const loop = () => {
        draw();
        this.frame = requestAnimationFrame(loop);
      };
      loop();
    }
  }

  /** Bumped when the camera restarts, so the previous frame loop stops. */
  private cameraRun = 0;
}

/**
 * What is drawn over the picture (the vignette, the logo, the caption), drawn once into its own canvas and pasted
 * on every frame: shadows, gradients and text are slow to draw thirty times a second on a phone without a fast
 * graphics chip, and a busy phone also starves the noise removal of the sound being recorded.
 */
export class Overlay {
  private readonly canvas = document.createElement('canvas');
  private key = '';

  get(width: number, height: number, caption: Caption | null, brand: Brand | null): HTMLCanvasElement {
    const key = `${width}x${height}|${caption?.title ?? ''}|${caption?.text ?? ''}|${brand ? `${brand.name}|${brand.image.complete}` : ''}`;
    if (key !== this.key) {
      this.key = key;
      this.canvas.width = width;
      this.canvas.height = height;
      const g = this.canvas.getContext('2d')!;
      g.clearRect(0, 0, width, height);
      drawVignette(g);
      if (brand) drawBrand(g, brand);
      if (caption) drawCaption(g, caption);
    }
    return this.canvas;
  }
}

/** The camera picture filling the portrait frame (cropped, not stretched), then the overlay (vignette, logo, caption). */
export function drawFrame(g: CanvasRenderingContext2D, video: HTMLVideoElement, mirror: boolean, overlay: CanvasImageSource | null, grade = true): void {
  const { width: W, height: H } = g.canvas;
  const vw = video.videoWidth || W;
  const vh = video.videoHeight || H;
  const scale = Math.max(W / vw, H / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  g.save();
  // The front camera is shown as in a mirror, as people expect to see themselves.
  if (mirror) {
    g.translate(W, 0);
    g.scale(-1, 1);
  }
  // A gentle grade, as video editors do: a touch more contrast and colour, slightly brighter (phones' front cameras
  // look flat and grey indoors).
  if (grade) g.filter = 'contrast(1.06) saturate(1.1) brightness(1.03)';
  g.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
  g.restore();
  if (overlay) g.drawImage(overlay, 0, 0);
}

/**
 * The logo, small and a little transparent, in the top right corner with the app's name beside it: the corner of
 * the frame, above where a reciter's face is, so it never covers them.
 */
export function drawBrand(g: CanvasRenderingContext2D, brand: Brand): void {
  const { width: W } = g.canvas;
  const size = Math.round(W * 0.075);
  const margin = Math.round(W * 0.035);
  const x = W - margin - size;
  const y = margin;
  g.save();
  g.globalAlpha = 0.88;
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = Math.round(size * 0.15);
  const r = size * 0.22;
  g.beginPath();
  g.roundRect(x, y, size, size, r);
  g.fillStyle = '#0F6B5C';
  g.fill();
  g.clip();
  g.drawImage(brand.image, x, y, size, size);
  g.restore();
  g.save();
  g.globalAlpha = 0.9;
  g.font = `600 ${Math.round(size * 0.36)}px system-ui, sans-serif`;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.direction = 'ltr';
  g.fillStyle = '#fff';
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 4;
  g.fillText(brand.name, x - size * 0.22, y + size / 2);
  g.restore();
}

/** Soft dark corners that draw the eye to the reciter. */
function drawVignette(g: CanvasRenderingContext2D): void {
  const { width: W, height: H } = g.canvas;
  const grad = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.45, W / 2, H * 0.45, Math.hypot(W, H) * 0.6);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.save();
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.restore();
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
