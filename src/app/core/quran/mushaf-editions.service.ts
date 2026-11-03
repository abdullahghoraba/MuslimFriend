import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { AyahRef } from './quran-utils';
import { MushafLayout, shamarlyLayout } from './mushaf-layout';

/**
 * Mushaf editions:
 * - madinah: the built-in Madani mushaf (Tanzil text, 604 pages);
 * - tajweed: the same pages and text with the tajweed rules coloured (rules from quran.com's tajweed markup);
 * - shamarly: the Egyptian Shamarly mushaf, page images (archive.org/details/shamerly), 522 pages, each ayah tappable
 *   (areas from scripts/shamarly-ayat);
 * - the riwayat of the King Fahd Complex (qurancomplex.gov.sa), text and font, each with its own pages.
 */
export type EditionId = 'madinah' | 'tajweed' | 'shamarly' | 'warsh' | 'qaloon' | 'shouba' | 'doori' | 'soosi' | 'bazzi' | 'qumbul';
export type EditionKind = 'hafs' | 'tajweed' | 'images' | 'riwaya';

export interface Edition {
  id: EditionId;
  kind: EditionKind;
  nameAr: string;
  nameEn: string;
  /** The reading (qira'ah) it follows, for the list. */
  qiraahAr: string;
  qiraahEn: string;
  /** Download size in MB (0 = built in; images: the whole mushaf for offline use). */
  sizeMb: number;
  /** KFGQPC data folder, JSON file and font on jsDelivr. */
  kfgqpc?: { folder: string; data: string; font: string };
}

const KFGQPC = 'https://cdn.jsdelivr.net/gh/thetruetruth/quran-data-kfgqpc@main';
const TAJWEED_URL = 'https://api.quran.com/api/v4/quran/verses/uthmani_tajweed';
const SHAMARLY_IMG = 'https://archive.org/download/shamerly';
/** archive.org's own servers for the item: asking once skips the slow redirect on every page. */
const SHAMARLY_META = 'https://archive.org/metadata/shamerly';
const SHAMARLY_SERVER_KEY = 'shamarlyServer';
const DIR = 'editions';
const EDITION_KEY = 'mushafEdition';
const PAGE_KEY = 'mushafEditionPage.';

export const EDITIONS: Edition[] = [
  { id: 'madinah', kind: 'hafs', nameAr: 'مصحف المدينة', nameEn: 'Madinah Mushaf', qiraahAr: 'حفص عن عاصم', qiraahEn: 'Hafs from Asim', sizeMb: 0 },
  { id: 'tajweed', kind: 'tajweed', nameAr: 'مصحف التجويد الملوّن', nameEn: 'Colour-coded Tajweed Mushaf', qiraahAr: 'حفص عن عاصم', qiraahEn: 'Hafs from Asim', sizeMb: 3 },
  { id: 'shamarly', kind: 'images', nameAr: 'مصحف الشمرلي', nameEn: 'Shamarly Mushaf (Egypt)', qiraahAr: 'حفص عن عاصم', qiraahEn: 'Hafs from Asim', sizeMb: 210 },
  { id: 'warsh', kind: 'riwaya', nameAr: 'مصحف ورش', nameEn: 'Warsh Mushaf', qiraahAr: 'ورش عن نافع', qiraahEn: 'Warsh from Nafi\'', sizeMb: 3, kfgqpc: { folder: 'warsh', data: 'warshData_v10.json', font: 'warsh.10.woff2' } },
  { id: 'qaloon', kind: 'riwaya', nameAr: 'مصحف قالون', nameEn: 'Qalun Mushaf', qiraahAr: 'قالون عن نافع', qiraahEn: 'Qalun from Nafi\'', sizeMb: 3, kfgqpc: { folder: 'qaloon', data: 'QaloonData_v10.json', font: 'qaloon.10.woff2' } },
  { id: 'shouba', kind: 'riwaya', nameAr: 'مصحف شعبة', nameEn: 'Shu\'bah Mushaf', qiraahAr: 'شعبة عن عاصم', qiraahEn: 'Shu\'bah from Asim', sizeMb: 3, kfgqpc: { folder: 'shouba', data: 'ShoubaData08.json', font: 'shouba.8.woff2' } },
  { id: 'doori', kind: 'riwaya', nameAr: 'مصحف الدوري', nameEn: 'Ad-Duri Mushaf', qiraahAr: 'الدوري عن أبي عمرو', qiraahEn: 'Ad-Duri from Abu Amr', sizeMb: 3, kfgqpc: { folder: 'doori', data: 'DooriData_v09.json', font: 'doori.9.woff2' } },
  { id: 'soosi', kind: 'riwaya', nameAr: 'مصحف السوسي', nameEn: 'As-Susi Mushaf', qiraahAr: 'السوسي عن أبي عمرو', qiraahEn: 'As-Susi from Abu Amr', sizeMb: 3, kfgqpc: { folder: 'soosi', data: 'SoosiData09.json', font: 'soosi.9.woff2' } },
  { id: 'bazzi', kind: 'riwaya', nameAr: 'مصحف البزي', nameEn: 'Al-Bazzi Mushaf', qiraahAr: 'البزي عن ابن كثير', qiraahEn: 'Al-Bazzi from Ibn Kathir', sizeMb: 3, kfgqpc: { folder: 'bazzi', data: 'BazziData_v07.json', font: 'bazzi.7.woff2' } },
  { id: 'qumbul', kind: 'riwaya', nameAr: 'مصحف قنبل', nameEn: 'Qunbul Mushaf', qiraahAr: 'قنبل عن ابن كثير', qiraahEn: 'Qunbul from Ibn Kathir', sizeMb: 3, kfgqpc: { folder: 'qumbul', data: 'QumbulData_v07.json', font: 'qumbul.7.woff2' } },
];

