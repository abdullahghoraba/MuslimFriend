/**
 * Audio features and decoding for the offline Quran recogniser (Abdou/quran-asr-small, MIT: a Conformer-CTC model
 * trained on professional reciters and on ordinary people reciting into phones, Hafs and Warsh).
 *
 * fbank() is the model's own front end, bit for bit (its code/quran_asr/features.py, the Kaldi recipe sherpa-onnx
 * uses): 80 log-mel bins, 25 ms povey window, 10 ms shift, DC removal, pre-emphasis 0.97, 512-point FFT, mel 20-7600 Hz,
 * log floored at float epsilon, no dither, edges reflected (snip_edges false), 16 kHz samples in [-1, 1].
 * The model writes the Arabic letters it hears (Uthmani rasm, no harakat) with "▁" between words.
 */

export const SAMPLE_RATE = 16000;
export const NUM_BINS = 80;
const SHIFT = 160;
const LENGTH = 400;
const FFT = 512;
const EPS = 1.1920928955078125e-7; // float32 epsilon

/** The model's 31 outputs: blank, 29 letters, word separator. */
export const VOCAB = ['', ...'ءابتثجحخدذرزسشصضطظعغفقكلمنهوي', ' '];

const mel = (f: number) => 1127 * Math.log(1 + f / 700);

/** Mel filter banks [NUM_BINS][FFT/2] (20 Hz to 7600 Hz). */
const BANKS: Float32Array[] = (() => {
  const bins = FFT / 2;
  const width = SAMPLE_RATE / FFT;
  const low = mel(20);
  const high = mel(SAMPLE_RATE / 2 - 400);
  const delta = (high - low) / (NUM_BINS + 1);
  const out: Float32Array[] = [];
  for (let b = 0; b < NUM_BINS; b++) {
    const left = low + b * delta;
    const center = low + (b + 1) * delta;
    const right = low + (b + 2) * delta;
    const row = new Float32Array(bins);
    for (let i = 0; i < bins; i++) {
      const m = mel(width * i);
      if (left < m && m < right) row[i] = m <= center ? (m - left) / (center - left) : (right - m) / (right - center);
    }
    out.push(row);
  }
  return out;
})();

const WINDOW = Float32Array.from({ length: LENGTH }, (_, i) => Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (LENGTH - 1)), 0.85));

// Radix-2 FFT tables for 512 points.
const BITREV = Uint16Array.from({ length: FFT }, (_, i) => {
  let r = 0;
  for (let b = 0, x = i; b < 9; b++, x >>= 1) r = (r << 1) | (x & 1);
  return r;
});
const COS = Float64Array.from({ length: FFT / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / FFT));
const SIN = Float64Array.from({ length: FFT / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / FFT));

function powerSpectrum(frame: Float32Array, re: Float64Array, im: Float64Array, out: Float64Array): void {
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < LENGTH; i++) re[BITREV[i]] = frame[i];
  for (let size = 2; size <= FFT; size <<= 1) {
    const half = size >> 1;
    const step = FFT / size;
    for (let start = 0; start < FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step];
        const s = SIN[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  for (let i = 0; i < FFT / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
}

export const numFrames = (samples: number) => Math.floor((samples + SHIFT / 2) / SHIFT);

/** 16 kHz samples -> features [frames * 80], frame-major. */
export function fbank(wave: Float32Array): { data: Float32Array; frames: number } {
  const n = wave.length;
  const t = numFrames(n);
  const data = new Float32Array(t * NUM_BINS);
  const frame = new Float32Array(LENGTH);
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  const power = new Float64Array(FFT / 2);
  for (let f = 0; f < t; f++) {
    const first = f * SHIFT + SHIFT / 2 - LENGTH / 2;
    let mean = 0;
    for (let i = 0; i < LENGTH; i++) {
      let j = first + i;
      if (j < 0) j = -j - 1;
      if (j >= n) j = 2 * n - 1 - j;
      j = Math.min(n - 1, Math.max(0, j));
      frame[i] = wave[j];
      mean += wave[j];
    }
    mean /= LENGTH;
    for (let i = 0; i < LENGTH; i++) frame[i] -= mean;
    for (let i = LENGTH - 1; i > 0; i--) frame[i] -= 0.97 * frame[i - 1];
    frame[0] *= 1 - 0.97;
    for (let i = 0; i < LENGTH; i++) frame[i] *= WINDOW[i];
    powerSpectrum(frame, re, im, power);
    for (let b = 0; b < NUM_BINS; b++) {
      const bank = BANKS[b];
      let e = 0;
      for (let i = 0; i < FFT / 2; i++) if (bank[i]) e += power[i] * bank[i];
      data[f * NUM_BINS + b] = Math.log(Math.max(e, EPS));
    }
  }
  return { data, frames: t };
}

/** Greedy CTC: the best token per frame, repeats merged, blanks dropped. logProbs is [frames * vocab]. */
export function ctcGreedy(logProbs: Float32Array, frames: number, vocab = VOCAB.length): string {
  let out = '';
  let prev = -1;
  for (let f = 0; f < frames; f++) {
    let best = 0;
    let bestV = -Infinity;
    for (let v = 0; v < vocab; v++) {
      const x = logProbs[f * vocab + v];
      if (x > bestV) {
        bestV = x;
        best = v;
      }
    }
    if (best !== prev && best !== 0) out += VOCAB[best] ?? '';
    prev = best;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Resampling to 16 kHz (the recogniser's rate) from the microphone's rate (48 kHz on most phones). Going down, each
 * output sample is the mean of the input samples it covers (a box filter), so high frequencies do not fold back into
 * the speech band; going up, linear interpolation.
 */
export function resample(input: Float32Array, from: number, to = SAMPLE_RATE): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  if (ratio > 1) {
    const prefix = new Float64Array(input.length + 1);
    for (let i = 0; i < input.length; i++) prefix[i + 1] = prefix[i] + input[i];
    for (let i = 0; i < out.length; i++) {
      const a = Math.max(0, Math.round((i - 0.5) * ratio));
      const b = Math.min(input.length, Math.max(a + 1, Math.round((i + 0.5) * ratio)));
      out[i] = (prefix[b] - prefix[a]) / (b - a);
    }
    return out;
  }
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const a = Math.floor(x);
    const b = Math.min(input.length - 1, a + 1);
    out[i] = input[a] + (input[b] - input[a]) * (x - a);
  }
  return out;
}
