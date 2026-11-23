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
 *
 * A part longer than [maxLen] samples (the server takes up to 20 s; a long ayah read in one breath is longer) is
 * cut again between the two words with the widest gap, until every part fits: before, such a part was not checked
 * at all, and its mistakes were never shown.
 */
export function splitAtPauses(
  words: { start: number; end: number }[], frames: number, samples: number, minGap = 0.3, maxLen = Infinity,
  /** Where the reciter was silent between two samples (see silenceIn): -1 if not, or true for "in the middle". */
  silent: (from: number, to: number) => number | boolean = () => true,
): { from: number; to: number; first: number; last: number }[] {
  if (!words.length || frames <= 0) return [];
  const spf = samples / frames;
  const parts: { from: number; to: number; first: number; last: number }[] = [];
  let from = 0;
  let first = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = ((words[i].start - words[i - 1].end) * spf) / 16000;
    // A gap in the recogniser's timing is not always a pause (a word's last vowel or a madd can fall outside it):
    // only a gap the reciter was really silent in is a stop.
    const stop = gap >= minGap ? silent(Math.round(words[i - 1].end * spf), Math.round(words[i].start * spf)) : false;
    if (stop !== false && stop !== -1) {
      // In the silence itself: the recogniser marks a word's end at its last letter, before the sound of it ends, and
      // the middle of the gap can still be in that word (the check then heard «من تفا» for «من تفاوت»).
      const cut = typeof stop === 'number' ? stop : Math.round(((words[i - 1].end + words[i].start) / 2) * spf);
      parts.push({ from, to: cut, first, last: i - 1 });
      from = cut;
      first = i;
    }
  }
  parts.push({ from, to: samples, first, last: words.length - 1 });
  const fit = (p: { from: number; to: number; first: number; last: number }): typeof parts => {
    if (p.to - p.from <= maxLen || p.last <= p.first) return [p];
    // The widest gap between two of its words (a breath, or the end of an ayah), not too near either end.
    let at = -1;
    let widest = -Infinity;
    for (let i = p.first + 1; i <= p.last; i++) {
      const cut = ((words[i - 1].end + words[i].start) / 2) * spf;
      if (cut - p.from < 0.15 * (p.to - p.from) || p.to - cut < 0.15 * (p.to - p.from)) continue;
      const gap = words[i].start - words[i - 1].end;
      if (gap > widest) {
        widest = gap;
        at = i;
      }
    }
    if (at < 0) at = Math.ceil((p.first + p.last + 1) / 2);
    const cut = Math.round(((words[at - 1].end + words[at].start) / 2) * spf);
    return [...fit({ from: p.from, to: cut, first: p.first, last: at - 1 }), ...fit({ from: cut, to: p.to, first: at, last: p.last })];
  };
  return parts.flatMap(fit);
}

/**
 * Whether the reciter was silent for at least [minSilence] seconds somewhere between samples [from] and [to] of
 * [audio]: a run of 20 ms frames each much quieter than the voice (a tenth of the loud frames' level, the 90th
 * percentile of the whole [audio]).
 */
/** Per audio (a phrase is looked at again on every new word heard): its silence level. */
const quietLevels = new WeakMap<Float32Array, number>();

export function silentBetween(audio: Float32Array, from: number, to: number, minSilence = 0.25): boolean {
  return silenceIn(audio, from, to, minSilence) >= 0;
}

/** The middle of the first silence of at least [minSilence] seconds between samples [from] and [to], or -1. */
export function silenceIn(audio: Float32Array, from: number, to: number, minSilence = 0.25): number {
  const F = 320;
  const level = (at: number) => {
    let p = 0;
    for (let i = at; i < at + F && i < audio.length; i++) p += audio[i] * audio[i];
    return Math.sqrt(p / F);
  };
  let quiet = quietLevels.get(audio);
  if (quiet === undefined) {
    const all: number[] = [];
    for (let at = 0; at + F <= audio.length; at += F) all.push(level(at));
    if (!all.length) return -1;
    quiet = [...all].sort((a, b) => a - b)[Math.floor(all.length * 0.9)] * 0.1;
    quietLevels.set(audio, quiet);
  }
  let run = 0;
  let at = Math.max(0, from);
  for (; at + F <= Math.min(to, audio.length); at += F) {
    run = level(at) < quiet ? run + 1 : 0;
    if (run * F >= minSilence * 16000) break;
  }
  if (run * F < minSilence * 16000) return -1;
  // The whole silence (it may go on past [minSilence]), and its middle.
  const start = at - (run - 1) * F;
  while (at + 2 * F <= Math.min(to, audio.length) && level(at + F) < quiet) at += F;
  return Math.round((start + at + F) / 2);
}

