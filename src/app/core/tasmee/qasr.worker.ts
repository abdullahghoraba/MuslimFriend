/// <reference lib="webworker" />
/**
 * Offline tasmee' recogniser: Abdou/quran-asr-small (MIT), a Conformer-CTC model trained for Quran recitation on
 * professional reciters and on ordinary people reciting into their phones. 36 MB, downloaded once from Hugging Face
 * (a fixed revision, checked by its SHA-256) with ONNX Runtime's WebAssembly (14 MB, about 4 MB over the wire, from
 * jsDelivr, also checked) and kept in the browser cache, so after the download it works without internet. Only the
 * runtime's small loader ships with the app (assets/ort). Nothing is uploaded.
 *
 * Messages in:  {type:'load'} | {type:'transcribe', id, audio: Float32Array (16 kHz mono)} | {type:'remove'}
 * Messages out: {type:'progress', loaded, total} | {type:'ready'} | {type:'error', id?, message}
 *   | {type:'text', id, text, words: [{text, start, end}], lp: Float32Array [frames * vocab], frames, vocab}
 *   (the words with their frames and the letter probabilities, so tasmee' can check the audio of a mistake)
 */
import * as ort from 'onnxruntime-web/wasm';
import { NUM_BINS, fbank } from './qasr-features';
import { HeardSpan, greedyWords } from './ctc-score';

const REVISION = '004f898639f3127a74eac1b898a2cb3ef0b5268d';
export const QASR_MODEL_URL = `https://huggingface.co/Abdou/quran-asr-small/resolve/${REVISION}/model.int8.onnx`;
const MODEL_SHA256 = '88f9df290d57b8890275d79187b77515aeeb12626a42bc76cbd0f8bfcaff00f0';
const MODEL_SIZE = 36081762;
/** The same version as the onnxruntime-web package (its loader is in assets/ort). */
const ORT_WASM_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm';
const ORT_WASM_SHA256 = '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2';
const ORT_WASM_SIZE = 14239897;
export const QASR_CACHE = 'tasmee-qasr';

let session: Promise<ort.InferenceSession> | null = null;

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Progress over both files (model and runtime), in bytes of their full sizes. */
const progress = { model: 0, wasm: 0 };
const TOTAL = MODEL_SIZE + ORT_WASM_SIZE;
let lastPost = 0;
function report(force = false): void {
  const loaded = progress.model + progress.wasm;
  if (force || loaded - lastPost > 256 * 1024) {
    lastPost = loaded;
    postMessage({ type: 'progress', loaded, total: TOTAL });
  }
}

/** A file from the cache, else downloaded (with progress), checked by its size and SHA-256, and cached. */
async function cachedFile(url: string, size: number, sha: string, part: keyof typeof progress): Promise<ArrayBuffer> {
  const cache = await caches.open(QASR_CACHE);
  const hit = await cache.match(url);
  if (hit) {
    progress[part] = size;
    return hit.arrayBuffer();
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  const reader = res.body.getReader();
  const buf = new Uint8Array(size);
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > buf.length) throw new Error('download size');
    buf.set(value, loaded);
    loaded += value.length;
    progress[part] = loaded;
    report();
  }
  if (loaded !== size || (await sha256(buf.buffer)) !== sha) throw new Error('download corrupt');
  await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
  report(true);
  return buf.buffer;
}

function load(): Promise<ort.InferenceSession> {
  session ??= (async () => {
    // The runtime's loader comes with the app; its WebAssembly is downloaded with the model.
    ort.env.wasm.wasmPaths = new URL('assets/ort/', self.location.href).href;
    // One thread: the app is not cross-origin isolated (no SharedArrayBuffer). Fast enough: a phrase in well under a second.
    ort.env.wasm.numThreads = 1;
    const [bytes, wasm] = await Promise.all([
      cachedFile(QASR_MODEL_URL, MODEL_SIZE, MODEL_SHA256, 'model'),
      cachedFile(ORT_WASM_URL, ORT_WASM_SIZE, ORT_WASM_SHA256, 'wasm'),
    ]);
    ort.env.wasm.wasmBinary = wasm;
    return ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })();
  session.catch(() => (session = null));
  return session;
}

interface Reading {
  text: string;
  words: HeardSpan[];
  lp: Float32Array;
  frames: number;
  vocab: number;
}

async function transcribe(audio: Float32Array): Promise<Reading> {
  const s = await load();
  const { data, frames } = fbank(audio);
  if (frames < 10) return { text: '', words: [], lp: new Float32Array(0), frames: 0, vocab: 0 };
  const out = await s.run({
    x: new ort.Tensor('float32', data, [1, frames, NUM_BINS]),
    x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
  });
  const t = out['log_probs'];
  const lp = new Float32Array(t.data as Float32Array);
  const words = greedyWords(lp, t.dims[1], t.dims[2]);
  return { text: words.map((w) => w.text).join(' '), words, lp, frames: t.dims[1], vocab: t.dims[2] };
}

