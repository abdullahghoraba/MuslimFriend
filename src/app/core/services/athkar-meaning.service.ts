import { Injectable, inject } from '@angular/core';
import { Dhikr } from '../models';
import { normalizeArabic } from '../quran/quran-utils';
import { QuranService } from '../quran/quran.service';
import { TafsirLibraryService, translationFor } from '../quran/tafsir-library.service';

export interface LocalMeaning {
  text: string;
  /** Translator, for the credit line under the meaning. */
  by: string;
}

/**
 * Meanings of the athkar in languages other than Arabic and English. Only athkar that are whole Quran verses
 * (Ayat al-Kursi, the end of al-Baqarah, the three Quls…) get one: their meaning comes from the quran.com translation
 * in that language, saved offline once fetched. No translation of the other supplications is published under terms
 * the app can use, so those keep their English meaning.
 */
@Injectable({ providedIn: 'root' })
export class AthkarMeaningService {
  private readonly quran = inject(QuranService);
  private readonly library = inject(TafsirLibraryService);
  private readonly cache = new Map<string, LocalMeaning | null>();

  async meaning(d: Dhikr, lang: string): Promise<LocalMeaning | null> {
    if (lang === 'ar' || lang === 'en') return null;
    const key = `${lang}/${d.id}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const result = await this.lookup(d, lang).catch(() => null);
    // A failed fetch (offline) is not remembered, so it is tried again next time.
    if (result) this.cache.set(key, result);
    return result;
  }

  private async lookup(d: Dhikr, lang: string): Promise<LocalMeaning | null> {
    const verses = quranVerses(d.sourceRef);
    if (!verses.length) return null;
    await this.quran.load();
    // A dhikr that is only part of a verse (e.g. «حسبي الله…» from 9:129) would get the wrong meaning: require the
    // dhikr text to contain the opening words of its first verse.
    const first = normalizeArabic(this.quran.ayah(verses[0]).text).split(/\s+/).slice(0, 3).join(' ');
    if (!normalizeArabic(d.textAr).replace(/\s+/g, ' ').includes(first)) return null;
    const translation = translationFor(lang);
    if (translation.lang !== lang) return null;
    const parts: string[] = [];
    for (const v of verses) {
      const sura = await this.library.sura(translation.apiId, v.sura);
      if (!sura) return null;
      parts.push(`${sura[v.aya - 1] ?? ''} (${v.aya})`);
    }
    return { text: parts.join(' '), by: translation.by ?? '' };
  }
}

/** The verses of a source reference such as "Quran 2:255", "Quran 2:285–286" or "Quran 112–114" (whole suras). */
export function quranVerses(sourceRef: string): { sura: number; aya: number }[] {
  const ref = /^Quran\s+([\d:–\-]+)/.exec(sourceRef)?.[1];
  if (!ref) return [];
  const verse = /^(\d+):(\d+)(?:[–-](\d+))?$/.exec(ref);
  if (verse) {
    const [s, a, b] = [+verse[1], +verse[2], +(verse[3] ?? verse[2])];
    return Array.from({ length: b - a + 1 }, (_, i) => ({ sura: s, aya: a + i }));
  }
  const suras = /^(\d+)(?:[–-](\d+))?$/.exec(ref);
  if (!suras) return [];
  const out: { sura: number; aya: number }[] = [];
  for (let s = +suras[1]; s <= +(suras[2] ?? suras[1]); s++) {
    // Short suras only (the Quls): their ayah counts are fixed.
    const count = SHORT_SURA_AYAHS[s];
    if (!count) return [];
    for (let a = 1; a <= count; a++) out.push({ sura: s, aya: a });
  }
  return out;
}

const SHORT_SURA_AYAHS: Record<number, number> = { 109: 6, 110: 3, 111: 5, 112: 4, 113: 5, 114: 6 };
