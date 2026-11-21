import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

/**
 * Tajweed check after a tasmee' (the offline engine keeps each phrase's audio): each phrase is sent with the words it
 * covers to the app's tajweed server, a free Hugging Face Space running Quran Muaalem (obadx/muaalem-model-v3_2,
 * an AI model that hears the phonemes and their qualities: madd lengths, ghunnah, qalqalah, tafkheem...). The
 * server compares them with the words' reference reading (Hafs) and returns the mistakes. The audio is processed in
 * memory there and not stored. The model's licence (QML-1.0) asks that users be told it is AI before the first use.
 */
export const TAJWEED_URL = 'https://abdullahghoraba-muslim-friend-tajweed.hf.space';

/** [sura, aya, first word, last word] (word indexes in the ayah, 0-based, inclusive). */
export type TajweedPart = [number, number, number, number];

export interface TajweedRule {
  ar: string;
  en: string;
  len?: number;
  tag?: string | null;
}

/** One mistake, as the server returns it. */
export interface TajweedError {
  aya: number;
  word: number;
  /** The word as the server's mushaf writes it (to check it is the same word). */
  wordText?: string;
  /** The letters of the mistake. */
  text: string;
  type: 'tajweed' | 'normal' | 'tashkeel';
  kind: 'insert' | 'delete' | 'replace';
  expected: string;
  heard: string;
  expectedLen?: number | null;
  heardLen?: number | null;
  rules: TajweedRule[];
}

export interface TajweedReply {
  errors: TajweedError[];
}

export interface TajweedPrefs {
  /** Madd lengths the reciter follows (Hafs from ash-Shatibiyyah: munfasil 4 or 5, muttasil 4 or 5, 'arid 2, 4 or 6). */
  monfasel: number;
  mottasel: number;
  aared: number;
  /** The reader was told the check is AI and can be wrong (asked by the model's licence). */
  noticeSeen: boolean;
}

const PREFS_KEY = 'tajweedPrefs';
/** Phrases per request (one GPU call each on the Space). */
const BATCH = 4;
const DEFAULTS: TajweedPrefs = { monfasel: 4, mottasel: 4, aared: 4, noticeSeen: false };

/** The result of a Gradio call's event stream ("event: complete" then "data: [result]"); throws on "event: error". */
export function parseEvents(text: string): { results?: ({ errors?: TajweedError[] } | null)[] } {
  let event = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:') && event === 'complete') {
      const data = JSON.parse(line.slice(5).trim()) as unknown[];
      return (data?.[0] ?? {}) as { results?: ({ errors?: TajweedError[] } | null)[] };
    } else if (line.startsWith('data:') && event === 'error') {
      throw new Error('tajweed: ' + line.slice(5).trim().slice(0, 200));
    }
  }
  throw new Error('tajweed: no result');
}

/**
 * Cuts a phrase where the reciter paused between two words (a gap of at least [minGap] seconds), so each part ends
 * at a stop and the tajweed server reads its last word as a waqf. [words] are the phrase's words in order with
 * their frames in the recogniser's output ([frames] for the whole phrase, [samples] of audio). Returns, per part,
 * the words' positions in [words] and the part's audio range in samples.
 */
export function splitAtPauses(
  words: { start: number; end: number }[], frames: number, samples: number, minGap = 0.3,
): { from: number; to: number; first: number; last: number }[] {
  if (!words.length || frames <= 0) return [];
  const spf = samples / frames;
  const parts: { from: number; to: number; first: number; last: number }[] = [];
  let from = 0;
  let first = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = ((words[i].start - words[i - 1].end) * spf) / 16000;
    if (gap >= minGap) {
      const cut = Math.round(((words[i - 1].end + words[i].start) / 2) * spf);
      parts.push({ from, to: cut, first, last: i - 1 });
      from = cut;
      first = i;
    }
  }
  parts.push({ from, to: samples, first, last: words.length - 1 });
  return parts;
}