export const edition = (id: string): Edition | undefined => EDITIONS.find((e) => e.id === id);

/** One ayah of a riwaya page: sura, ayah number in that riwaya, text (ending with its number glyph). */
export type RiwayaAyah = [number, number, string];

export interface RiwayaMushaf {
  /** pages[p - 1] = the ayat starting on page p. */
  pages: RiwayaAyah[][];
  /** Arabic sura names from the Complex's data. */
  suraNames: string[];
}

export interface ShamarlyMap {
  pages: number;
  /** first[p - 1] = [sura, ayah] of the first ayah on page p (null for a page without one). */
  first: ([number, number] | null)[];
  rub: number[];
}

/** One ayah's place on a Shamarly page: sura, ayah, then rects [x0, y0, x1, y1, ...] in permille of the page. */
export type ShamarlyArea = [number, number, number[]];

/** The ayah at point (x, y) (permille of the page), or the nearest one on its line; null off the text. */
export function shamarlyAyahAt(areas: ShamarlyArea[], x: number, y: number): AyahRef | null {
  let near: { ref: AyahRef; d: number } | null = null;
  for (const [sura, aya, r] of areas) {
    for (let i = 0; i < r.length; i += 4) {
      const [x0, y0, x1, y1] = [r[i], r[i + 1], r[i + 2], r[i + 3]];
      if (y < y0 || y > y1) continue;
      if (x >= x0 && x <= x1) return { sura, aya };
      const d = x < x0 ? x0 - x : x - x1;
      if (d < 40 && (!near || d < near.d)) near = { ref: { sura, aya }, d };
    }
  }
  return near?.ref ?? null;
}

/** "85-86" (an ayah running over two pages) -> 85. */
const firstPage = (page: unknown): number => parseInt(String(page), 10);

/** Converts the Complex's JSON (one object per ayah) into pages. */
export function riwayaFromKfgqpc(rows: { page: unknown; sura_no?: number; sora?: number; aya_no: number; aya_text: string; sura_name_ar?: string }[]): RiwayaMushaf {
  const pages: RiwayaAyah[][] = [];
  const suraNames: string[] = [];
  for (const r of rows) {
    const sura = Number(r.sura_no ?? r.sora);
    const p = firstPage(r.page);
    if (!sura || !p) throw new Error('bad row');
    (pages[p - 1] ??= []).push([sura, Number(r.aya_no), r.aya_text.trim()]);
    suraNames[sura - 1] ??= (r.sura_name_ar ?? '').trim();
  }
  for (let i = 0; i < pages.length; i++) pages[i] ??= [];
  return { pages, suraNames };
}

