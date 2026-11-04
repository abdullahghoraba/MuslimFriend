// The noise models are loaded only when the studio opens (they extend AudioWorkletNode, which must exist first).
const noiseLib = () => import('@sapphi-red/web-noise-suppressor');

/**
 * The recitation sound chain, built with the Web Audio API on the phone (nothing is uploaded):
 *
 *   mic -> high-pass (hum, handling noise) -> noise removal -> gate -> voice EQ -> compressor -> + reverb -> limiter -> out
 *
 * Noise removal is a small neural network running in an AudioWorklet: GTCRN ("strong", the default) or RNNoise
 * ("light"), both open source (github.com/sapphi-red/web-noise-suppressor, MIT). After it, a gate (our own
 * worklet, assets/studio/gate-processor.js) turns down by 24 dB what is left of the noise between words and ayat,
 * before the compressor would bring it back up: real rooms leave some noise even after the network. The reverb is
 * generated here (no samples to download): a short room, a hall, or the long tail of a large mosque.
 */

export type Denoise = 'off' | 'light' | 'strong';
export type Reverb = 'none' | 'room' | 'hall' | 'mosque';

export interface ChainOptions {
  denoise: Denoise;
  reverb: Reverb;
}

/** Length (s), decay and wet level of each reverb. */
export const REVERBS: Record<Exclude<Reverb, 'none'>, { seconds: number; decay: number; wet: number; preDelay: number }> = {
  room: { seconds: 0.8, decay: 4, wet: 0.16, preDelay: 0.008 },
  hall: { seconds: 2.0, decay: 3, wet: 0.22, preDelay: 0.02 },
  mosque: { seconds: 3.6, decay: 2.4, wet: 0.3, preDelay: 0.035 },
};

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

  private constructor(private readonly ctx: AudioContext, source: AudioNode) {
    const highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 80, Q: 0.7 });
    // Voice EQ: a little less boom, a little more presence and air, as engineers do for recitation.
    const mud = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 250, Q: 1, gain: -2 });
    const presence = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 3500, Q: 0.9, gain: 3 });
    const air = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 10000, gain: 2 });
    // Evens out loud and soft passages so the whole recitation is clear without riding the volume.
    const compressor = new DynamicsCompressorNode(ctx, { threshold: -22, knee: 8, ratio: 3, attack: 0.006, release: 0.25 });
    const makeup = new GainNode(ctx, { gain: 1.7 });
    const dry = new GainNode(ctx, { gain: 1 });
    this.wet = new GainNode(ctx, { gain: 0 });
    this.convolver = new ConvolverNode(ctx);
    // Keeps peaks from clipping after the make-up gain and the reverb.
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
    this.output = new MediaStreamAudioDestinationNode(ctx, { channelCount: 2 });
    this.meter = new AnalyserNode(ctx, { fftSize: 1024 });

    source.connect(highpass);
    this.preDenoise = highpass;
    this.postDenoise = new GainNode(ctx, { gain: 1 });
    this.eq = mud;
    highpass.connect(this.postDenoise).connect(mud);
    mud.connect(presence).connect(air).connect(compressor).connect(makeup);
    makeup.connect(dry).connect(limiter);
    makeup.connect(this.convolver).connect(this.wet).connect(limiter);
    limiter.connect(this.output);
    limiter.connect(this.meter);
    this.nodes.push(highpass, this.postDenoise, mud, presence, air, compressor, makeup, dry, this.wet, this.convolver, limiter);
  }

  /** Builds the chain on [source] (a microphone) with [options]. */
  static async create(ctx: AudioContext, source: AudioNode, options: ChainOptions): Promise<RecitationChain> {
    const chain = new RecitationChain(ctx, source);
    await chain.setDenoise(options.denoise);
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
    if (reverb === 'none') {
      this.wet.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      return;
    }
    const r = REVERBS[reverb];
    const channels = makeImpulse(this.ctx.sampleRate, r.seconds, r.decay, r.preDelay);
    const buffer = this.ctx.createBuffer(2, channels[0].length, this.ctx.sampleRate);
    channels.forEach((data, ch) => buffer.copyToChannel(data, ch));
    this.convolver.buffer = buffer;
    this.wet.gain.setTargetAtTime(r.wet, this.ctx.currentTime, 0.05);
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
