/// <reference lib="webworker" />
/**
 * Offline tasmee' recogniser: Tarteel's Whisper model trained on Quran recitation (tarteel-ai/whisper-tiny-ar-quran,
 * Apache-2.0; ONNX export aaqibhabib/whisper-tiny-ar-quran-onnx, 8-bit), run with transformers.js on the phone. Downloaded once (model from Hugging
 * Face, ONNX Runtime from jsDelivr) and kept in the browser cache, then it works offline. Nothing is uploaded.
 *
 * Messages in: {type:'load'} | {type:'transcribe', id, audio: Float32Array (16 kHz mono)}
 * Messages out: {type:'progress', loaded, total} | {type:'ready'} | {type:'text', id, text} | {type:'error', message}
 */
import { env, pipeline } from '@huggingface/transformers';

export const WHISPER_MODEL = 'aaqibhabib/whisper-tiny-ar-quran-onnx';
const RUNTIME_CACHE = 'tasmee-runtime';

type Asr = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
let asr: Promise<Asr> | null = null;

/** The plain (no WebGPU) ONNX Runtime build: half the size of the default, and all a phone's WASM needs. */
async function runtimePaths(): Promise<{ mjs: string; wasm: string }> {
  const version = (env.backends.onnx as { versions?: { web?: string } }).versions?.web;
  const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort-wasm-simd-threaded`;
  // The JS part is kept in the cache too and loaded from a blob, so it also works offline.
  const cache = await caches.open(RUNTIME_CACHE);
  let res = await cache.match(`${base}.mjs`);
  if (!res) {
    const fresh = await fetch(`${base}.mjs`);
    if (!fresh.ok) throw new Error(`runtime ${fresh.status}`);
    await cache.put(`${base}.mjs`, fresh.clone());
    res = fresh;
  }
  const mjs = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
  return { mjs, wasm: `${base}.wasm` };
}

function load(): Promise<Asr> {
  asr ??= (async () => {
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const onnx = env.backends.onnx as { wasm: { wasmPaths?: unknown; numThreads?: number } };
    onnx.wasm.wasmPaths = await runtimePaths();
    onnx.wasm.numThreads = 1;
    const files = new Map<string, { loaded: number; total: number }>();
    const fn = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      device: 'wasm',
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== 'progress' || !p.file) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        postMessage({ type: 'progress', loaded, total });
      },
    } as Record<string, unknown>);
    return fn as unknown as Asr;
  })();
  asr.catch(() => (asr = null));
  return asr;
}

addEventListener('message', async (e: MessageEvent<{ type: string; id?: number; audio?: Float32Array }>) => {
  try {
    if (e.data.type === 'load') {
      await load();
      postMessage({ type: 'ready' });
    } else if (e.data.type === 'transcribe' && e.data.audio) {
      const fn = await load();
      // The export's generation config lacks Whisper's language and task tables: give the Arabic / transcribe tokens.
      const out = await fn(e.data.audio, {
        language: 'ar',
        task: 'transcribe',
        lang_to_id: { '<|ar|>': 50272 },
        task_to_id: { transcribe: 50359 },
        no_timestamps_token_id: 50363,
      });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
      postMessage({ type: 'text', id: e.data.id, text: text.trim() });
    }
  } catch (err) {
    postMessage({ type: 'error', id: e.data.id, message: String((err as Error)?.message ?? err) });
  }
});
