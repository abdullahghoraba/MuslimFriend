import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

export interface RemoteTafsir {
  /** quran.com API resource id. */
  apiId: number;
  nameAr: string;
  nameEn: string;
  lang: 'ar' | 'en';
  /** Rough size of the full download, for the UI. */
  sizeMb: number;
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

  find(apiId: number): RemoteTafsir | undefined {
    return REMOTE_TAFSIRS.find((t) => t.apiId === apiId);
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
    await this.refreshCounts();
  }

  async refreshCounts(): Promise<void> {
    const counts: Record<number, number> = {};
    for (const t of REMOTE_TAFSIRS) {
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
