import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { MediaSaver } from '../../native/media-saver';
import { Denoise, Reverb, extensionFor } from './audio-chain';
import { ChunkSink } from './studio-session';

/** A recitation the reader recorded. Files live in the app's storage ("studio/"), never uploaded. */
export interface Recording {
  id: string;
  kind: 'audio' | 'video';
  /** Epoch ms. */
  created: number;
  /** Seconds. */
  duration: number;
  mime: string;
  /** Path of the enhanced recording in Directory.Data. */
  file: string;
  /** The untouched microphone sound (audio only), to compare. */
  raw?: string;
  rawMime?: string;
  title: string;
  sura?: number;
  from?: number;
  to?: number;
  denoise: Denoise;
  reverb: Reverb;
}

const KEY = 'studioRecordings';
const DIR = 'studio';

/** Writes each chunk to the end of a file as it arrives (one at a time, in order). */
class FileSink implements ChunkSink {
  private queue: Promise<unknown> = Promise.resolve();
  private first = true;
  failed = false;
  constructor(private readonly path: string) {}

  write(chunk: Blob): void {
    this.queue = this.queue.then(async () => {
      const data = await blobToBase64(chunk);
      if (this.first) await Filesystem.writeFile({ path: this.path, data, directory: Directory.Data, recursive: true });
      else await Filesystem.appendFile({ path: this.path, data, directory: Directory.Data });
      this.first = false;
    }).catch(() => (this.failed = true));
  }

  async close(): Promise<void> {
    await this.queue;
    if (this.failed) throw new Error('write failed');
  }
}

/** In the browser (development): the chunks stay in memory until the page closes. */
class MemorySink implements ChunkSink {
  readonly chunks: Blob[] = [];
  write(chunk: Blob): void {
    this.chunks.push(chunk);
  }
  async close(): Promise<void> {}
}

@Injectable({ providedIn: 'root' })
export class StudioService {
  readonly recordings = signal<Recording[]>([]);
  private loaded?: Promise<void>;
  /** Browser only: recordings by path, as blobs. */
  private readonly memory = new Map<string, Blob>();
  private readonly native = Capacitor.isNativePlatform();

  load(): Promise<void> {
    this.loaded ??= (async () => {
      const { value } = await Preferences.get({ key: KEY });
      try {
        const list = value ? (JSON.parse(value) as Recording[]) : [];
        this.recordings.set(Array.isArray(list) ? list.filter((r) => r && r.id && r.file) : []);
      } catch {
        this.recordings.set([]);
      }
    })();
    return this.loaded;
  }

  /** A new recording's paths and sinks; [commit] stores it in the list once it is complete. */
  begin(kind: 'audio' | 'video', mime: string, rawMime?: string): { id: string; file: string; raw?: string; sink: ChunkSink; rawSink?: ChunkSink } {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const file = `${DIR}/${id}.${extensionFor(mime)}`;
    const raw = kind === 'audio' ? `${DIR}/${id}-original.${extensionFor(rawMime || mime)}` : undefined;
    const make = (path: string): ChunkSink => {
      if (this.native) return new FileSink(path);
      const sink = new MemorySink();
      const close = sink.close.bind(sink);
      sink.close = async () => {
        await close();
        this.memory.set(path, new Blob(sink.chunks, { type: path === file ? mime : rawMime || mime }));
      };
      return sink;
    };
    return { id, file, raw, sink: make(file), rawSink: raw ? make(raw) : undefined };
  }

  async commit(rec: Recording): Promise<void> {
    await this.load();
    this.recordings.update((list) => [rec, ...list]);
    await this.persist();
  }

  /** Throws away a recording that was not kept (the files of [begin]). */
  async discard(paths: (string | undefined)[]): Promise<void> {
    for (const p of paths) if (p) await this.deleteFile(p);
  }

  async remove(id: string): Promise<void> {
    const rec = this.recordings().find((r) => r.id === id);
    if (!rec) return;
    await this.discard([rec.file, rec.raw]);
    this.recordings.update((list) => list.filter((r) => r.id !== id));
    await this.persist();
  }

  async rename(id: string, title: string): Promise<void> {
    this.recordings.update((list) => list.map((r) => (r.id === id ? { ...r, title: title.trim() || r.title } : r)));
    await this.persist();
  }

  /** Keeps only the enhanced recording (drops the untouched sound kept for comparing). */
  async dropOriginal(id: string): Promise<void> {
    const rec = this.recordings().find((r) => r.id === id);
    if (!rec?.raw) return;
    await this.deleteFile(rec.raw);
    this.recordings.update((list) => list.map((r) => (r.id === id ? { ...r, raw: undefined, rawMime: undefined } : r)));
    await this.persist();
  }

  /** URL an <audio> / <video> element can play. */
  async src(path: string): Promise<string> {
    if (!this.native) {
      const blob = this.memory.get(path);
      return blob ? URL.createObjectURL(blob) : '';
    }
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  }

  /** The share sheet (WhatsApp, Telegram, Drive, "save to files"...). */
  async share(rec: Recording, title: string): Promise<void> {
    if (!this.native) {
      const blob = this.memory.get(rec.file);
      if (!blob) return;
      const file = new File([blob], fileName(rec), { type: rec.mime });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
      else downloadBlob(blob, fileName(rec));
      return;
    }
    const { uri } = await Filesystem.getUri({ path: rec.file, directory: Directory.Data });
    await Share.share({ title, files: [uri], dialogTitle: title });
  }

  /** Copies the recording into the gallery (video) or music (audio). 'unsupported' before Android 10. */
  async saveToDevice(rec: Recording): Promise<'saved' | 'unsupported' | 'failed'> {
    if (!this.native) {
      const blob = this.memory.get(rec.file);
      if (blob) downloadBlob(blob, fileName(rec));
      return blob ? 'saved' : 'failed';
    }
    try {
      const { uri } = await Filesystem.getUri({ path: rec.file, directory: Directory.Data });
      await MediaSaver.save({ path: uri, name: fileName(rec), mime: rec.mime.split(';')[0] });
      return 'saved';
    } catch (e) {
      return (e as { code?: string })?.code === 'UNSUPPORTED' ? 'unsupported' : 'failed';
    }
  }

  private async deleteFile(path: string): Promise<void> {
    if (!this.native) {
      this.memory.delete(path);
      return;
    }
    await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
  }

  private persist(): Promise<void> {
    return Preferences.set({ key: KEY, value: JSON.stringify(this.recordings()) });
  }
}

/** "Recitation 2026-11-03 14-05.mp4", or the reader's title. */
export function fileName(rec: Recording): string {
  const d = new Date(rec.created);
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}-${two(d.getMinutes())}`;
  const base = (rec.title || 'Recitation').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${base} ${stamp}.${extensionFor(rec.mime)}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
