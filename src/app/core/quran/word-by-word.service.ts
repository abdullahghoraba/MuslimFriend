import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

/** One word of an ayah: the Uthmani text, its pronunciation, its meaning and its recitation. */
export interface QuranWord {
  ar: string;
  /** Latin transliteration. */
  tr: string;
  meaning: string;
  /** Path on audio.qurancdn.com, e.g. "wbw/001_002_001.mp3". */
  audio: string;
}

/** Languages quran.com has word-by-word meanings in; the others read the English ones. */
export const WORD_LANGS = ['en', 'ur', 'id', 'bn', 'tr', 'fa', 'hi'] as const;
export type WordLang = (typeof WORD_LANGS)[number];
export const isWordLang = (x: unknown): x is WordLang => WORD_LANGS.includes(x as WordLang);

const API = 'https://api.quran.com/api/v4/verses/by_chapter';
export const WORD_AUDIO = 'https://audio.qurancdn.com/';
const LANG_KEY = 'wordByWordLang';

interface ApiWord {
  char_type_name: string;
  text_uthmani?: string;
  audio_url?: string | null;
  translation?: { text?: string };
  transliteration?: { text?: string | null };
}

/** The words of each ayah of a sura (index 0 = ayah 1), without the ayah-number marks. */
export function parseWords(json: { verses?: { verse_key: string; words?: ApiWord[] }[] }): QuranWord[][] {
  const ayat: QuranWord[][] = [];
  for (const v of json.verses ?? []) {
    const aya = Number(v.verse_key.split(':')[1]);
    ayat[aya - 1] = (v.words ?? [])
      .filter((w) => w.char_type_name === 'word')
      .map((w) => ({ ar: w.text_uthmani ?? '', tr: w.transliteration?.text ?? '', meaning: w.translation?.text ?? '', audio: w.audio_url ?? '' }));
  }
  return ayat;
}

/**
 * Word-by-word meanings from quran.com, fetched a sura at a time when the reader first asks and kept on the phone,
 * so a sura opened once works offline afterwards. Only the sura number and language are sent.
 */
@Injectable({ providedIn: 'root' })
export class WordByWordService {
  private readonly memory = new Map<string, Promise<QuranWord[][]>>();
  /** The language the reader chose for meanings, or null to follow the app language. */
  readonly chosen = signal<WordLang | null>(null);
  private loaded = false;

  async loadChoice(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const { value } = await Preferences.get({ key: LANG_KEY });
    if (isWordLang(value)) this.chosen.set(value);
  }

  /** The language meanings are shown in: the reader's choice, else the app language when quran.com has it, else English. */
  langFor(appLang: string): WordLang {
    return this.chosen() ?? (isWordLang(appLang) ? appLang : 'en');
  }

  async choose(lang: WordLang): Promise<void> {
    this.chosen.set(lang);
    await Preferences.set({ key: LANG_KEY, value: lang });
  }

  /** The words of [sura]:[aya] with meanings in [lang]. */
  async ayah(sura: number, aya: number, lang: WordLang): Promise<QuranWord[]> {
    return (await this.sura(sura, lang))[aya - 1] ?? [];
  }

  sura(sura: number, lang: WordLang): Promise<QuranWord[][]> {
    const key = `${lang}/${sura}`;
    let p = this.memory.get(key);
    if (!p) {
      p = this.read(key).then((saved) => saved ?? this.fetch(sura, lang, key));
      // A failed fetch (offline) is not kept, so the next try asks again.
      p.catch(() => this.memory.delete(key));
      this.memory.set(key, p);
    }
    return p;
  }

  private async fetch(sura: number, lang: WordLang, key: string): Promise<QuranWord[][]> {
    const res = await fetch(`${API}/${sura}?language=${lang}&words=true&word_fields=text_uthmani&fields=verse_key&per_page=300`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const words = parseWords(await res.json());
    if (!words.length) throw new Error('No words');
    if (Capacitor.isNativePlatform()) {
      await Filesystem.writeFile({ path: `wbw/${key}.json`, data: JSON.stringify(words), directory: Directory.Data, encoding: Encoding.UTF8, recursive: true }).catch(() => {});
    }
    return words;
  }

  private async read(key: string): Promise<QuranWord[][] | null> {
    if (!Capacitor.isNativePlatform()) return null;
    try {
      const { data } = await Filesystem.readFile({ path: `wbw/${key}.json`, directory: Directory.Data, encoding: Encoding.UTF8 });
      return JSON.parse(String(data));
    } catch {
      return null;
    }
  }
}
