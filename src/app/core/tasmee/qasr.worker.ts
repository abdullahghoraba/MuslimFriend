/// <reference lib="webworker" />
/**
 * Offline tasmee' recogniser: Abdou/quran-asr-small (MIT), a Conformer-CTC model trained for Quran recitation on
 * professional reciters and on ordinary people reciting into their phones. 36 MB, downloaded once from Hugging Face
 * (a fixed revision, checked by its SHA-256) and kept in the browser cache; ONNX Runtime ships with the app
 * (assets/ort), so after the download it works without internet. Nothing is uploaded.
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
export const QASR_CACHE = 'tasmee-qasr';

let session: Promise<ort.InferenceSession> | null = null;

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The model file: from the cache, else downloaded (with progress) and checked. */
async function modelBytes(): Promise<ArrayBuffer> {
  const cache = await caches.open(QASR_CACHE);
  const hit = await cache.match(QASR_MODEL_URL);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(QASR_MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  const total = Number(res.headers.get('content-length')) || MODEL_SIZE;
  const reader = res.body.getReader();
  const buf = new Uint8Array(total);
  let loaded = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > buf.length) throw new Error('download size');
    buf.set(value, loaded);
    loaded += value.length;
    if (loaded - lastPost > 256 * 1024) {
      lastPost = loaded;
      postMessage({ type: 'progress', loaded, total });
    }
  }
  if (loaded !== MODEL_SIZE || (await sha256(buf.buffer)) !== MODEL_SHA256) throw new Error('download corrupt');
  await cache.put(QASR_MODEL_URL, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
  postMessage({ type: 'progress', loaded, total });
  return buf.buffer;
}

function load(): Promise<ort.InferenceSession> {
  session ??= (async () => {
    ort.env.wasm.wasmPaths = new URL('/assets/ort/', self.location.origin).href;
    // One thread: the app is not cross-origin isolated (no SharedArrayBuffer). Fast enough: a phrase in well under a second.
    ort.env.wasm.numThreads = 1;
    const bytes = await modelBytes();
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
