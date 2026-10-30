import { Injectable, inject } from '@angular/core';
import { Capacitor, CapacitorHttp, HttpOptions } from '@capacitor/core';
import { HadithStorage } from './hadith-storage.service';
import { Hadith, normalizeHadith } from './hadith.models';

export interface DorarRuling {
  text: string; narrator: string; scholar: string; source: string; number: string; ruling: string; url: string; score: number;
}
export interface DorarAnswer { arabic: string; fetchedAt: number; rulings: DorarRuling[] }

/** Prefer the first words of the matn when the dataset includes a narration preamble. */
export function dorarQuery(arabic: string): string {
  const text = normalizeHadith(arabic);
  // The Prophet's words follow «صلى الله عليه وسلم», often after «يقول/قال» but not always («...وسلم من حسن إسلام المرء»).
  const preamble = /(?:صلي الله عليه و ?سلم|ﷺ)\s*(?:(?:انه\s+)?(?:يقول|قال)\s*[:：]?\s*)?/.exec(text);
  return (preamble ? text.slice(preamble.index + preamble[0].length) : text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).slice(0, 8).join(' ');
}
function words(text: string): string[] {
  return normalizeHadith(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
}
/** Ordered trigrams reduce false matches between narrations with common isnad words. */
export function matchScore(a: string, b: string): number {
  const aw = words(a), bw = words(b);
  if (Math.min(aw.length, bw.length) < 4) return 0;
  const grams = (w: string[]) => new Set(w.slice(0, -2).map((_, i) => w.slice(i, i + 3).join(' ')));
  const x = grams(aw), y = grams(bw);
  const overlap = [...x].filter((w) => y.has(w)).length;
  return overlap / Math.min(x.size, y.size);
}
/** Native HTTP (dorar.net sends no CORS header); an object so tests can replace it, CapacitorHttp being a plugin proxy. */
export const nativeHttp = { get: (options: HttpOptions) => CapacitorHttp.get(options) };

export function dorarLink(query: string): string { return `https://dorar.net/hadith/search?q=${encodeURIComponent(query)}`; }

/**
 * Every hadith of a Dorar answer, with its narrator, grading scholar, book and ruling (score 0). Only text and
 * allowlisted dorar.net links are taken from the untrusted API HTML.
 */
export function parseDorarEntries(html: string, fallbackUrl: string): DorarRuling[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe').forEach((n) => n.remove());
  const candidates: DorarRuling[] = [];
  for (const hadith of Array.from(doc.querySelectorAll('div.hadith'))) {
    let info = hadith.nextElementSibling;
    while (info && !info.matches('.hadith-info,.hadith')) info = info.nextElementSibling;
    if (!info?.matches('.hadith-info')) continue;
    const fields: Record<string, string> = {};
    const labels = Array.from(info.querySelectorAll('.info-subtitle'));
    labels.forEach((label, i) => {
      const range = doc.createRange(); range.setStartAfter(label);
      if (labels[i + 1]) range.setEndBefore(labels[i + 1]); else range.setEnd(info!, info!.childNodes.length);
      const key = normalizeHadith(label.textContent ?? '').replace(/[:：]/g, '').trim();
      fields[key] = range.toString().replace(/^[\s:|]+|[\s|]+$/g, '').trim();
    });
    const text = (hadith.textContent ?? '').replace(/^\s*\d+\s*[-–.]\s*/, '').trim();
    let url = fallbackUrl;
    for (const link of Array.from(info.querySelectorAll('a[href]')).concat(Array.from(hadith.querySelectorAll('a[href]')))) {
      try {
        const parsed = new URL(link.getAttribute('href')!, 'https://dorar.net');
        if (parsed.protocol === 'https:' && parsed.hostname === 'dorar.net' && /^\/h\/[\w-]+\/?$/.test(parsed.pathname)) url = parsed.href;
      } catch { /* Ignore unsafe/malformed links. */ }
    }
    const ruling = fields['خلاصه حكم المحدث'] ?? fields['خلاصة حكم المحدث'] ?? '';
    if (!ruling) continue;
    candidates.push({ text, narrator: fields['الراوي'] ?? '', scholar: fields['المحدث'] ?? '',
      source: fields['المصدر'] ?? '', number: fields['الصفحة او الرقم'] ?? '', ruling, url, score: 0 });
  }
  return candidates;
}

/** The rulings of Dorar's answer that are about [arabic] (close text match), best first. */
export function parseDorar(html: string, arabic: string): DorarRuling[] {
  const candidates = parseDorarEntries(html, dorarLink(dorarQuery(arabic))).map((c) => ({ ...c, score: matchScore(arabic, c.text) }));
  const best = Math.max(0, ...candidates.map((c) => c.score));
  // Never label the first search hit as this hadith merely because the endpoint returned it.
  return candidates.filter((c) => c.score >= .72 && c.score >= best - .08)
    .filter((c, i, all) => all.findIndex((r) => r.scholar === c.scholar && r.source === c.source && r.number === c.number && r.ruling === c.ruling) === i)
    .sort((a, b) => b.score - a.score);
}

@Injectable({ providedIn: 'root' })
export class DorarService {
  private readonly storage = inject(HadithStorage);
  async cached(h: Hadith): Promise<DorarAnswer | null> {
    const answer = await this.storage.read<DorarAnswer>(`dorar-${h.collection}-${h.number}`);
    return answer?.arabic === h.arabic && Array.isArray(answer.rulings) ? answer : null;
  }
  /** Looks up the scholars' rulings on [h] (online, when the ruling sheet opens) and keeps them on the device. */
  async lookup(h: Hadith): Promise<DorarAnswer> {
    const html = await this.fetchAnswer(dorarQuery(h.arabic));
    const answer: DorarAnswer = { arabic: h.arabic, fetchedAt: Date.now(), rulings: parseDorar(html, h.arabic) };
    // Empty searches are retryable and never erase a successful cached ruling.
    if (answer.rulings.length) await this.storage.write(`dorar-${h.collection}-${h.number}`, answer);
    return answer;
  }

  /** Searches every hadith book of the Dorar encyclopedia (online): words or a phrase from the hadith. */
  async search(query: string): Promise<DorarRuling[]> {
    const words = normalizeHadith(query).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    if (words.length < 2) return [];
    const entries = parseDorarEntries(await this.fetchAnswer(words), dorarLink(words));
    return entries.filter((c, i) => entries.findIndex((r) => r.text === c.text && r.scholar === c.scholar && r.ruling === c.ruling) === i);
  }

  private async fetchAnswer(skey: string): Promise<string> {
    const url = `https://dorar.net/dorar_api.json?skey=${encodeURIComponent(skey)}`;
    let data: { ahadith?: { result?: string } };
    if (Capacitor.isNativePlatform()) {
      const response = await nativeHttp.get({ url, responseType: 'json', connectTimeout: 12_000, readTimeout: 20_000 });
      if (response.status !== 200) throw Error('dorar-unavailable');
      data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    } else {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw Error('dorar-unavailable');
      data = await response.json() as typeof data;
    }
    if (typeof data?.ahadith?.result !== 'string') throw Error('invalid-dorar');
    return data.ahadith.result;
  }
}

/** A stable id (FNV-1a) for a hadith found in the encyclopedia, so it can be saved like any other. */
function textId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return String(h);
}

/** A Dorar search result as a hadith card: its text, the grading scholar's ruling, the book and the narrator. */
export function dorarHadith(r: DorarRuling): Hadith {
  const reference = [r.source, r.number].filter(Boolean).join(' ');
  return {
    collection: 'dorar', number: textId(`${r.text}|${r.source}|${r.number}|${r.scholar}`), book: 0,
    arabic: r.text, translation: '', translationLang: 'ar', grades: r.ruling ? [{ name: r.scholar, grade: r.ruling }] : [],
    bookName: reference, bookHadith: 0, arabicNumber: r.number, narrator: r.narrator || undefined,
    // Kept with a saved copy: the reference, narrator and ruling (its grade badge is read from it).
    authenticitySource: [reference, r.narrator && `الراوي: ${r.narrator}`, r.scholar && `${r.scholar}: ${r.ruling}`].filter(Boolean).join(' · '),
  };
}
