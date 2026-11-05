import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { nativeHttp } from './dorar.service';
import { EncHadith, HadeethEncService } from './hadeethenc.service';
import {
  EncIndex, HadithExplanation, encCandidates, isChainOnly, overlap, parseDorarSearch, parseDorarSharh, sameHadith, sharhQueries,
} from './hadith-explain';
import { HadithLibraryService } from './hadith-library.service';
import { HadithStorage } from './hadith-storage.service';
import { Hadith } from './hadith.models';

export interface ExplainResult extends HadithExplanation {
  /** The hadith opened is only a chain pointing to an earlier one; this explains that one. */
  earlier: boolean;
  /** The hadith the explanation is for (the cache is checked against it). */
  for: string;
}

/**
 * A simple explanation of any hadith, in the reader's language when the encyclopedia has it, else in Arabic.
 * Online the first time (a few small requests), then kept on the device.
 */
@Injectable({ providedIn: 'root' })
export class HadithExplainService {
  private readonly storage = inject(HadithStorage);
  private readonly enc = inject(HadeethEncService);
  private readonly library = inject(HadithLibraryService);
  private index?: Promise<EncIndex>;

  private key(h: Hadith, lang: string): string { return `explain-${h.collection}-${h.number}-${lang}`; }

  async cached(h: Hadith, lang: string): Promise<ExplainResult | null> {
    const saved = await this.storage.read<ExplainResult>(this.key(h, lang)).catch(() => null);
    return saved?.for === h.arabic && saved.explanation ? saved : null;
  }

  /** The explanation, or null when neither encyclopedia explains this hadith. Throws when offline. */
  async explain(h: Hadith, lang: string): Promise<ExplainResult | null> {
    const saved = await this.cached(h, lang);
    if (saved) return saved;
    let found: HadithExplanation | null = null;
    let earlier = false;
    let failures = 0;
    const attempt = async (work: () => Promise<HadithExplanation | null>) => {
      if (found) return;
      try { found = await work(); } catch { failures++; }
    };
    if (h.collection === 'enc') {
      await attempt(async () => this.fromEnc(await this.enc.one(lang, h.number), lang, false));
    } else {
      let target = h.arabic;
      if (isChainOnly(target)) {
        const before = await this.library.earlierWithText(h).catch(() => null);
        if (before) { target = before; earlier = true; }
      }
      await attempt(() => this.fromEncyclopedia(target, lang));
      await attempt(() => this.fromDorar(target));
    }
    if (!found) {
      if (failures) throw Error('offline');
      return null;
    }
    const result: ExplainResult = { ...(found as HadithExplanation), earlier, for: h.arabic };
    await this.storage.write(this.key(h, lang), result).catch(() => {});
    return result;
  }

  private loadIndex(): Promise<EncIndex> {
    this.index ??= fetch('assets/hadith/enc-index.json').then((r) => {
      if (!r.ok) throw Error('index');
      return r.json() as Promise<EncIndex>;
    }).catch((e: unknown) => { this.index = undefined; throw e; });
    return this.index;
  }

  /** HadeethEnc: the hadith whose words are in this one, checked against its full text. */
  private async fromEncyclopedia(arabic: string, lang: string): Promise<HadithExplanation | null> {
    const ids = encCandidates(arabic, await this.loadIndex());
    for (const id of ids) {
      const ar = await this.enc.one('ar', id);
      if (!sameHadith(arabic, ar.arabic) || !ar.explanation) continue;
      // In the reader's language when it is translated (its explanation too), else in Arabic.
      const local = lang === 'ar' ? ar : await this.enc.one(lang, id).catch(() => null);
      return this.fromEnc(local?.explanation ? local : ar, local?.explanation ? lang : 'ar', false);
    }
    return null;
  }

  private fromEnc(h: EncHadith, lang: string, similar: boolean): HadithExplanation | null {
    if (!h.explanation) return null;
    return {
      source: 'enc', lang, hadith: h.arabic, explanation: h.explanation, benefits: h.hints, words: h.wordMeanings,
      reference: [h.gradeAr, h.attributionAr].filter(Boolean).join(' · '), similar,
      url: `https://hadeethenc.com/ar/browse/hadith/${encodeURIComponent(h.id)}`, fetchedAt: Date.now(),
    };
  }

  /**
   * Dorar: searches for the hadith's words and opens the explanation offered for it. Accepted when Dorar's result
   * is this hadith or the explained narration is; marked similar when the explained narration has other words.
   */
  private async fromDorar(arabic: string): Promise<HadithExplanation | null> {
    const links: { id: string; text: string; score: number }[] = [];
    for (const q of sharhQueries(arabic).slice(0, 3)) {
      for (const l of parseDorarSearch(await this.page(`https://dorar.net/hadith/search?q=${encodeURIComponent(q)}`))) {
        if (!links.some((x) => x.id === l.id)) links.push({ id: l.id, text: l.text, score: overlap(arabic, l.text) });
      }
      if (links.some((l) => l.score >= 0.6)) break;
    }
    links.sort((a, b) => b.score - a.score);
    for (const l of links.slice(0, 2)) {
      const url = `https://dorar.net/hadith/sharh/${l.id}`;
      const p = parseDorarSharh(await this.page(url));
      if (!p) continue;
      const same = !!p.hadith && overlap(arabic, p.hadith) >= 0.5;
      if (!same && l.score < 0.6) continue;
      return {
        source: 'dorar', lang: 'ar', hadith: p.hadith, explanation: p.explanation, benefits: p.benefits, words: [],
        reference: p.reference, similar: !!p.hadith && !same, url, fetchedAt: Date.now(),
      };
    }
    return null;
  }

  /** A dorar.net page (the site sends no CORS header, so the app's native HTTP; in a browser it fails). */
  private async page(url: string): Promise<string> {
    if (Capacitor.isNativePlatform()) {
      const r = await nativeHttp.get({ url, responseType: 'text', connectTimeout: 12_000, readTimeout: 25_000 });
      if (r.status !== 200) throw Error(`HTTP ${r.status}`);
      return typeof r.data === 'string' ? r.data : String(r.data ?? '');
    }
    const r = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return r.text();
  }
}