/** A word's letters only: no harakat or Quranic marks, one form of alif and ya. */
function letters(s: string): string {
  return s
    .replace(/[ً-ٰٟۖ-ۭـۦۥڇ]/g, '')
    .replace(/[ٱأإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ں/g, 'ن')
    .replace(/\s+/g, '');
}

/** Has a vowel (haraka or tanween) on it. */
const voweled = (s: string) => /[ً-ِ]/.test(s);

/**
 * A finding that is only how a reciter pauses (waqf) in the middle of a phrase, which the server, reading the
 * phrase as one breath, counts as a mistake: the last letter said with sukun (or qalqalah) instead of its vowel,
 * a madd lengthened at the stop ('arid), a ghunnah or idgham with the next word not made across the pause, or the
 * next word's first letter heard at the end of this one. Real mistakes are kept: a different vowel, an added vowel,
 * a missing madd. Checked on recitations by Husary, Minshawi and Alafasy (no false mistakes left) and a Warsh
 * recitation (its differences from Hafs still found).
 */
export function pauseArtifact(e: TajweedError, word: string, next?: string): boolean {
  const w = letters(word);
  const n = next ? letters(next) : '';
  const exp = letters(e.expected ?? '');
  const heard = letters(e.heard ?? '');
  if (e.type === 'tashkeel') {
    // The last letter: its vowel dropped (sukun, or qalqalah on a qalqalah letter) at a stop.
    if (exp.length === 1 && exp === heard && exp === w.slice(-1) && voweled(e.expected) && !voweled(e.heard)) return true;
    // A doubled letter (idgham / ghunnah into the next word) said once: the reciter stopped before that word.
    if (exp.length >= 2 && new Set(exp).size === 1 && heard === exp[0] && (exp[0] === w[0] || exp[0] === n[0])) return true;
    // The next word's first letter heard as part of this word's ending.
    if (e.kind === 'insert' && n && heard.length === exp.length + 1 && heard.startsWith(exp) && heard.slice(-1) === n[0]) return true;
  }
  if (e.type === 'tajweed') {
    const madd = (s: string) => (s.match(/[ۦۥا]/g) ?? []).length;
    const natural = e.rules?.some((r) => /المد الطبيعي/.test(r.ar)) ?? false;
    // A natural madd made longer on the word's last syllable: madd 'arid at a stop (2, 4 or 6 counts are all right).
    if (natural && madd(e.heard ?? '') > madd(e.expected ?? '') && /[اوي][^اوي]$/.test(w)) return true;
  }
  return false;
}

/** 16-bit PCM WAV (mono) of 16 kHz samples, base64. */
export function wavBase64(samples: Float32Array, rate = 16000): string {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

@Injectable({ providedIn: 'root' })
export class TajweedService {
  private prefsCache?: TajweedPrefs;

  async prefs(): Promise<TajweedPrefs> {
    if (!this.prefsCache) {
      try {
        const { value } = await Preferences.get({ key: PREFS_KEY });
        this.prefsCache = { ...DEFAULTS, ...(value ? (JSON.parse(value) as Partial<TajweedPrefs>) : {}) };
      } catch {
        this.prefsCache = { ...DEFAULTS };
      }
    }
    return this.prefsCache;
  }

  async setPrefs(p: Partial<TajweedPrefs>): Promise<void> {
    this.prefsCache = { ...(await this.prefs()), ...p };
    await Preferences.set({ key: PREFS_KEY, value: JSON.stringify(this.prefsCache) });
  }

  /**
   * Wakes the server: a free Space sleeps after two idle days and takes a minute or two to start; until then its
   * address answers with an error or a waiting page. Polls its API description for up to [ms].
   */
  async wake(ms = 180000): Promise<boolean> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      try {
        const r = await this.request('GET', '/gradio_api/info', undefined, 30000);
        if (r.status === 200 && r.text.includes('check')) return true;
      } catch {
        /* still starting */
      }
      await new Promise((ok) => setTimeout(ok, 5000));
    }
    return false;
  }

  /**
   * Test builds only (the app id ends in .dev, installed next to the Play version): each checked phrase is kept on the
   * phone with the server's answer (files/tajweed-debug/), to study the check on a real voice. The Play build keeps
   * nothing.
   */
  private debugBuild?: Promise<boolean>;
  private async keepForStudy(phrases: { audio: Float32Array; parts: TajweedPart[] }[], replies: (TajweedReply | null)[]): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    this.debugBuild ??= App.getInfo().then((i) => i.id.endsWith('.dev')).catch(() => false);
    if (!(await this.debugBuild)) return;
    const at = Date.now();
    for (let i = 0; i < phrases.length; i++) {
      await Filesystem.writeFile({
        path: `tajweed-debug/${at}-${i}.json`, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true,
        data: JSON.stringify({ parts: phrases[i].parts, reply: replies[i], prefs: await this.prefs(), wav: wavBase64(phrases[i].audio) }),
      }).catch(() => undefined);
    }
  }

  /** Checks phrases (their audio and the words each covers), a few per request; one result per phrase. */
  async check(phrases: { audio: Float32Array; parts: TajweedPart[] }[]): Promise<(TajweedReply | null)[]> {
    const p = await this.prefs();
    const out: (TajweedReply | null)[] = [];
    for (let i = 0; i < phrases.length; i += BATCH) {
      const batch = phrases.slice(i, i + BATCH);
      const request = JSON.stringify({
        phrases: batch.map((x) => ({ audio: wavBase64(x.audio), parts: x.parts })),
        monfasel: p.monfasel, mottasel: p.mottasel, aared: p.aared,
      });
      try {
        const results = (await this.call(request)).results ?? [];
        batch.forEach((_, k) => {
          const r = results[k];
          if (r && !Array.isArray(r.errors)) console.warn('[tajweed] phrase not checked:', (r as { error?: string }).error);
          out.push(r && Array.isArray(r.errors) ? { errors: r.errors } : null);
        });
        void this.keepForStudy(batch, out.slice(out.length - batch.length));
      } catch (e) {
        console.warn('[tajweed]', e);
        batch.forEach(() => out.push(null));
      }
      this.progress?.(Math.min(phrases.length, i + BATCH), phrases.length);
    }
    return out;
  }

  /** Called after each request with how many phrases are done. */
  progress?: (done: number, total: number) => void;

  /** The Space's "check" endpoint (Gradio): start the call, then read its result from the event stream. */
  private async call(request: string): Promise<{ results?: ({ errors?: TajweedError[] } | null)[] }> {
    const start = await this.request('POST', '/gradio_api/call/check', { data: [request] }, 60000);
    if (start.status >= 400) throw new Error(`tajweed ${start.status}`);
    const id = (JSON.parse(start.text) as { event_id?: string }).event_id;
    if (!id) throw new Error('tajweed: no event');
    const res = await this.request('GET', `/gradio_api/call/check/${id}`, undefined, 180000);
    return parseEvents(res.text);
  }

  private async request(method: 'GET' | 'POST', path: string, body: unknown, timeout: number): Promise<{ status: number; text: string }> {
    const url = TAJWEED_URL + path;
    if (Capacitor.isNativePlatform()) {
      const r = await CapacitorHttp.request({
        method, url, data: body, headers: { 'Content-Type': 'application/json' }, responseType: 'text',
        connectTimeout: timeout, readTimeout: timeout,
      });
      return { status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, {
        method, signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, text: await r.text() };
    } finally {
      clearTimeout(timer);
    }
  }
}