/** The middle of the quietest 100 ms between samples [from] and [to] of [audio] (where to cut between two words). */
export function quietestIn(audio: Float32Array, from: number, to: number): number {
  const W = 1600;
  from = Math.max(0, Math.round(from));
  to = Math.min(audio.length, Math.round(to));
  if (to - from <= W) return Math.round((from + to) / 2);
  let best = from;
  let least = Infinity;
  for (let at = from; at + W <= to; at += 160) {
    let p = 0;
    for (let i = at; i < at + W; i++) p += audio[i] * audio[i];
    if (p < least) {
      least = p;
      best = at;
    }
  }
  return best + W / 2;
}

/**
 * The letters of a word that are said as consonants: no harakat or marks, no alif (a madd, or the hamzat al-wasl of
 * «ٱل» that is not said in the middle of a phrase), a doubled letter (shaddah, or a lam assimilated into the next
 * letter) once.
 */
function sounded(s: string): string[] {
  return [...s.replace(/[ً-ٰٟۖ-ۭـۦۥڇ]/g, '').replace(/[أإٔ]/g, 'ء').replace(/ى/g, 'ي').replace(/ں/g, 'ن').replace(/[ٱاآ\s]/g, '').replace(/(.)\1+/g, '$1')];
}

/**
 * Whether a word was left out, from the letters the tajweed server found missing in it ([deleted]: the expected text
 * of its "delete" findings). The offline recogniser knows the Quran too well: where a word is left out in the middle of
 * an ayah (or its end), it often writes it anyway, squeezed between the words around it; the tajweed server hears
 * letters, and finds every letter of that word missing. Three quarters of the word's sounded letters, and at least
 * two, so a letter or a vowel lost at a stop is not taken for a word left out.
 */
