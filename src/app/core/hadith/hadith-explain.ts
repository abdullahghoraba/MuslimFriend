// Finding a simple explanation (شرح ميسّر) for any hadith the reader opens: first in the Encyclopedia of
// Translated Prophetic Hadiths (HadeethEnc.com, written for ordinary readers: the meaning, the lessons and the hard
// words), else in the explanations of the Dorar hadith encyclopedia (dorar.net). Pure functions, so they can be
// tested without the network.
import { normalizeHadith } from './hadith.models';

export interface HadithExplanation {
  source: 'enc' | 'dorar';
  lang: string;
  /** The narration that is explained, as the encyclopedia gives it. */
  hadith: string;
  /** The explanation, its paragraphs separated by blank lines. */
  explanation: string;
  benefits: string[];
  words: { word: string; meaning: string }[];
  /** Grade and source of the explained narration, when given. */
  reference: string;
  /** The explanation is of a close narration with other words (the meaning is the same). */
  similar: boolean;
  url: string;
  fetchedAt: number;
}

/** [id, the hadith's own words] for every hadith of the encyclopedia in Arabic (assets/hadith/enc-index.json). */
export type EncIndex = [string, string][];

/** The words of a narration without the blessings said in every one («صلى الله عليه وسلم», «رضي الله عنه»). */
function words(text: string): string[] {
  return normalizeHadith(text).replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/صلي\s+الله\s+عليه\s+و\s*سلم|رضي\s+الله\s+عن(?:هما|هم|ها|ه)|عليه\s+السلام|ﷺ/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
}
const grams = (w: string[], n: number) => new Set(w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(' ')));

/** How much of a narration's words [b] are found, in order, in [a] (0..1): shared word triples over the shorter. */
export function overlap(a: string, b: string): number {
  const aw = words(a), bw = words(b);
  if (Math.min(aw.length, bw.length) < 4) return 0;
  const x = grams(aw, 3), y = grams(bw, 3);
  let shared = 0;
  for (const g of y) if (x.has(g)) shared++;
  return shared / Math.min(x.size, y.size);
}

interface Prepared { id: string; grams: Set<string>; n: number; size: number }
const prepared = new WeakMap<EncIndex, Prepared[]>();

/**
 * The encyclopedia hadith whose words are in [arabic], best first (at most [limit]). A title must have four words
 * or more (two-word sayings like «الدين النصيحة» are in many narrations) and three quarters of its word triples
 * must be found; a longer title wins a tie, being the more particular.
 */
export function encCandidates(arabic: string, index: EncIndex, limit = 3): string[] {
  let rows = prepared.get(index);
  if (!rows) {
    rows = index.map(([id, title]) => {
      const w = words(title);
      return { id, grams: grams(w, 3), n: w.length, size: 0 };
    }).filter((r) => r.n >= 4).map((r) => ({ ...r, size: r.grams.size }));
    prepared.set(index, rows);
  }
  const text = grams(words(arabic), 3);
  if (!text.size) return [];
  const scored: { id: string; score: number; n: number }[] = [];
  for (const r of rows) {
    let found = 0;
    for (const g of r.grams) if (text.has(g)) found++;
    const score = found / r.size;
    if (score >= 0.75) scored.push({ id: r.id, score, n: r.n });
  }
  return scored.sort((a, b) => b.score - a.score || b.n - a.n).slice(0, limit).map((s) => s.id);
}

/** An explained narration is this hadith when at least half of the shorter one's words are found in the other. */
export function sameHadith(a: string, b: string): boolean {
  return overlap(a, b) >= 0.5;
}

/** Vocalisation, Quranic marks, tatweel and direction marks. */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ‌-‏]/g;