@Injectable({ providedIn: 'root' })
export class MushafEditionsService {
  private readonly http = inject(HttpClient);
  /** The mushaf the Quran tab opens. */
  readonly current = signal<EditionId>('madinah');
  /** Editions whose data is on the device (madinah always; shamarly when every page is). */
  readonly downloaded = signal<Set<EditionId>>(new Set(['madinah']));
  /** Download in progress: edition and fraction done (-1 while the size is unknown). */
  readonly progress = signal<{ id: EditionId; done: number } | null>(null);
  private cancel = false;
  private loaded?: Promise<void>;
  private tajweed?: Promise<string[] | null>;
  private readonly riwayat = new Map<EditionId, Promise<RiwayaMushaf>>();
  private readonly fonts = new Set<EditionId>();
  private shamarly?: Promise<ShamarlyMap>;
  private shamarlyAreas?: Promise<ShamarlyArea[][]>;
  private shamarlyPages_?: Promise<MushafLayout>;
  private shamarlyBase?: Promise<string>;
  /** Shamarly pages saved on the device. */
  private shamarlyPages = new Set<number>();

  load(): Promise<void> {
    this.loaded ??= (async () => {
      const { value } = await Preferences.get({ key: EDITION_KEY });
      if (value && edition(value)) this.current.set(value as EditionId);
      const have = new Set<EditionId>(['madinah']);
      try {
        const { files } = await Filesystem.readdir({ path: DIR, directory: Directory.Data });
        for (const f of files) {
          const id = f.name.replace(/\.json$/, '') as EditionId;
          if (f.name.endsWith('.json') && edition(id)) have.add(id);
        }
        const pages = await Filesystem.readdir({ path: `${DIR}/shamarly`, directory: Directory.Data }).catch(() => ({ files: [] }));
        this.shamarlyPages = new Set(pages.files.map((f) => parseInt(f.name, 10)).filter((n) => n > 0));
        if (this.shamarlyPages.size >= 522) have.add('shamarly');
      } catch {
        /* nothing downloaded yet */
      }
      this.downloaded.set(have);
    })();
    return this.loaded;
  }

  async setCurrent(id: EditionId): Promise<void> {
    this.current.set(id);
    await Preferences.set({ key: EDITION_KEY, value: id });
  }

  /** Whether an edition can be read now (Shamarly streams its pages, so it always can). */
  isReady(id: EditionId): boolean {
    return id === 'shamarly' || this.downloaded().has(id);
  }

  async lastPage(id: EditionId): Promise<number | null> {
    const { value } = await Preferences.get({ key: PAGE_KEY + id });
    return value ? Number(value) || null : null;
  }

  saveLastPage(id: EditionId, page: number): Promise<void> {
    return Preferences.set({ key: PAGE_KEY + id, value: String(page) });
  }

  // ---- Download / delete ----------------------------------------------------------------------

  async download(id: EditionId): Promise<boolean> {
    const e = edition(id);
    if (!e || this.progress()) return false;
    this.cancel = false;
    this.progress.set({ id, done: -1 });
    try {
      if (e.kind === 'tajweed') {
        const res = await firstValueFrom(this.http.get<{ verses: { text_uthmani_tajweed: string }[] }>(TAJWEED_URL));
        if (res.verses?.length !== 6236) throw new Error('incomplete');
        await this.write(`${DIR}/tajweed.json`, JSON.stringify(res.verses.map((v) => v.text_uthmani_tajweed)));
        this.tajweed = undefined;
      } else if (e.kind === 'riwaya' && e.kfgqpc) {
        const k = e.kfgqpc;
        const [rows, font] = await Promise.all([
          fetch(`${KFGQPC}/${k.folder}/data/${k.data}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))),
          fetch(`${KFGQPC}/${k.folder}/font/${k.font}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))),
        ]);
        const mushaf = riwayaFromKfgqpc(JSON.parse(rows.replace(/^﻿/, '')));
        if (mushaf.pages.length < 600) throw new Error('incomplete');
        await Filesystem.writeFile({ path: `${DIR}/${id}.woff2`, data: toBase64(font), directory: Directory.Data, recursive: true });
        await this.write(`${DIR}/${id}.json`, JSON.stringify(mushaf));
        this.riwayat.delete(id);
      } else if (e.kind === 'images') {
        if (!Capacitor.isNativePlatform()) return false;
        const map = await this.shamarlyMap();
        const base = await this.shamarlyServer();
        const todo = Array.from({ length: map.pages }, (_, i) => i + 1).filter((p) => !this.shamarlyPages.has(p));
        let next = 0;
        // A few pages at a time: archive.org answers each request slowly but serves several at once.
        const worker = async (): Promise<void> => {
          while (next < todo.length && !this.cancel) {
            const p = todo[next++];
            const path = `${DIR}/shamarly/${pad(p)}.png`;
            await Filesystem.downloadFile({ url: `${base}/${pad(p)}.png`, path, directory: Directory.Data, recursive: true })
              .catch(() => Filesystem.downloadFile({ url: shamarlyUrl(p), path, directory: Directory.Data, recursive: true }));
            this.shamarlyPages.add(p);
            this.progress.set({ id, done: this.shamarlyPages.size / map.pages });
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (this.cancel || this.shamarlyPages.size < map.pages) return false;
      }
      this.downloaded.update((s) => new Set(s).add(id));
      return true;
    } catch {
      return false;
    } finally {
      this.progress.set(null);
    }
  }