export function leftOut(word: string, deleted: string[]): boolean {
  // A madd letter (a ya or waw with no mark of its own) is a length, which the server reports as a madd, not a letter.
  const want = sounded(word.replace(/^[ٱا]ل(?=.)/, '').replace(/[يوى](?![ً-ْٰۡ])/g, ''));
  if (want.length < 2) return false;
  const gone = sounded(deleted.join(' '));
  let found = 0;
  for (const c of want) {
    const i = gone.indexOf(c);
    if (i >= 0) {
      found++;
      gone.splice(i, 1);
    }
  }
  return found / want.length >= 0.75;
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
 * A finding the tajweed model is not sure enough of to show, seen on ordinary readers reciting at a normal pace:
 * - the vowel of a word's first letter "missing" (عَهْدَ heard «ع», أَن heard «ء»): a word in Arabic never starts
 *   without a vowel, the model lost it in the joined speech;
 * - a natural madd one count short (2 heard as 1): at a quicker pace the model counts short; a madd not made at all
 *   (heard 0) is still shown.
 */
export function unsureFinding(e: TajweedError, word: string): boolean {
  const first = (x: string) => x.replace(/[ً-ٰٟۖ-ۭـۦۥڇ]/g, '').replace(/[أإٱآ]/g, 'ء')[0] ?? '';
  if (e.type === 'tashkeel' && e.kind === 'delete' && e.expected && e.heard && !voweled(e.heard) && voweled(e.expected)) {
    const letter = first(e.expected);
    if (letter && letter === first(e.heard) && letter === first(word) && letters(e.expected).length === 1) return true;
  }
  if (e.type === 'tajweed' && e.rules?.some((r) => /المد الطبيعي/.test(r.ar)) && e.expectedLen != null && e.heardLen != null) {
    if (e.heardLen >= 1 && e.expectedLen - e.heardLen === 1) return true;
  }
  return false;
}

/** A vowel's kind: a (fatha, fathatan), u (damma, dammatan), i (kasra, kasratan), or '' (none, sukun). */
function vowelKind(s: string): string {
  if (/[ًَ]/.test(s)) return 'a';
  if (/[ٌُ]/.test(s)) return 'u';
  if (/[ٍِ]/.test(s)) return 'i';
  return '';
}

/** How long a sound is, in counts: its madd marks, or a letter written again for each count (a ghunnah, a shaddah). */
function soundLength(s: string): number {
  const madd = (s.match(/[ۦۥا]/g) ?? []).length;
  if (madd) return madd;
  const bare = letters(s);
  return bare.length;
}

/**
 * A finding the tajweed model gets wrong on ordinary voices through a phone's microphone, so it is not shown.
 * Studied on 1251 words recited on a phone by a reader reciting correctly, where the server's findings marked one word
 * in three; what is left marks about one in thirty, and still catches a vowel changed (الحمدُ said «الحمدَ»), a madd
 * cut to less than half, a madd not made, and Warsh's differences from Hafs:
 * - a vowel "not heard" (the letter said with no vowel) or "added": the model loses or invents short vowels in joined
 *   speech; a reader who says a word rightly almost never drops one;
 * - a vowel changed on a hamzat al-wasl (ٱللَّهَ heard «إِ»): its vowel depends on where the reader started;
 * - qalqalah: a phone's microphone barely carries its echo;
 * - a length (madd, ghunnah, shaddah) heard at least half as long as it should be: the model counts short on such
 *   voices (a natural madd of 2 heard as 1, a munfasil of 4 as 2, a ghunnah of 4 as 3), or long where a reader may
 *   lengthen (a madd made longer is not a mistake one should be stopped for).
 * (The studied phrases are kept on the test phone, see keepForStudy.)
 */
export function weakFinding(e: TajweedError, word: string): boolean {
  const expected = e.expected ?? '';
  const heard = e.heard ?? '';
  if (/ڇ/.test(expected + heard) || e.rules?.some((r) => /قلقل/.test(r.ar))) return true;
  if (e.type === 'tashkeel') {
    if (e.kind !== 'replace') return true;
    const el = letters(expected);
    const hl = letters(heard);
    // The same letter said with another vowel; anything else (a letter's length, two letters) is the model's hearing.
    if (el.length !== 1 || hl !== el) return true;
    const a = vowelKind(expected);
    const b = vowelKind(heard);
    if (!a || !b || a === b) return true;
    if (/^ٱ/.test(word) && /^[ءا]$/.test(el)) return true;
    return false;
  }
  if (e.type === 'tajweed') {
    if (e.kind === 'insert') return true;
    const want = e.expectedLen ?? soundLength(expected);
    const got = e.heardLen ?? (heard ? soundLength(heard) : 0);
    if (want > 0 && got * 2 >= want) return true;
    // A natural madd (2) "not made" at all: on a phone the model loses it in words said rightly (ٱللَّهُ, ٱلَّذِينَ,
    // ءَامَنُوا۟... a third of all it found). A longer madd (4, 6) not made is still shown.
    if (e.kind === 'delete' && want <= 2) return true;
  }
  return false;
}

/**
 * Whether [audio] starts (or ends) while the reciter's voice goes on: its first (last) 40 ms as loud as the voice
 * (within 12 dB of its loud frames). The phrase was cut there in the middle of the speech (the recogniser's timing of
 * a word is not exact), and the word at that edge may be cut too: the tajweed server then hears it short or missing.
 * Seen on a phone: the words wrongly found "left out" were nearly all at such an edge.
 */
export function voicedEdge(audio: Float32Array, edge: 'start' | 'end'): boolean {
  const F = 320;
  if (audio.length < 4 * F) return true;
  const level = (at: number) => {
    let p = 0;
    for (let i = at; i < at + F; i++) p += audio[i] * audio[i];
    return Math.sqrt(p / F);
  };
  const all: number[] = [];
  for (let at = 0; at + F <= audio.length; at += F) all.push(level(at));
  const loud = [...all].sort((a, b) => a - b)[Math.floor(all.length * 0.9)];
  const ends = edge === 'start' ? all.slice(0, 2) : all.slice(-2);
  return Math.max(...ends) >= loud / 4;
}

/**
 * A finding that is only how a reciter pauses (waqf) in the middle of a phrase, which the server, reading the
 * phrase as one breath, counts as a mistake: the last letter said with sukun (or qalqalah) instead of its vowel,
 * a madd lengthened at the stop ('arid), a ghunnah or idgham with the next word not made across the pause, or the
 * next word's first letter heard at the end of this one. Real mistakes are kept: a different vowel, an added vowel,
 * a missing madd. Checked on recitations by Husary and Minshawi (no false mistakes left) and a Warsh
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
