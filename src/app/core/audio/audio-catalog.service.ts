import { Injectable, computed, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { Language } from '../models';
import { normalizeArabic } from '../quran/quran-utils';
import { SettingsService } from '../services/settings.service';

/** One recording of a reciter (a riwayah, murattal or mujawwad...). [server] + "001.mp3" is al-Fatihah. */
export interface Moshaf {
  id: number;
  ar: string;
  en: string;
  rewaya: number;
  server: string;
  /** Comma-separated sura numbers; empty means all 114. */
  suras: string;
}

export interface FullReciter {
  id: number;
  ar: string;
  en: string;
  moshaf: Moshaf[];
}

export interface Radio {
  id: number;
  ar: string;
  en: string;
  url: string;
}

/** A riwayah (Warsh from Nafi', Khalaf from Hamzah...): the recordings of the ten qira'at. */
export interface Riwayah {
  id: number;
  ar: string;
  en: string;
}

interface Catalog {
  fetched: string;
  riwayat: Riwayah[];
  reciters: FullReciter[];
  radios: Radio[];
}

/** Localized names from the API, by reciter / moshaf / radio id. */
interface LocalNames {
  at: number;
  reciters: Record<number, string>;
  moshaf: Record<number, string>;
  radios: Record<number, string>;
}

const API = 'https://www.mp3quran.net/api/v3';
/** mp3quran.net's code for each app language it has names in (others show the English names). */
const API_LANG: Partial<Record<Language, string>> = {
  ar: 'ar', en: 'eng', fr: 'fr', ru: 'ru', de: 'de', es: 'es', tr: 'tr', zh: 'cn', ur: 'ur', bn: 'bn', fa: 'fa', id: 'id', pt: 'pt',
  ha: 'ha', sw: 'sw',
};
const NAMES_KEY = 'audioNames.';
const REFRESH_MS = 7 * 24 * 3600_000;

/**
 * The catalogue of full-sura reciters and live Quran radios (mp3quran.net). A snapshot ships with the app
 * (assets/audio/catalog.json); names in the reader's language are fetched once a week, only while the Listen
 * page is open, and kept on the device.
 */
@Injectable({ providedIn: 'root' })
export class AudioCatalogService {
  private readonly settings = inject(SettingsService);
  private readonly catalog = signal<Catalog | null>(null);
  private readonly names = signal<LocalNames | null>(null);
  private namesLang?: string;
  private loading?: Promise<void>;

  readonly ready = computed(() => this.catalog() !== null);
  readonly lang = computed(() => this.settings.settings().language);

  readonly reciters = computed(() => {
    const list = this.catalog()?.reciters ?? [];
    const lang = this.lang();
    return [...list].sort((a, b) => this.reciterName(a).localeCompare(this.reciterName(b), lang));
  });
  readonly radios = computed(() => this.catalog()?.radios ?? []);
  readonly riwayat = computed(() => this.catalog()?.riwayat ?? []);

  load(): Promise<void> {
    this.loading ??= fetch('assets/audio/catalog.json')
      .then((r) => r.json() as Promise<Catalog>)
      .then((c) => this.catalog.set(c))
      .catch((e) => {
        this.loading = undefined;
        throw e;
      });
    return this.loading.then(() => this.loadNames());
  }

  reciter(id: number): FullReciter | undefined {
    return this.catalog()?.reciters.find((r) => r.id === id);
  }

  radio(id: number): Radio | undefined {
    return this.catalog()?.radios.find((r) => r.id === id);
  }

  reciterName(r: FullReciter): string {
    return this.pick(r, this.names()?.reciters[r.id]);
  }

  moshafName(m: Moshaf): string {
    return this.pick(m, this.names()?.moshaf[m.id]);
  }

  riwayahName(r: Riwayah): string {
    return this.lang() === 'ar' ? r.ar : r.en;
  }

  radioName(r: Radio): string {
    return this.pick(r, this.names()?.radios[r.id]);
  }

  /** Sura numbers recorded in [m]. */
  suras(m: Moshaf): number[] {
    return m.suras ? m.suras.split(',').map(Number).sort((a, b) => a - b) : Array.from({ length: 114 }, (_, i) => i + 1);
  }

  /** Search in Arabic (ignoring hamza and tashkeel) and in the Latin / localized name. */
  matches(query: string, ...names: string[]): boolean {
    const q = query.trim();
    if (!q) return true;
    const ar = normalizeArabic(q);
    const latin = q.toLowerCase();
    return names.some((n) => normalizeArabic(n).includes(ar) || n.toLowerCase().includes(latin));
  }

  private pick(x: { ar: string; en: string }, local?: string): string {
    const lang = this.lang();
    if (lang === 'ar') return x.ar;
    return local || x.en;
  }

  /** Localized names for languages other than Arabic and English (cached; refreshed weekly). */
  private async loadNames(): Promise<void> {
    const lang = this.lang();
    const code = API_LANG[lang];
    if (lang === 'ar' || lang === 'en' || !code) {
      this.names.set(null);
      return;
    }
    if (this.namesLang === lang && this.names()) return;
    this.namesLang = lang;
    const key = NAMES_KEY + lang;
    let cached: LocalNames | null = null;
    try {
      const { value } = await Preferences.get({ key });
      cached = value ? (JSON.parse(value) as LocalNames) : null;
    } catch {
      cached = null;
    }
    this.names.set(cached);
    if (cached && Date.now() - cached.at < REFRESH_MS) return;
    try {
      const [rec, rad] = await Promise.all([
        fetch(`${API}/reciters?language=${code}`).then((r) => r.json() as Promise<{ reciters: { id: number; name: string; moshaf: { id: number; name: string }[] }[] }>),
        fetch(`${API}/radios?language=${code}`).then((r) => r.json() as Promise<{ radios: { id: number; name: string }[] }>),
      ]);
      const names: LocalNames = { at: Date.now(), reciters: {}, moshaf: {}, radios: {} };
      for (const r of rec.reciters) {
        names.reciters[r.id] = r.name.trim();
        for (const m of r.moshaf) names.moshaf[m.id] = m.name.trim();
      }
      for (const r of rad.radios) names.radios[r.id] = r.name.trim();
      if (this.lang() !== lang) return;
      this.names.set(names);
      await Preferences.set({ key, value: JSON.stringify(names) });
    } catch {
      /* offline: keep the cached or English names */
    }
  }
}