  cancelDownload(): void {
    this.cancel = true;
  }

  async remove(id: EditionId): Promise<void> {
    if (id === 'madinah') return;
    if (id === 'shamarly') {
      await Filesystem.rmdir({ path: `${DIR}/shamarly`, directory: Directory.Data, recursive: true }).catch(() => {});
      this.shamarlyPages.clear();
    } else {
      await Filesystem.deleteFile({ path: `${DIR}/${id}.json`, directory: Directory.Data }).catch(() => {});
      await Filesystem.deleteFile({ path: `${DIR}/${id}.woff2`, directory: Directory.Data }).catch(() => {});
      this.riwayat.delete(id);
      if (id === 'tajweed') this.tajweed = undefined;
    }
    this.downloaded.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    if (this.current() === id) await this.setCurrent('madinah');
  }

  // ---- Tajweed ---------------------------------------------------------------------------------

  /** Tajweed markup per ayah (global index 0..6235), or null when not downloaded. */
  tajweedText(): Promise<string[] | null> {
    this.tajweed ??= this.read<string[]>(`${DIR}/tajweed.json`).catch(() => null);
    return this.tajweed;
  }

  // ---- Riwayat ---------------------------------------------------------------------------------

  riwaya(id: EditionId): Promise<RiwayaMushaf> {
    let p = this.riwayat.get(id);
    if (!p) {
      p = this.read<RiwayaMushaf>(`${DIR}/${id}.json`);
      p.catch(() => this.riwayat.delete(id));
      this.riwayat.set(id, p);
    }
    return p;
  }

  /** Registers the riwaya's KFGQPC font (once) and returns its CSS family name. */
  async font(id: EditionId): Promise<string> {
    const family = `kfgqpc-${id}`;
    if (this.fonts.has(id)) return family;
    const { data } = await Filesystem.readFile({ path: `${DIR}/${id}.woff2`, directory: Directory.Data });
    const bytes = typeof data === 'string' ? fromBase64(data) : await data.arrayBuffer();
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
    this.fonts.add(id);
    return family;
  }

  /** Page of a riwaya where sura [ref.sura] (at or before [ref.aya]) is. */
  riwayaPageOf(m: RiwayaMushaf, ref: AyahRef): number {
    let found = 1;
    for (let i = 0; i < m.pages.length; i++) {
      for (const [s, a] of m.pages[i]) {
        if (s < ref.sura || (s === ref.sura && a <= ref.aya)) found = i + 1;
        else return found;
      }
    }
    return found;
  }

  // ---- Shamarly --------------------------------------------------------------------------------

  shamarlyMap(): Promise<ShamarlyMap> {
    this.shamarly ??= firstValueFrom(this.http.get<ShamarlyMap>('assets/quran/shamarly.json'));
    return this.shamarly;
  }

  shamarlyPageOf(map: ShamarlyMap, ref: AyahRef): number {
    let found = 2;
    map.first.forEach((f, i) => {
      if (f && (f[0] < ref.sura || (f[0] === ref.sura && f[1] <= ref.aya))) found = i + 1;
    });
    return found;
  }