/**
 * Seconds of voice in samples [from, to) of [audio]: 20 ms windows louder than a sixth of the recitation's level (the
 * 90th percentile of the whole phrase), so a breath or the room is not counted.
 */
function voicedSeconds(audio: Float32Array, from: number, to: number): number {
  const W = 320;
  const levels: number[] = [];
  for (let at = 0; at + W <= audio.length; at += W) {
    let p = 0;
    for (let i = at; i < at + W; i++) p += audio[i] * audio[i];
    levels.push(Math.sqrt(p / W));
  }
  if (!levels.length) return 0;
  const loud = [...levels].sort((a, b) => a - b)[Math.floor(levels.length * 0.9)] / 6;
  let n = 0;
  for (let k = Math.floor(from / W); k < Math.min(levels.length, Math.ceil(to / W)); k++) if (levels[k] > loud) n++;
  return (n * W) / 16000;
}

/** The quietest 100 ms of samples [from, to) (where to cut between two words). */
function quietestAt(audio: Float32Array, from: number, to: number): number {
  const W = 1600;
  let best = Math.round((from + to) / 2);
  let least = Infinity;
  for (let at = Math.max(0, from); at + W <= Math.min(to, audio.length); at += 160) {
    let p = 0;
    for (let i = at; i < at + W; i++) p += audio[i] * audio[i];
    if (p < least) {
      least = p;
      best = at + W / 2;
    }
  }
  return best;
}

/** Two readings of consecutive pieces of audio as one (frames, letter probabilities and word frames run on). */
function joinReadings(a: Reading, b: Reading): Reading {
  if (!a.frames) return b;
  if (!b.frames) return a;
  const lp = new Float32Array(a.lp.length + b.lp.length);
  lp.set(a.lp);
  lp.set(b.lp, a.lp.length);
  const words = [...a.words, ...b.words.map((w) => ({ ...w, start: w.start + a.frames, end: w.end + a.frames }))];
  return { text: words.map((w) => w.text).join(' '), words, lp, frames: a.frames + b.frames, vocab: a.vocab || b.vocab };
}

/**
 * Reads a phrase; if a second or more of recitation before its first word or after its last came back without any
 * word, that part is read again on its own and the two readings joined. The model was trained on one ayah at a time:
 * given two ayat said with only a short stop between them (the basmala and al-Hamd in one breath), it can write the
 * second and nothing of the first, and the reader was told the first was skipped.
 */
async function readPhrase(audio: Float32Array, depth = 0): Promise<Reading> {
  const r = await transcribe(audio);
  if (depth >= 2 || !r.words.length || audio.length < 3 * 16000) return r;
  const spf = audio.length / r.frames;
  const head = Math.round(r.words[0].start * spf);
  const tail = Math.round(r.words[r.words.length - 1].end * spf);
  const MIN = 1;
  if (voicedSeconds(audio, 0, head) >= MIN) {
    // Cut in the quietest moment just before the first word heard (the stop between the two ayat).
    const cut = quietestAt(audio, head - Math.round(0.7 * 16000), head + Math.round(0.1 * 16000));
    const first = await readPhrase(audio.subarray(0, cut), depth + 1);
    if (first.words.length) return joinReadings(first, await readPhrase(audio.subarray(cut), depth + 1));
  } else if (voicedSeconds(audio, tail, audio.length) >= MIN) {
    const cut = quietestAt(audio, tail - Math.round(0.1 * 16000), tail + Math.round(0.7 * 16000));
    const last = await readPhrase(audio.subarray(cut), depth + 1);
    if (last.words.length) return joinReadings(await readPhrase(audio.subarray(0, cut), depth + 1), last);
  }
  return r;
}

addEventListener('message', async (e: MessageEvent<{ type: string; id?: number; audio?: Float32Array }>) => {
  try {
    if (e.data.type === 'load') {
      await load();
      postMessage({ type: 'ready' });
    } else if (e.data.type === 'transcribe' && e.data.audio) {
      const r = await readPhrase(e.data.audio);
      postMessage({ type: 'text', id: e.data.id, ...r }, { transfer: [r.lp.buffer] });
    } else if (e.data.type === 'remove') {
      session = null;
      await caches.delete(QASR_CACHE);
      postMessage({ type: 'ready' });
    }
  } catch (err) {
    postMessage({ type: 'error', id: e.data.id, message: String((err as Error)?.message ?? err) });
  }
});
