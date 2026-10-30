import { Injectable, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { HadithStorage } from './hadith-storage.service';
import { dailyCandidates, isGoodDaily, localDay } from './daily-online';
import { DailyHadith, Hadith, HadithCollection, HadithEdition, HadithPackage, dailyIndex, hadithText, normalizeHadith, readHadiths, validateEdition } from './hadith.models';

const CDN = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/';
const DAILY_KEY = 'hadith-daily-online';
const SAHIH_AR: Record<string, string> = { bukhari: 'صحيح البخاري', muslim: 'صحيح مسلم' };
interface OneHadith { metadata: { section: Record<string, string> }; hadiths: { hadithnumber: number | string; arabicnumber?: number | string; text: string; reference: { book: number; hadith: number } }[] }
@Injectable({ providedIn: 'root' })
export class HadithLibraryService {
  private readonly storage = inject(HadithStorage);
  readonly collections = signal<HadithCollection[]>([]);
  readonly downloaded = signal<string[]>([]);
  readonly daily = signal<DailyHadith[]>([]);
  readonly progress = signal<{ id: string; edition: number; total: number; bytes: number; fraction: number | null; saving: boolean } | null>(null);
  private loaded?: Promise<void>;
  private readonly packages = new Map<string, HadithPackage>();
  private controller?: AbortController;

  async init(): Promise<void> {
    return this.loaded ??= this.load().catch((e: unknown) => { this.loaded = undefined; throw e; });
  }
  private async load(): Promise<void> {
    const [catalog, daily, keys] = await Promise.all([
      this.asset<HadithCollection[]>('catalog'), this.asset<DailyHadith[]>('daily'), this.storage.keys(),
    ]);
    this.collections.set(catalog); this.daily.set(daily);
    this.downloaded.set(keys.filter((key) => key.startsWith('collection-')).map((key) => key.slice(11)));
  }
  private async asset<T>(name: string): Promise<T> {
    const r = await fetch(`assets/hadith/${name}.json`);
    if (!r.ok) throw Error('asset-missing');
    return r.json() as Promise<T>;
  }
  find(id: string): HadithCollection | undefined { return this.collections().find((c) => c.id === id); }
  available(id: string): boolean { return !!this.find(id)?.bundled || this.downloaded().includes(id); }
  today(date = new Date()): DailyHadith | undefined { return this.daily()[dailyIndex(date, this.daily().length)]; }

  /**
   * Hadith of the day from Sahih al-Bukhari / Sahih Muslim, fetched once a day (about 1 KB, plus the reader's
   * translation) and kept until the next day. Null offline; Home then shows a bundled one.
   */
  async onlineDaily(date: Date, lang: string): Promise<Hadith | null> {
    const day = localDay(date);
    try {
      const { value } = await Preferences.get({ key: DAILY_KEY });
      const cached = value ? (JSON.parse(value) as { day: number; lang: string; hadith: Hadith }) : null;
      if (cached?.day === day && cached.lang === lang && cached.hadith?.arabic) return cached.hadith;
    } catch {
      /* fetch again */
    }
    await this.init();
    const { collection, numbers } = dailyCandidates(day);
    const edition = this.find(collection)?.editions[lang] ?? (lang === 'ar' ? undefined : this.find(collection)?.editions['en']);
    try {
      return await this.firstGood(collection, numbers, day, lang, edition);
    } catch {
      return null;
    }
  }

  private async firstGood(collection: string, numbers: number[], day: number, lang: string, edition?: string): Promise<Hadith | null> {
    for (const n of numbers) {
      const ar = await this.one(`ara-${collection}`, n);
      const arabic = ar ? hadithText(ar.hadiths[0]?.text ?? '') : '';
      if (!ar || !isGoodDaily(arabic)) continue;
      const h = ar.hadiths[0];
      // A missing translation never costs the day its hadith.
      const tr = lang !== 'ar' && edition ? await this.one(edition, n).catch(() => null) : null;
      const translation = tr ? hadithText(tr.hadiths[0]?.text ?? '') : '';
      const hadith: Hadith = {
        collection, number: String(h.hadithnumber), book: h.reference.book, bookHadith: h.reference.hadith,
        arabicNumber: String(h.arabicnumber ?? h.hadithnumber), arabic, translation,
        translationLang: translation ? (edition?.startsWith('eng') && lang !== 'en' ? 'en' : lang) : lang,
        grades: [], bookName: (tr ?? ar).metadata.section[String(h.reference.book)] ?? '',
        // The narrator comes from the Dorar lookup: guessing it from a long chain names the wrong man too often.
        authenticitySource: SAHIH_AR[collection],
      };
      await Preferences.set({ key: DAILY_KEY, value: JSON.stringify({ day, lang, hadith }) }).catch(() => {});
      return hadith;
    }
    return null;
  }

  /** One hadith of an edition; null when it is missing; throws when the network fails. */
  private async one(edition: string, n: number): Promise<OneHadith | null> {
    for (const file of [`${n}.min.json`, `${n}.json`]) {
      try {
        const r = await fetch(`${CDN}${edition}/${file}`, { signal: AbortSignal.timeout(10_000) });
        if (r.status === 404) return null;
        if (!r.ok) continue;
        const data = (await r.json()) as OneHadith;
        return typeof data?.hadiths?.[0]?.text === 'string' && Number.isInteger(data.hadiths[0].reference?.book) ? data : null;
      } catch {
        // Offline or timed out: give up for now instead of trying every candidate.
        throw Error('offline');
      }
    }
    return null;
  }
  async package(id: string): Promise<HadithPackage | null> {
    await this.init();
    const collection = this.find(id);
    if (!collection) return null;
    let pack = this.packages.get(id);
    if (!pack) {
      pack = collection.bundled ? await this.asset<HadithPackage>(id) : await this.storage.read<HadithPackage>(`collection-${id}`) ?? undefined;
      if (pack) {
        if (pack.collection !== id || pack.version !== 1 || !pack.editions['ar']) throw Error('invalid-package');
        for (const edition of Object.values(pack.editions)) validateEdition(edition);
        this.packages.set(id, pack);
        // Keep device memory bounded when searching every downloaded collection.
        while (this.packages.size > 2) this.packages.delete(this.packages.keys().next().value!);
      }
    }
    return pack ?? null;
  }
  async hadiths(id: string, lang: string): Promise<Hadith[]> {
    const pack = await this.package(id);
    if (!pack) return [];
    return readHadiths(pack, lang).map((h) => {
      const extra = this.daily().find((d) => d.collection === id && d.number === h.number);
      return extra ? { ...h, narrator: extra.narrator, authenticitySource: extra.authenticitySource } : h;
    });
  }

  /** Called only by the explicit Download button; English is the per-hadith fallback. */
  async download(id: string, lang: string): Promise<'complete' | 'cancelled'> {
    await this.init();
    const collection = this.find(id);
    if (!collection || collection.bundled || this.progress()) throw Error('download-unavailable');
    const controller = new AbortController(); this.controller = controller;
    const languages = [...new Set(['ar', 'en', lang])].filter((l) => collection.editions[l]);
    this.progress.set({ id, edition: 0, total: languages.length, bytes: 0, fraction: null, saving: false });
    try {
      const old = await this.package(id);
      const editions = { ...old?.editions };
      for (const [index, language] of languages.entries()) {
        controller.signal.throwIfAborted();
        this.progress.set({ id, edition: index, total: languages.length, bytes: 0, fraction: null, saving: false });
        if (!editions[language]) editions[language] = await this.fetchEdition(collection.editions[language], controller.signal);
      }
      controller.signal.throwIfAborted();
      const pack: HadithPackage = { version: 1, collection: id, editions };
      this.progress.update((p) => p ? { ...p, edition: languages.length, fraction: 1, saving: true } : p);
      await this.storage.write(`collection-${id}`, pack);
      this.packages.set(id, pack);
      this.downloaded.update((ids) => [...new Set([...ids, id])]);
      return 'complete';
    } catch (e) {
      if (controller.signal.aborted) return 'cancelled';
      throw e;
    } finally { this.progress.set(null); this.controller = undefined; }
  }
  cancelDownload(): void { if (!this.progress()?.saving) this.controller?.abort(); }
  private async fetchEdition(edition: string, signal: AbortSignal): Promise<HadithEdition> {
    const r = await fetch(`${CDN}${edition}.json`, { signal });
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    const length = Number(r.headers.get('content-length'));
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = r.body?.getReader();
    let raw: unknown;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); bytes += value.byteLength;
        this.progress.update((p) => p ? { ...p, bytes, fraction: length > 0 ? Math.min(.99, bytes / length) : null } : p);
      }
      const buffer = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
      raw = JSON.parse(new TextDecoder().decode(buffer));
    } else raw = await r.json();
    validateEdition(raw);
    return raw;
  }
  async remove(id: string): Promise<void> {
    if (this.find(id)?.bundled || this.progress()) throw Error('remove-unavailable');
    await this.storage.remove(`collection-${id}`);
    this.packages.delete(id); this.downloaded.update((ids) => ids.filter((x) => x !== id));
  }
  /** Search is cancellable between collections and yields between batches on modest devices. */
  async search(query: string, lang: string, signal?: AbortSignal): Promise<Hadith[]> {
    await this.init();
    const words = normalizeHadith(query).split(' ').filter(Boolean);
    if (normalizeHadith(query).length < 2) return [];
    const matches: Hadith[] = [];
    for (const c of this.collections().filter((c) => this.available(c.id))) {
      signal?.throwIfAborted();
      const rows = await this.hadiths(c.id, lang);
      for (let i = 0; i < rows.length; i++) {
        if (i % 200 === 0) { await new Promise((resolve) => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
        const h = rows[i];
        const text = normalizeHadith(`${h.arabic} ${h.translation} ${h.number}`);
        if (words.every((w) => text.includes(w))) matches.push(h);
      }
    }
    return matches;
  }
}