  /**
   * The Shamarly mushaf's pages as text, broken where the printed pages break (inside ayat too; every page start
   * checked against the scans, scripts/shamarly-ayat). [indexOf] gives an ayah's global index.
   */
  shamarlyLayout(indexOf: (sura: number, aya: number) => number): Promise<MushafLayout> {
    this.shamarlyPages_ ??= firstValueFrom(this.http.get<{ start: ([number, number, number] | null)[] }>('assets/quran/shamarly-pages.json'))
      .then((d) => shamarlyLayout(d.start, indexOf));
    this.shamarlyPages_.catch(() => (this.shamarlyPages_ = undefined));
    return this.shamarlyPages_;
  }

  /** Where each ayah sits on each page (index = page - 1). */
  shamarlyAyat(): Promise<ShamarlyArea[][]> {
    this.shamarlyAreas ??= firstValueFrom(this.http.get<{ pages: ShamarlyArea[][] }>('assets/quran/shamarly-ayat.json')).then((d) => d.pages);
    this.shamarlyAreas.catch(() => (this.shamarlyAreas = undefined));
    return this.shamarlyAreas;
  }

  /** Image of Shamarly page [p]: the saved copy, or archive.org (its storage server directly when known). */
  async shamarlySrc(p: number, viaRedirect = false): Promise<string> {
    await this.load();
    if (this.shamarlyPages.has(p) && Capacitor.isNativePlatform()) {
      const { uri } = await Filesystem.getUri({ path: `${DIR}/shamarly/${pad(p)}.png`, directory: Directory.Data });
      return Capacitor.convertFileSrc(uri);
    }
    const base = viaRedirect ? SHAMARLY_IMG : await this.shamarlyServer();
    return `${base}/${pad(p)}.png`;
  }

  /** Starts loading page [p] so turning to it is instant (nothing for saved pages). */
  async prefetchShamarly(p: number): Promise<void> {
    if (p < 1 || p > 522 || this.shamarlyPages.has(p)) return;
    const img = new Image();
    img.src = await this.shamarlySrc(p);
  }

  /** https://<server>/<dir> of the archive.org item, remembered for a week; the redirecting URL if unknown. */
  private shamarlyServer(): Promise<string> {
    this.shamarlyBase ??= (async () => {
      const { value } = await Preferences.get({ key: SHAMARLY_SERVER_KEY });
      try {
        const saved = value ? (JSON.parse(value) as { base: string; at: number }) : null;
        if (saved && Date.now() - saved.at < 7 * 864e5) return saved.base;
      } catch {
        /* ask again */
      }
      try {
        const get = (k: string) => firstValueFrom(this.http.get<{ result: string }>(`${SHAMARLY_META}/${k}`)).then((r) => r.result);
        const [server, dir] = await Promise.all([get('d1'), get('dir')]);
        if (!/^[\w.-]+\.archive\.org$/.test(server) || !dir.startsWith('/')) return SHAMARLY_IMG;
        const base = `https://${server}${dir}`;
        await Preferences.set({ key: SHAMARLY_SERVER_KEY, value: JSON.stringify({ base, at: Date.now() }) });
        return base;
      } catch {
        return SHAMARLY_IMG;
      }
    })();
    return this.shamarlyBase;
  }

  /** The storage server failed: forget it and use the redirecting URL until it is asked again. */
  async forgetShamarlyServer(): Promise<void> {
    this.shamarlyBase = Promise.resolve(SHAMARLY_IMG);
    await Preferences.remove({ key: SHAMARLY_SERVER_KEY });
  }

  /** Page in edition [id] for [ref] (sura/ayah by Hafs numbering; close enough for the riwayat). */
  async pageFor(id: EditionId, ref: AyahRef): Promise<number> {
    if (id === 'shamarly') return this.shamarlyPageOf(await this.shamarlyMap(), ref);
    return this.riwayaPageOf(await this.riwaya(id), ref);
  }

  // ---- storage ---------------------------------------------------------------------------------

  private write(path: string, data: string): Promise<unknown> {
    return Filesystem.writeFile({ path, data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
  }

  private async read<T>(path: string): Promise<T> {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
    return JSON.parse(typeof data === 'string' ? data : await data.text()) as T;
  }
}

const pad = (p: number) => String(p).padStart(3, '0');
const shamarlyUrl = (p: number) => `${SHAMARLY_IMG}/${pad(p)}.png`;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}
