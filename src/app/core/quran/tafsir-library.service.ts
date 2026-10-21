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
  /** Where downloads come from: quran.com (default) or the spa5k open dataset ([slug] folder). */
  provider?: 'spa5k';
  slug?: string;
}

/** Ids of imported tafsirs start here, well away from quran.com resource ids. */
export const IMPORTED_BASE = 900_000;
const IMPORTED_KEY = 'importedTafsirs';
/** quran.com ids that were offered before and later removed. */
const REMOVED_TAFSIRS = [157];
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
  { apiId: 168, nameAr: 'معارف القرآن (إنجليزي)', nameEn: "Ma'arif al-Qur'an (English)", lang: 'en', sizeMb: 30 },
  { apiId: 817, nameAr: 'تذكير القرآن (إنجليزي)', nameEn: 'Tazkirul Quran (English)', lang: 'en', sizeMb: 6 },
  // Classical tafsirs (public domain) and openly licensed ones, from the spa5k/tafsir_api open dataset (QUL data).
  // Ids are fixed: they name the offline folder on the phone.
  ...spa5k(700_001, 'ar-tafseer-tahrir-al-tanwir', 'التحرير والتنوير - ابن عاشور', 'Al-Tahrir wa al-Tanwir (Ibn Ashur)', 80),
  ...spa5k(700_002, 'tafsir-al-razi', 'مفاتيح الغيب (التفسير الكبير) - الرازي', 'Mafatih al-Ghayb (al-Razi)', 96),
  ...spa5k(700_003, 'tafsir-al-alusi', 'روح المعاني - الألوسي', "Ruh al-Ma'ani (al-Alusi)", 57),
  ...spa5k(700_004, 'al-kashshaf-al-zamakhshari', 'الكشاف - الزمخشري', 'Al-Kashshaf (al-Zamakhshari)', 29),
  ...spa5k(700_005, 'tafsir-al-baydawi', 'أنوار التنزيل - البيضاوي', 'Anwar al-Tanzil (al-Baydawi)', 9),
  ...spa5k(700_006, 'tafsir-al-nasafi', 'مدارك التنزيل - النسفي', 'Madarik al-Tanzil (al-Nasafi)', 8),
  ...spa5k(700_007, 'fath-al-qadir-al-shawkani', 'فتح القدير - الشوكاني', 'Fath al-Qadir (al-Shawkani)', 180),
  ...spa5k(700_008, 'tafsir-ibn-juzay', 'التسهيل لعلوم التنزيل - ابن جزي', 'Al-Tashil (Ibn Juzay)', 9),
  ...spa5k(700_009, 'al-muharrar-al-wajiz-ibn-atiyyah', 'المحرر الوجيز - ابن عطية', 'Al-Muharrar al-Wajiz (Ibn Atiyyah)', 65),
  ...spa5k(700_010, 'al-bahr-al-muhit', 'البحر المحيط - أبو حيان', 'Al-Bahr al-Muhit (Abu Hayyan)', 173),
  ...spa5k(700_011, 'tafsir-ibn-al-jawzi', 'زاد المسير - ابن الجوزي', 'Zad al-Masir (Ibn al-Jawzi)', 47),
  ...spa5k(700_012, 'al-durr-al-manthur', 'الدر المنثور - السيوطي', 'Al-Durr al-Manthur (al-Suyuti)', 62),
  ...spa5k(700_013, 'tafsir-ibn-abi-hatim', 'تفسير ابن أبي حاتم', 'Tafsir Ibn Abi Hatim', 11),
  ...spa5k(700_014, 'tafsir-abi-al-su-ood', 'إرشاد العقل السليم - أبو السعود', "Irshad al-'Aql al-Salim (Abu al-Su'ud)", 17),
  ...spa5k(700_015, 'tafsir-al-mawardi', 'النكت والعيون - الماوردي', "Al-Nukat wa al-'Uyun (al-Mawardi)", 31),
  ...spa5k(700_016, 'tafsir-al-samarqandi', 'بحر العلوم - السمرقندي', "Bahr al-'Ulum (al-Samarqandi)", 31),
  ...spa5k(700_017, 'tafsir-al-sam-ani', 'تفسير السمعاني', "Tafsir al-Sam'ani", 8),
  ...spa5k(700_018, 'al-wajiz-wahidi', 'الوجيز - الواحدي', 'Al-Wajiz (al-Wahidi)', 1),
  ...spa5k(700_019, 'al-basit', 'البسيط - الواحدي', 'Al-Basit (al-Wahidi)', 30),
  ...spa5k(700_020, 'nazam-al-durar-al-biqa-i', 'نظم الدرر - البقاعي', "Nazm al-Durar (al-Biqa'i)", 28),
  ...spa5k(700_021, 'mahasin-al-ta-wil-al-qasimi', 'محاسن التأويل - القاسمي', "Mahasin al-Ta'wil (al-Qasimi)", 35),
  ...spa5k(700_022, 'tafsir-ibn-abi-zamanin', 'تفسير ابن أبي زمنين', 'Tafsir Ibn Abi Zamanin', 3),
  ...spa5k(700_023, 'tafsir-makhi', 'الهداية إلى بلوغ النهاية - مكي بن أبي طالب', 'Al-Hidayah (Makki ibn Abi Talib)', 61),
  ...spa5k(700_024, 'al-lubab-fi-ulum-al-kitab', 'اللباب في علوم الكتاب - ابن عادل', "Al-Lubab (Ibn 'Adil)", 134),
  ...spa5k(700_025, 'jamia-al-bayan-aliji', 'جامع البيان - الإيجي', "Jami' al-Bayan (al-Iji)", 43),
  ...spa5k(700_026, 'fath-al-bayan-li-al-qanuji', 'فتح البيان - القنوجي', 'Fath al-Bayan (al-Qanuji)', 16),
  ...spa5k(700_027, 'tafsir-ibn-al-qayyim', 'تفسير ابن القيم', 'Tafsir Ibn al-Qayyim', 30),
  ...spa5k(700_028, 'adwa-al-bayan', 'أضواء البيان - الشنقيطي', "Adwa' al-Bayan (al-Shanqiti)", 17),
  ...spa5k(700_029, 'al-dur-al-masun-lil-samin-al-halabi', 'الدر المصون - السمين الحلبي', 'Al-Durr al-Masun (al-Samin al-Halabi)', 14),
  ...spa5k(700_030, 'ar-tafseer-tanwir-al-miqbas', 'تنوير المقباس من تفسير ابن عباس', 'Tanwir al-Miqbas', 29),
  ...spa5k(700_031, 'ar-tafsir-al-jami-al-wajiz', 'الجامع الوجيز - د. أيمن العامر (CC BY-ND)', "Al-Jami' al-Wajiz (CC BY-ND 4.0)", 10),
];

