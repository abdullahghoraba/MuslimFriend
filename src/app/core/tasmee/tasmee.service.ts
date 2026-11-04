import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { wordKey } from './align';

/** A finished tasmee' session, kept to see progress and go back to the mistakes. */
export interface TasmeeSession {
  at: number;
  sura: number;
  from: number;
  to: number;
  /** Correct share of the words recited, 0..1. */
  score: number;
  words: number;
  mistakes: { aya: number; word: string; heard?: string; kind: 'wrong' | 'skipped' }[];
}

/** 'phone': Google's (or the phone's) recogniser; 'offline': the Quran-trained model on the phone (quran-speech.ts). */
export type TasmeeEngine = 'phone' | 'offline';

export interface TasmeePrefs {
  engine: TasmeeEngine;
  /** Memorisation mode: the words appear only as they are recited. */
  hideText: boolean;
  /** Stop at a mistake and show the right word. */
  stopOnMistake: boolean;
}

const HISTORY_KEY = 'tasmeeHistory';
const PREFS_KEY = 'tasmeePrefs';

/** What reciters say before the ayat; not counted (unless the ayat start with it, as al-Fatihah does). */
const OPENINGS = ['اعوذ بالله من الشيطان الرجيم', 'بسم الله الرحمن الرحيم'].map((s) => s.split(' ').map(wordKey));

/** Drops the isti'adha and basmala said before the ayat, when the ayat do not start with them. */
export function dropOpenings(heard: string[], expectedFirst: string[]): string[] {
  const keys = heard.map(wordKey);
  const startsWith = (words: string[], seq: string[]) => seq.every((k, i) => words[i] === k);
  let at = 0;
  for (let changed = true; changed; ) {
    changed = false;
    for (const seq of OPENINGS) {
      const expectedHasIt = startsWith(expectedFirst.map(wordKey), seq);
      if (!expectedHasIt && startsWith(keys.slice(at), seq)) {
        at += seq.length;
        changed = true;
      }
    }
  }
  return heard.slice(at);
}

@Injectable({ providedIn: 'root' })
export class TasmeeService {
  readonly history = signal<TasmeeSession[]>([]);
  readonly prefs = signal<TasmeePrefs>({ engine: 'phone', hideText: true, stopOnMistake: false });
  private loaded?: Promise<void>;

  load(): Promise<void> {
    this.loaded ??= (async () => {
      const [h, p] = await Promise.all([Preferences.get({ key: HISTORY_KEY }), Preferences.get({ key: PREFS_KEY })]);
      try {
        const list = h.value ? (JSON.parse(h.value) as TasmeeSession[]) : [];
        this.history.set(Array.isArray(list) ? list : []);
      } catch {
        this.history.set([]);
      }
      try {
        const v = p.value ? (JSON.parse(p.value) as Partial<TasmeePrefs>) : {};
        this.prefs.update((d) => ({
          engine: v.engine === 'offline' || (v.engine as string) === 'whisper' ? 'offline' : d.engine,
          hideText: typeof v.hideText === 'boolean' ? v.hideText : d.hideText,
          stopOnMistake: typeof v.stopOnMistake === 'boolean' ? v.stopOnMistake : d.stopOnMistake,
        }));
      } catch {
        /* defaults */
      }
    })();
    return this.loaded;
  }

  async setPrefs(patch: Partial<TasmeePrefs>): Promise<void> {
    this.prefs.update((p) => ({ ...p, ...patch }));
    await Preferences.set({ key: PREFS_KEY, value: JSON.stringify(this.prefs()) });
  }

  async save(session: TasmeeSession): Promise<void> {
    await this.load();
    // The last 100 sessions are enough to see progress.
    this.history.update((list) => [session, ...list].slice(0, 100));
    await Preferences.set({ key: HISTORY_KEY, value: JSON.stringify(this.history()) });
  }

  /** Best score so far for these ayat (to show progress). */
  best(sura: number, from: number, to: number): number | null {
    const s = this.history().filter((x) => x.sura === sura && x.from === from && x.to === to);
    return s.length ? Math.max(...s.map((x) => x.score)) : null;
  }
}