/** Plain words for a Dorar search: marks, tatweel and punctuation removed, the letters (hamza forms) kept. */
function plain(text: string): string {
  return text.normalize('NFC').replace(MARKS, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const CHAIN = /^(?:حدثنا|حدثني|حدثناه|أخبرنا|أخبرني|اخبرنا|اخبرني|أنبأنا|سمع|سمعت|عن|وحدثنا|وحدثني|وأخبرنا|ح|قال حدثنا|قال أخبرنا|قال أخبرني|أنه سمع|أن)\s/;

/**
 * Searches for the hadith's own words (its matn), not its chain of narrators: the six words after the Prophet's
 * blessing («صلى الله عليه وسلم قال: ...»), after the companion's («رضي الله عنه قال: ...»), and after the last
 * link of the chain («حدثنا فلان، عن فلان، ...»). The distinct ones, best first.
 */
export function sharhQueries(arabic: string): string[] {
  const queries: string[] = [];
  const add = (rest: string) => {
    const w = plain(rest).replace(/^(?:(?:أنه|انه)\s+)?(?:قال|قالت|يقول|تقول|قالوا)\s+/, '').split(' ').filter(Boolean);
    const q = w.slice(0, 6).join(' ');
    if (w.length >= 3 && !queries.includes(q)) queries.push(q);
  };
  const text = arabic.normalize('NFC').replace(MARKS, '');
  const prophet = /(?:صلى|صلي)\s+الله\s+عليه\s+و\s*سلم|ﷺ/.exec(text);
  if (prophet) add(text.slice(prophet.index + prophet[0].length));
  const companion = /رض[يى]\s+الله\s+عن(?:هما|هم|ها|ه)/.exec(text);
  if (companion && (!prophet || companion.index < prophet.index)) add(text.slice(companion.index + companion[0].length));
  // The chain's links are separated by commas; the matn is the first part that is not one.
  const parts = text.split(/[،,]/);
  let at = 0;
  while (at < parts.length - 1 && CHAIN.test(plain(parts[at]) + ' ')) at++;
  if (at > 0) add(parts.slice(at).join(' '));
  // The chain is at the start, so the last words are the hadith's own (a chain without commas, as in Muslim).
  const tail = plain(text).replace(/\s+(?:الحديث|نحوه|مثله|بمثله|بنحوه)$/, '').split(' ');
  if (tail.length >= 10) {
    const q = tail.slice(-6).join(' ');
    if (!queries.includes(q)) queries.push(q);
  }
  if (!queries.length) add(text);
  return queries;
}

export interface DorarSharhLink { text: string; id: string; similar: boolean }

/** The explanations offered by a Dorar search page (dorar.net/hadith/search): the hadith shown and its sharh id. */
export function parseDorarSearch(html: string): DorarSharhLink[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe').forEach((n) => n.remove());
  const links: DorarSharhLink[] = [];
  for (const a of Array.from(doc.querySelectorAll('a[xplain]'))) {
    const id = a.getAttribute('xplain') ?? '';
    if (!/^\d{1,9}$/.test(id) || links.some((l) => l.id === id)) continue;
    // The result block the link belongs to, and the hadith it shows.
    let block: Element | null = a;
    while (block && !block.querySelector('article')) block = block.parentElement;
    const text = (block?.querySelector('article')?.textContent ?? '').replace(/^\s*\d+\s*[-–.]\s*/, '').replace(/\.\.\.\s*$/, '').replace(/\s+/g, ' ').trim();
    links.push({ text, id, similar: /مشابه/.test(a.textContent ?? '') });
  }
  return links;
}

/** A Dorar explanation page (dorar.net/hadith/sharh/ID): the explained hadith, its reference and the explanation. */
export function parseDorarSharh(html: string): { hadith: string; reference: string; explanation: string; benefits: string[] } | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,img,svg,button,a.btn,.visible-xs').forEach((n) => n.remove());
  const root = doc.getElementById('sharh-text-content');
  if (!root) return null;
  // Most pages start with the explained narration and its reference; some go straight to the explanation.
  const first = root.querySelector(':scope > div');
  const head = first?.querySelector('.app-hadith-info') ? first : null;
  const hadith = (head?.querySelector(':scope > div:not(.app-hadith-info)')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const reference = Array.from(head?.querySelectorAll('.app-hadith-info') ?? [])
    .map((n) => (n.textContent ?? '').replace(/\s*\|\s*/g, ' · ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ')
    .replace(/(?:\s*·\s*)+/g, ' · ').replace(/^ · | · $/g, '');
  head?.remove();
  // Paragraphs: block elements and line breaks become blank lines.
  root.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  root.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6').forEach((n) => { n.prepend('\n\n'); n.append('\n\n'); });
  const paragraphs = (root.textContent ?? '').replace(/﻿/g, '').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // The closing «وفي الحديث: ...» paragraphs are its lessons.
  const isLesson = (p: string) => /^وفي\s+(?:هذا\s+)?الحديث\s*:/.test(p.normalize('NFC').replace(/[ً-ٰٟ]/g, ''));
  const benefits = paragraphs.filter(isLesson).map((p) => p.slice(p.indexOf(':') + 1).trim()).filter(Boolean);
  const explanation = paragraphs.filter((p) => !isLesson(p)).join('\n\n');
  return explanation.length >= 40 ? { hadith, reference, explanation, benefits } : null;
}

/**
 * Only a chain of narrators pointing to the hadith before it («... بهذا الإسناد مثله», «... عن النبي ﷺ بنحوه»),
 * as in a quarter of Sahih Muslim: its meaning is the earlier hadith's.
 */
export function isChainOnly(arabic: string): boolean {
  const t = normalizeHadith(arabic).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.length < 420 && /بهذا الاسناد|باسناد|بمثله|بنحوه|نحوه|مثله|بمعناه|بمعني حديث|مثل حديث|نحو حديث/.test(t);
}