/** A tafsir served as static per-sura JSON files by the open spa5k/tafsir_api dataset. */
function spa5k(apiId: number, slug: string, nameAr: string, nameEn: string, sizeMb: number): RemoteTafsir[] {
  return [{ apiId, slug, nameAr, nameEn, lang: 'ar', sizeMb, provider: 'spa5k' }];
}
const SPA5K_URLS = [
  'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir',
  // jsDelivr refuses some very large files; GitHub serves them (with CORS).
  'https://raw.githubusercontent.com/spa5k/tafsir_api/main/tafsir',
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
      // Tafsirs removed from the library: free the space of any old download (157 = Fi Zilal, Urdu).
      if (Capacitor.isNativePlatform()) {
        for (const id of REMOVED_TAFSIRS) await Filesystem.rmdir({ path: `tafsir/${id}`, directory: Directory.Data, recursive: true }).catch(() => {});
      }
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
    const info = this.find(apiId);
    if (info?.provider === 'spa5k' && info.slug) return this.fetchSpa5k(info.slug, sura, ayas);
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

  private async fetchSpa5k(slug: string, sura: number, ayas: number): Promise<string[]> {
    let lastError: unknown;
    for (const base of SPA5K_URLS) {
      try {
        const res = await fetch(`${base}/${slug}/${sura}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return spa5kToAyat((await res.json()) as { ayah: number; text: string }[], ayas);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
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

/**
 * spa5k files list every ayah; a passage explained once is repeated on each of its ayat.
 * Keep it on the first ayah only ('' after it), so the reader shows it once and storage stays small.
 */
export function spa5kToAyat(entries: { ayah: number; text: string }[], ayas: number): string[] {
  const out: string[] = Array.from({ length: ayas }, () => '');
  let previous = '';
  for (const e of [...entries].sort((a, b) => a.ayah - b.ayah)) {
    if (!(e.ayah >= 1 && e.ayah <= ayas) || typeof e.text !== 'string') continue;
    // Printed-edition page markers ("صفحة ١٣٧", "(p-٣٦٩)") mean nothing on a phone.
    const text = cleanHtml(e.text)
      .replace(/^\s*صفحة\s*[٠-٩0-9]+\s*$/gm, '')
      .replace(/\(p-[٠-٩0-9]+\)/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    out[e.ayah - 1] = text && text !== previous ? text : '';
    if (text) previous = text;
  }
  return out;
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
