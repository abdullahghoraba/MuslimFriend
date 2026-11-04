/// <reference lib="webworker" />
/**
 * Offline tasmee' recogniser: Abdou/quran-asr-small (MIT), a Conformer-CTC model trained for Quran recitation on
 * professional reciters and on ordinary people reciting into their phones. 36 MB, downloaded once from Hugging Face
 * (a fixed revision, checked by its SHA-256) with ONNX Runtime's WebAssembly (14 MB, about 4 MB over the wire, from
 * jsDelivr, also checked) and kept in the browser cache, so after the download it works without internet. Only the
 * runtime's small loader ships with the app (assets/ort). Nothing is uploaded.
 *
 * Messages in:  {type:'load'} | {type:'transcribe', id, audio: Float32Array (16 kHz mono)} | {type:'remove'}
 * Messages out: {type:'progress', loaded, total} | {type:'ready'} | {type:'text', id, text} | {type:'error', id?, message}
 */
import * as ort from 'onnxruntime-web/wasm';
import { NUM_BINS, ctcGreedy, fbank } from './qasr-features';

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
    ort.env.wasm.wasmPaths = new URL('/assets/ort/', self.location.origin).href;
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

async function transcribe(audio: Float32Array): Promise<string> {
  const s = await load();
  const { data, frames } = fbank(audio);
  if (frames < 10) return '';
  const out = await s.run({
    x: new ort.Tensor('float32', data, [1, frames, NUM_BINS]),
    x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
  });
  const lp = out['log_probs'];
  return ctcGreedy(lp.data as Float32Array, lp.dims[1], lp.dims[2]);
}

addEventListener('message', async (e: MessageEvent<{ type: string; id?: number; audio?: Float32Array }>) => {
  try {
    if (e.data.type === 'load') {
      await load();
      postMessage({ type: 'ready' });
    } else if (e.data.type === 'transcribe' && e.data.audio) {
      postMessage({ type: 'text', id: e.data.id, text: await transcribe(e.data.audio) });
    } else if (e.data.type === 'remove') {
      session = null;
      await caches.delete(QASR_CACHE);
      postMessage({ type: 'ready' });
    }
  } catch (err) {
    postMessage({ type: 'error', id: e.data.id, message: String((err as Error)?.message ?? err) });
  }
});
