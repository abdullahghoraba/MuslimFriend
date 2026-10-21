import { Injectable, computed, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

export interface RemoteTafsir {
  /** quran.com API resource id (or IMPORTED_BASE + n for a tafsir imported from a file). */
  apiId: number;
  nameAr: string;
  nameEn: string;
  lang: 'ar' | 'en' | 'ur';
  /** Rough size of the full download, for the UI. */
  sizeMb: number;
  /** Set for a tafsir the user imported from a file on the device (never fetched from the network). */
  imported?: boolean;
  /** Credit line shown under the text for an imported tafsir. */
  source?: string;
  /** File name in assets/personal-tafsir/ when it came built into a personal build. */
  bundledFile?: string;
}

/** Ids of imported tafsirs start here, well away from quran.com resource ids. */
export const IMPORTED_BASE = 900_000;
const IMPORTED_KEY = 'importedTafsirs';
/** Built-in personal tafsirs the user deleted; they are not reinstalled. */
const DISMISSED_KEY = 'dismissedBundledTafsirs';

/**
 * File format for «استيراد تفسير من ملف» (JSON):
 * { "type": "muslim-friend-tafsir", "name": "…", "nameEn": "…", "author": "…", "lang": "ar", "source": "…",
 *   "ayahs": { "1:1": "text", "1:2": "text", … } }
 * A bare { "1:1": "text" | { "text": "…" } } map (e.g. a QUL tafsir JSON) is accepted too. Values that are
 * another verse key ("2:5") or empty mean "explained together with an earlier verse".
 */
export interface ParsedTafsir {
  nameAr: string;
  nameEn: string;
  lang: 'ar' | 'en' | 'ur';
  source: string;
  /** suras[s - 1][a - 1] = text ('' = covered by an earlier verse). */
  suras: string[][];
  filled: number;
}

export function parseTafsirFile(raw: string, ayahCounts: number[], fileName = ''): ParsedTafsir {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('not-json');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('bad-format');
  const o = json as Record<string, unknown>;
  const ayahs = (o['type'] === 'muslim-friend-tafsir' ? o['ayahs'] : o) as Record<string, unknown> | undefined;
  if (!ayahs || typeof ayahs !== 'object') throw new Error('bad-format');
  const suras = ayahCounts.map((n) => Array.from({ length: n }, () => ''));
  let filled = 0;
  for (const [key, value] of Object.entries(ayahs)) {
    const m = /^(\d{1,3}):(\d{1,3})$/.exec(key);
    if (!m) continue;
    const s = +m[1];
    const a = +m[2];
    if (s < 1 || s > ayahCounts.length || a < 1 || a > ayahCounts[s - 1]) continue;
    const text = typeof value === 'string' ? value : (value as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || /^\s*\d{1,3}:\d{1,3}\s*$/.test(text)) continue;
    const clean = cleanHtml(text);
    if (!clean) continue;
    suras[s - 1][a - 1] = clean;
    filled++;
  }
  if (!filled) throw new Error('empty');
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const base = fileName.replace(/\.[^.]+$/, '') || 'Tafsir';
  const name = str('name') || base;
  const lang = (['ar', 'en', 'ur'] as const).find((l) => l === str('lang')) ?? 'ar';
  const author = str('author');
  return {
    nameAr: author ? `${name} - ${author}` : name,
    nameEn: str('nameEn') || name,
    lang,
    source: str('source'),
    suras,
    filled,
  };
}

/** Extra tafsirs downloadable from the public quran.com API and kept offline afterwards. */
export const REMOTE_TAFSIRS: RemoteTafsir[] = [
  { apiId: 14, nameAr: 'تفسير ابن كثير', nameEn: 'Tafsir Ibn Kathir', lang: 'ar', sizeMb: 22 },
  { apiId: 91, nameAr: 'تفسير السعدي', nameEn: "Tafsir al-Sa'di", lang: 'ar', sizeMb: 6 },
  { apiId: 15, nameAr: 'تفسير الطبري', nameEn: 'Tafsir al-Tabari', lang: 'ar', sizeMb: 60 },
  { apiId: 90, nameAr: 'تفسير القرطبي', nameEn: 'Tafsir al-Qurtubi', lang: 'ar', sizeMb: 35 },
  { apiId: 94, nameAr: 'تفسير البغوي', nameEn: 'Tafsir al-Baghawi', lang: 'ar', sizeMb: 12 },
  { apiId: 93, nameAr: 'التفسير الوسيط (طنطاوي)', nameEn: 'Al-Wasit (Tantawi)', lang: 'ar', sizeMb: 25 },
  { apiId: 169, nameAr: 'ابن كثير المختصر (إنجليزي)', nameEn: 'Ibn Kathir Abridged (English)', lang: 'en', sizeMb: 20 },
  { apiId: 157, nameAr: 'في ظلال القرآن - سيد قطب (ترجمة أردية)', nameEn: 'Fi Zilal al-Quran - Sayyid Qutb (Urdu translation)', lang: 'ur', sizeMb: 18 },
];

const API = 'https://api.quran.com/api/v4';
const AYAH_COUNTS_URL = 'assets/quran/meta.json';

interface ApiPage {
  tafsirs: { verse_key: string; text: string }[];
  pagination?: { next_page: number | null };
}

/**
 * Downloadable tafsir library. Every sura fetched — by "Download all" or simply by reading it while
 * online — is saved to the app's private storage, so it is available offline from then on.
 * The browser dev build keeps an in-memory cache only.
 */
@Injectable({ providedIn: 'root' })
export class TafsirLibraryService {
  private readonly memory = new Map<string, string[]>();
  private ayahCounts?: number[];
  private cancel = false;

  /** Download progress for the whole-tafsir download. */
  readonly progress = signal<{ apiId: number; done: number; total: number } | null>(null);
  /** Number of suras stored offline per tafsir (refreshed by refreshCounts). */
  readonly offlineCounts = signal<Record<number, number>>({});
  /** Tafsirs the user imported from files on the device. */
  readonly imported = signal<RemoteTafsir[]>([]);
  /** Every non-bundled tafsir: downloadable ones, then imported ones. */
  readonly all = computed(() => [...REMOTE_TAFSIRS, ...this.imported()]);
  private importedLoaded?: Promise<void>;

  find(apiId: number): RemoteTafsir | undefined {
    return this.all().find((t) => t.apiId === apiId);
  }

  loadImported(): Promise<void> {
    return (this.importedLoaded ??= (async () => {
      const { value } = await Preferences.get({ key: IMPORTED_KEY });
      try {
        const list = value ? (JSON.parse(value) as RemoteTafsir[]) : [];
        this.imported.set(list.filter((t) => t && typeof t.apiId === 'number' && t.apiId >= IMPORTED_BASE).map((t) => ({ ...t, imported: true })));
      } catch {
        /* keep empty */
      }
      await this.installBundled();
    })());
  }

  /** Imports a tafsir file (see parseTafsirFile) and stores it offline. Returns the new entry. */
  async importFile(file: File): Promise<RemoteTafsir> {
    await this.loadImported();
    const entry = await this.store(await file.text(), file.name, file.size);
    await this.refreshCounts();
    return entry;
  }

  /**
   * Personal debug builds can carry tafsir files in assets/personal-tafsir/ (see scripts/personal-tafsir.mjs).
   * They are installed once, on first start, so they work offline with nothing to download.
   */
  private async installBundled(): Promise<void> {
    let index: { file: string; name: string }[];
    try {
      const res = await fetch('assets/personal-tafsir/index.json');
      if (!res.ok) return;
      index = await res.json();
    } catch {
      return;
    }
    const { value } = await Preferences.get({ key: DISMISSED_KEY });
    const dismissed: string[] = value ? JSON.parse(value) : [];
    for (const item of index) {
      if (dismissed.includes(item.file) || this.imported().some((t) => t.bundledFile === item.file)) continue;
      try {
        const res = await fetch('assets/personal-tafsir/' + encodeURIComponent(item.file));
        if (!res.ok) continue;
        const raw = await res.text();
        await this.store(raw, item.file, raw.length, item.file);
      } catch (e) {
        console.warn('[tafsir] bundled install failed', item.file, e);
      }
    }
  }

  private async store(raw: string, fileName: string, size: number, bundledFile?: string): Promise<RemoteTafsir> {
    const parsed = parseTafsirFile(raw, await this.counts(), fileName);
    const apiId = Math.max(IMPORTED_BASE, ...this.imported().map((t) => t.apiId)) + 1;
    for (let s = 1; s <= parsed.suras.length; s++) {
      this.memory.set(`${apiId}/${s}`, parsed.suras[s - 1]);
      await this.writeFile(apiId, s, parsed.suras[s - 1]);
    }
    const entry: RemoteTafsir = {
      apiId, nameAr: parsed.nameAr, nameEn: parsed.nameEn, lang: parsed.lang, source: parsed.source,
      sizeMb: Math.max(1, Math.round(size / 1_000_000)), imported: true, ...(bundledFile ? { bundledFile } : {}),
    };
    await this.saveImported([...this.imported(), entry]);
    return entry;
  }

  private async saveImported(list: RemoteTafsir[]): Promise<void> {
    this.imported.set(list);
    await Preferences.set({ key: IMPORTED_KEY, value: JSON.stringify(list) });
  }

  /** Tafsir for one ayah. Uses the offline copy, or fetches (and saves) the sura when online. */
  async ayah(apiId: number, sura: number, aya: number): Promise<{ text: string; covered: boolean }> {
    const list = await this.sura(apiId, sura);
    if (!list) throw new Error('offline');
    let text = list[aya - 1] ?? '';
    // Some tafsirs explain several ayat together; show the explanation that covers this ayah.
    let i = aya - 1;
    while (!text && i > 0) text = list[--i] ?? '';
    return { text, covered: i !== aya - 1 };
  }

  /** Returns the sura's ayat (cached → offline file → network). Null when offline and not downloaded. */
  async sura(apiId: number, sura: number): Promise<string[] | null> {
    const key = `${apiId}/${sura}`;
    const cached = this.memory.get(key);
    if (cached) return cached;
    const offline = await this.readFile(apiId, sura);
    if (offline) {
      this.memory.set(key, offline);
      return offline;
    }
    // Imported tafsirs exist only on the device.
    if (apiId >= IMPORTED_BASE) return null;
    try {
      const fetched = await this.fetchSura(apiId, sura);
      this.memory.set(key, fetched);
      await this.writeFile(apiId, sura, fetched);
      return fetched;
    } catch {
      return null;
    }
  }

  async isSuraOffline(apiId: number, sura: number): Promise<boolean> {
    return this.memory.has(`${apiId}/${sura}`) || !!(await this.readFile(apiId, sura));
  }

  /** Downloads all 114 suras (skips ones already saved). Returns false if cancelled or failed. */
  async downloadAll(apiId: number): Promise<boolean> {
    this.cancel = false;
    this.progress.set({ apiId, done: 0, total: 114 });
    try {
      for (let sura = 1; sura <= 114; sura++) {
        if (this.cancel) return false;
        if (!(await this.readFile(apiId, sura))) {
          const list = await this.fetchSura(apiId, sura);
          await this.writeFile(apiId, sura, list);
        }
        this.progress.set({ apiId, done: sura, total: 114 });
      }
      return true;
    } catch {
      return false;
    } finally {
      this.progress.set(null);
      await this.refreshCounts();
    }
  }

  cancelDownload(): void {
    this.cancel = true;
  }

  async remove(apiId: number): Promise<void> {
    for (const key of [...this.memory.keys()]) if (key.startsWith(`${apiId}/`)) this.memory.delete(key);
    if (Capacitor.isNativePlatform()) {
      await Filesystem.rmdir({ path: `tafsir/${apiId}`, directory: Directory.Data, recursive: true }).catch(() => {});
    }
    const bundled = this.imported().find((t) => t.apiId === apiId)?.bundledFile;
    if (bundled) {
      const { value } = await Preferences.get({ key: DISMISSED_KEY });
      await Preferences.set({ key: DISMISSED_KEY, value: JSON.stringify([...(value ? JSON.parse(value) : []), bundled]) });
    }
    if (apiId >= IMPORTED_BASE) await this.saveImported(this.imported().filter((t) => t.apiId !== apiId));
    await this.refreshCounts();
  }

  async refreshCounts(): Promise<void> {
    await this.loadImported();
    const counts: Record<number, number> = {};
    for (const t of this.all()) {
      counts[t.apiId] = Capacitor.isNativePlatform()
        ? await Filesystem.readdir({ path: `tafsir/${t.apiId}`, directory: Directory.Data }).then((r) => r.files.length, () => 0)
        : [...this.memory.keys()].filter((k) => k.startsWith(`${t.apiId}/`)).length;
    }
    this.offlineCounts.set(counts);
  }

  private async fetchSura(apiId: number, sura: number): Promise<string[]> {
    const ayas = (await this.counts())[sura - 1];
    const out: string[] = Array.from({ length: ayas }, () => '');
    let page: number | null = 1;
    while (page) {
      const res = await fetch(`${API}/tafsirs/${apiId}/by_chapter/${sura}?per_page=50&page=${page}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as ApiPage;
      for (const t of body.tafsirs) {
        const aya = Number(t.verse_key.split(':')[1]);
        if (aya >= 1 && aya <= ayas) out[aya - 1] = cleanHtml(t.text);
      }
      page = body.pagination?.next_page ?? null;
    }
    return out;
  }

  private async counts(): Promise<number[]> {
    if (!this.ayahCounts) {
      const meta = (await (await fetch(AYAH_COUNTS_URL)).json()) as { suras: { ayas: number }[] };
      this.ayahCounts = meta.suras.map((s) => s.ayas);
    }
    return this.ayahCounts;
  }

  private path(apiId: number, sura: number): string {
    return `tafsir/${apiId}/${String(sura).padStart(3, '0')}.json`;
  }

  private async readFile(apiId: number, sura: number): Promise<string[] | null> {
    if (!Capacitor.isNativePlatform()) return null;
    try {
      const { data } = await Filesystem.readFile({ path: this.path(apiId, sura), directory: Directory.Data, encoding: Encoding.UTF8 });
      return JSON.parse(typeof data === 'string' ? data : await data.text()) as string[];
    } catch {
      return null;
    }
  }

  private async writeFile(apiId: number, sura: number, list: string[]): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    await Filesystem.writeFile({
      path: this.path(apiId, sura),
      data: JSON.stringify(list),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }
}

/** The API returns light HTML (spans, <p>, <br>); keep the text and paragraph breaks only. */
export function cleanHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
