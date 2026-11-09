// The noise models are loaded only when the studio opens (they extend AudioWorkletNode, which must exist first).
const noiseLib = () => import('@sapphi-red/web-noise-suppressor');

/**
 * The recitation sound chain, built with the Web Audio API on the phone (nothing is uploaded):
 *
 *   mic -> input fade -> high-pass (hum, handling noise) -> noise removal -> gate -> voice EQ -> compressor -> voice level
 *       -> + reverb (+ the delayed echo of a large mosque's loudspeakers) -> limiter -> master fade -> out
 *
 * Noise removal is a small neural network running in an AudioWorklet: GTCRN ("strong", the default) or RNNoise
 * ("light"), both open source (github.com/sapphi-red/web-noise-suppressor, MIT). After it, a gate (our own
 * worklet, assets/studio/gate-processor.js) turns down by 24 dB what is left of the noise between words and ayat,
 * before the compressor would bring it back up: real rooms leave some noise even after the network. The reverb is
 * generated here (no samples to download): a short room, a hall, the long tail of a large mosque, or "haram": the
 * Masjid al-Haram sound, a very large space whose distant loudspeakers send the voice back as soft delayed echoes.
 * The input and master fades make clean starts and endings: a recording fades in, and on stop the microphone is
 * muted (no tap of the button) while the last word and its reverb ring out before the sound fades away.
 */

export type Denoise = 'off' | 'light' | 'strong';
export type Reverb = 'none' | 'room' | 'hall' | 'mosque' | 'haram';

export interface ChainOptions {
  denoise: Denoise;
  reverb: Reverb;
  /** Voice level in dB (0 = the default make-up gain). */
  voiceDb?: number;
  /** Reverb amount: 1 = the preset's own level, 0 = none, up to 1.5. */
  reverbAmount?: number;
  /** Clarity: the presence boost in dB (default 3). */
  clarityDb?: number;
}

export const VOICE_DB = { min: -6, max: 9 };
export const REVERB_AMOUNT = { min: 0, max: 1.5 };
export const CLARITY_DB = { min: 0, max: 6 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Length (s), decay and wet level of each reverb. */
export const REVERBS: Record<Exclude<Reverb, 'none'>, { seconds: number; decay: number; wet: number; preDelay: number }> = {
  room: { seconds: 0.8, decay: 4, wet: 0.16, preDelay: 0.008 },
  hall: { seconds: 2.0, decay: 3, wet: 0.22, preDelay: 0.02 },
  mosque: { seconds: 3.6, decay: 2.4, wet: 0.3, preDelay: 0.035 },
  haram: { seconds: 5, decay: 2.2, wet: 0.32, preDelay: 0.06 },
};

/** The loudspeaker echo of "haram": a soft repeat a little over a quarter second later, darker each time. */
export const HARAM_ECHO = { delay: 0.27, feedback: 0.28, wet: 0.14, lowpass: 3200 };

/** How long the sound keeps running after stop: the chain's own delay plus most of the reverb's tail, at most 3.5 s. */
export function tailSeconds(reverb: Reverb): number {
  return reverb === 'none' ? 0.6 : Math.min(3.5, 0.6 + REVERBS[reverb].seconds * 0.55);
}

/** The default make-up gain after the compressor. */
const MAKEUP = 1.7;

/** Where the worklets and models are served from (copied from the package by angular.json). */
const NOISE = 'assets/noise';

const wasm = new Map<string, Promise<ArrayBuffer>>();
const once = (key: string, load: () => Promise<ArrayBuffer>) => {
  if (!wasm.has(key)) wasm.set(key, load().catch((e) => { wasm.delete(key); throw e; }));
  return wasm.get(key)!;
};

/**
 * A stereo impulse response: [preDelay] of silence, a few early reflections, then noise fading out exponentially
 * ([decay] higher = shorter tail). [random] is injectable for tests.
 */
export function makeImpulse(rate: number, seconds: number, decay: number, preDelay: number, random = Math.random): Float32Array<ArrayBuffer>[] {
  const length = Math.max(1, Math.round(rate * seconds));
  const start = Math.round(rate * preDelay);
  const reflections = [0.011, 0.019, 0.027, 0.041].map((t) => start + Math.round(rate * t));
  return [0, 1].map((ch) => {
    const data = new Float32Array(length);
    for (let i = start; i < length; i++) {
      const t = (i - start) / (length - start);
      data[i] = (random() * 2 - 1) * Math.pow(1 - t, decay);
    }
    reflections.forEach((at, k) => {
      if (at < length) data[at] += (ch === k % 2 ? 0.5 : 0.35) / (k + 1);
    });
    return data;
  });
}

/** The first type MediaRecorder can write, preferring MP4 (plays everywhere, WhatsApp included) over WebM. */
export function pickMimeType(kind: 'audio' | 'video', supported: (type: string) => boolean): string {
  const audio = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  const video = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return (kind === 'audio' ? audio : video).find((t) => supported(t)) ?? '';
}

export function extensionFor(mime: string): string {
  if (mime.startsWith('audio/mp4')) return 'm4a';
  if (mime.startsWith('video/mp4')) return 'mp4';
  if (mime.startsWith('audio/ogg')) return 'ogg';
  return 'webm';
}

export class RecitationChain {
  /** The processed sound, to record. */
  readonly output: MediaStreamAudioDestinationNode;
  /** Level of the processed sound, for the meter. */
  readonly meter: AnalyserNode;
  /** Which noise removal actually runs (strong falls back to light if its model cannot load). */
  denoise: Denoise = 'off';

  private readonly nodes: AudioNode[] = [];
  private denoiser?: AudioWorkletNode & { destroy?: () => void };
  private readonly wet: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly preDenoise: AudioNode;
  /** Where the denoised sound goes in: the gate (with noise removal on), else straight to the EQ. */
  private readonly postDenoise: GainNode;
  private readonly eq: AudioNode;
  private gate?: AudioWorkletNode;
  private readonly input: GainNode;
  private readonly master: GainNode;
  private readonly makeup: GainNode;
  private readonly presence: BiquadFilterNode;
  private readonly echoWet: GainNode;
  private reverb: Reverb = 'none';
  /** The reverb in use (it sets how long a recording rings out after stop). */
  get reverbPreset(): Reverb {
    return this.reverb;
  }
  private reverbAmount = 1;

  private constructor(private readonly ctx: AudioContext, source: AudioNode) {
    this.input = new GainNode(ctx, { gain: 1 });
    const highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 80, Q: 0.7 });
    // Voice EQ: a little less boom, a little more presence and air, as engineers do for recitation.
    const mud = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 250, Q: 1, gain: -2 });
    const presence = (this.presence = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 3500, Q: 0.9, gain: 3 }));
    const air = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 10000, gain: 2 });
    // Evens out loud and soft passages so the whole recitation is clear without riding the volume.
    const compressor = new DynamicsCompressorNode(ctx, { threshold: -22, knee: 8, ratio: 3, attack: 0.006, release: 0.25 });
    const makeup = (this.makeup = new GainNode(ctx, { gain: MAKEUP }));
    const dry = new GainNode(ctx, { gain: 1 });
    this.wet = new GainNode(ctx, { gain: 0 });
    this.convolver = new ConvolverNode(ctx);
    // Keeps peaks from clipping after the make-up gain and the reverb.
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
    this.master = new GainNode(ctx, { gain: 1 });
    // The echo: delay -> darker -> back into the delay (feedback), mixed in softly.
    const delay = new DelayNode(ctx, { delayTime: HARAM_ECHO.delay, maxDelayTime: 1 });
    const dark = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: HARAM_ECHO.lowpass, Q: 0.5 });
    const feedback = new GainNode(ctx, { gain: HARAM_ECHO.feedback });
    this.echoWet = new GainNode(ctx, { gain: 0 });
    this.output = new MediaStreamAudioDestinationNode(ctx, { channelCount: 2 });
    this.meter = new AnalyserNode(ctx, { fftSize: 1024 });

    source.connect(this.input).connect(highpass);
    this.preDenoise = highpass;
    this.postDenoise = new GainNode(ctx, { gain: 1 });
    this.eq = mud;
    highpass.connect(this.postDenoise).connect(mud);
    mud.connect(presence).connect(air).connect(compressor).connect(makeup);
    makeup.connect(dry).connect(limiter);
    makeup.connect(this.convolver).connect(this.wet).connect(limiter);
    makeup.connect(delay).connect(dark).connect(this.echoWet).connect(limiter);
    dark.connect(feedback).connect(delay);
    limiter.connect(this.master);
    this.master.connect(this.output);
    this.master.connect(this.meter);
    this.nodes.push(this.input, highpass, this.postDenoise, mud, presence, air, compressor, makeup, dry, this.wet, this.convolver,
      delay, dark, feedback, this.echoWet, limiter, this.master);
  }

  /** Builds the chain on [source] (a microphone) with [options]. */
  static async create(ctx: AudioContext, source: AudioNode, options: ChainOptions): Promise<RecitationChain> {
    const chain = new RecitationChain(ctx, source);
    await chain.setDenoise(options.denoise);
    chain.setVoice(options.voiceDb ?? 0);
    chain.setClarity(options.clarityDb ?? 3);
    chain.setReverbAmount(options.reverbAmount ?? 1);
    chain.setReverb(options.reverb);
    return chain;
  }

  /** Swaps the noise removal (can change between takes). */
  async setDenoise(level: Denoise): Promise<void> {
    let node: (AudioWorkletNode & { destroy?: () => void }) | undefined;
    let actual: Denoise = 'off';
    if (level !== 'off' && this.ctx.audioWorklet) {
      if (level === 'strong') {
        try {
          const { GtcrnWorkletNode, loadGtcrn } = await noiseLib();
          const binary = await once('gtcrn', () => loadGtcrn({ url: `${NOISE}/gtcrn.wasm` }));
          await this.ctx.audioWorklet.addModule(`${NOISE}/gtcrn/workletProcessor.js`);
          node = new GtcrnWorkletNode(this.ctx, { maxChannels: 1, wasmBinary: binary });
          actual = 'strong';
        } catch {
          /* falls back to the lighter model */
        }
      }
      if (!node) {
        try {
          const { RnnoiseWorkletNode, loadRnnoise } = await noiseLib();
          const binary = await once('rnnoise', () => loadRnnoise({ url: `${NOISE}/rnnoise.wasm`, simdUrl: `${NOISE}/rnnoise_simd.wasm` }));
          await this.ctx.audioWorklet.addModule(`${NOISE}/rnnoise/workletProcessor.js`);
          node = new RnnoiseWorkletNode(this.ctx, { maxChannels: 1, wasmBinary: binary });
          actual = 'light';
        } catch {
          /* no worklet: the sound passes through unchanged */
        }
      }
    }
    this.preDenoise.disconnect();
    if (this.denoiser) {
      this.denoiser.disconnect();
      this.denoiser.destroy?.();
    }
    this.denoiser = node;
    if (node) this.preDenoise.connect(node).connect(this.postDenoise);
    else this.preDenoise.connect(this.postDenoise);
    this.denoise = actual;
    await this.setGate(actual !== 'off');
  }

  /** The gate after the noise removal (only with noise removal on: "off" leaves the sound as it is). */
  private async setGate(on: boolean): Promise<void> {
    if (on && !this.gate && this.ctx.audioWorklet) {
      try {
        await this.ctx.audioWorklet.addModule('assets/studio/gate-processor.js');
        this.gate = new AudioWorkletNode(this.ctx, 'studio-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      } catch {
        /* without the gate the chain still works */
      }
    }
    this.postDenoise.disconnect();
    this.gate?.disconnect();
    if (on && this.gate) this.postDenoise.connect(this.gate).connect(this.eq);
    else this.postDenoise.connect(this.eq);
  }

  setReverb(reverb: Reverb): void {
    if (reverb !== 'none' && reverb !== this.reverb) {
      const r = REVERBS[reverb];
      const channels = makeImpulse(this.ctx.sampleRate, r.seconds, r.decay, r.preDelay);
      const buffer = this.ctx.createBuffer(2, channels[0].length, this.ctx.sampleRate);
      channels.forEach((data, ch) => buffer.copyToChannel(data, ch));
      this.convolver.buffer = buffer;
    }
    this.reverb = reverb;
    this.applyWet();
  }

  /** How much reverb (and echo) is mixed in: 1 = the preset's level. */
  setReverbAmount(amount: number): void {
    this.reverbAmount = clamp(amount, REVERB_AMOUNT.min, REVERB_AMOUNT.max);
    this.applyWet();
  }

  /** The voice's level after the compressor, in dB around the default. */
  setVoice(db: number): void {
    const gain = MAKEUP * Math.pow(10, clamp(db, VOICE_DB.min, VOICE_DB.max) / 20);
    this.makeup.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);
  }

  /** Clarity: how much the presence band (where the letters are understood) is lifted. */
  setClarity(db: number): void {
    this.presence.gain.setTargetAtTime(clamp(db, CLARITY_DB.min, CLARITY_DB.max), this.ctx.currentTime, 0.05);
  }

  /** Fades the microphone in (a recording starts) or out (stop or pause: the button's tap is not recorded). */
  fadeInput(on: boolean, seconds = 0.08): void {
    const g = this.input.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(on ? 1 : 0, now + seconds);
  }

  /** Fades everything that is recorded: out at the end of a recording (after its tail), back in for the next one. */
  fadeMaster(on: boolean, seconds: number): void {
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(on ? 0 : g.value, now);
    g.linearRampToValueAtTime(on ? 1 : 0, now + seconds);
  }

  private applyWet(): void {
    const now = this.ctx.currentTime;
    const wet = this.reverb === 'none' ? 0 : REVERBS[this.reverb].wet * this.reverbAmount;
    this.wet.gain.setTargetAtTime(wet, now, 0.05);
    this.echoWet.gain.setTargetAtTime(this.reverb === 'haram' ? HARAM_ECHO.wet * this.reverbAmount : 0, now, 0.05);
  }

  /** Current level 0..1 (RMS of the last few milliseconds), for the meter. */
  level(): number {
    const data = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.min(1, Math.sqrt(sum / data.length) * 4);
  }

  dispose(): void {
    this.gate?.disconnect();
    this.denoiser?.disconnect();
    this.denoiser?.destroy?.();
    for (const n of this.nodes) n.disconnect();
  }
}
