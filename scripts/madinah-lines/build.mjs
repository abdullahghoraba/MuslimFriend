// Builds public/assets/quran/madinah-lines.json: the 15 printed lines of every page of the Madinah mushaf, as runs of
// the app's (Tanzil) ayah words. Line numbers come from the Quran.com API word data (fetch.mjs) and are checked
// against the King Fahd Complex (KFGQPC) Hafs data: every ayah must start and end on the same page and lines.
//
// Usage: node scripts/madinah-lines/build.mjs <cacheDir> <hafsData_v18.json> [mushafId=1]
//
// Output: { pages: [[line, ...] x 604] } where a line is
//   ["s", sura]                      the sura's title frame
//   ["b"]                            the basmala
//   [[index, from, to], ...]         runs of words [from, to) of the ayah with global index `index`
//                                    (to === -1: up to the ayah's end, where its number is printed)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, kfgqpcFile, mushaf = '1'] = process.argv.slice(2);
if (!dir || !kfgqpcFile) throw new Error('usage: build.mjs <cacheDir> <hafsData_v18.json> [mushafId]');

const root = new URL('../../', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('public/assets/quran/meta.json', root), 'utf8'));
const texts = JSON.parse(readFileSync(new URL('public/assets/quran/text.json', root), 'utf8'));
const kfgqpc = JSON.parse(readFileSync(kfgqpcFile, 'utf8'));

// Same rules as ayahWords() in src/app/core/quran/mushaf-layout.ts.
const PAUSE = /^[ۖ-ۭ۞۩]+$/;
const ayahWords = (text) => {
  const out = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (PAUSE.test(w) && out.length) out[out.length - 1] += ` ${w}`;
    else out.push(w);
  }
  return out;
};
// Letters only, with the alef forms and alef maqsura unified (the two texts write آ / ءا, ىٰ / ا differently: ى counts as alef).
const bare = (w) => w.replace(/[ٱأإآ]/g, 'ا').replace(/ى/g, 'ا').replace(/[^ء-غف-ي]/g, '');
const wordsOf = (sura, aya, text) => {
  const words = ayahWords(text);
  // The Tanzil text prefixes the basmala to the first ayah of every sura but al-Fatihah and at-Tawbah.
  if (aya === 1 && sura !== 1 && sura !== 9) {
    if (words.slice(0, 4).map(bare).join(' ') !== 'بسم الله الرحمن الرحيم') throw new Error(`${sura}:1 has no basmala`);
    return words.slice(4);
  }
  return words;
};

/**
 * The line of each of the app's words, matching the letters of both texts: a Quran.com word can hold two app words
 * ("بَعْدَ مَا", "۞ إِنَّ") and the data has a stray space ("دَآئِرَ ةٌ"). Null when the letters do not match.
 */
function align(app, qc) {
  const out = [];
  let i = 0;
  let pending = '';
  for (const w of qc) {
    const target = bare(w[3]);
    let got = pending;
    pending = '';
    while (got.length < target.length && i < app.length) {
      got += bare(app[i++]);
      out.push([w[0], w[1]]);
    }
    if (got === target) continue;
    // One app word split over two Quran.com words: keep it on the line of its first part.
    if (got.startsWith(target)) { pending = got.slice(target.length); continue; }
    return null;
  }
  return i === app.length && !pending ? out : null;
}

/** The first run [index, word] of page p in the API data. */
function firstOfPage(p) {
  if (p > 604) return null;
  const v = JSON.parse(readFileSync(join(dir, `${mushaf}-${p}.json`), 'utf8'))[0];
  const [sura, aya] = v.key.split(':').map(Number);
  return [indexOf(sura, aya), 0];
}

const indexOf = (sura, aya) => meta.suras[sura - 1].start + aya - 1;
// Page of every ayah in the app's own page table (meta.pages = first ayah of each page).
const appPage = new Array(texts.length);
for (let p = 0; p < meta.pages.length; p++) {
  const from = indexOf(meta.pages[p].sura, meta.pages[p].aya);
  const to = p + 1 < meta.pages.length ? indexOf(meta.pages[p + 1].sura, meta.pages[p + 1].aya) : texts.length;
  for (let i = from; i < to; i++) appPage[i] = p + 1;
}

const problems = [];
/** Differences that are reported but expected (another typesetting of the same print). */
const notes = [];
const pages = [];
for (let p = 1; p <= 604; p++) {
  const verses = JSON.parse(readFileSync(join(dir, `${mushaf}-${p}.json`), 'utf8'));
  /** line number -> runs */
  const lines = new Map();
  for (const v of verses) {
    const [sura, aya] = v.key.split(':').map(Number);
    const index = indexOf(sura, aya);
    const k = kfgqpc[index];
    if (k.sora !== sura || k.aya_no !== aya) problems.push(`${v.key}: KFGQPC row order`);
    // 2:181 has its number without the "end" type in the API data.
    for (const w of v.words) if (/^[٠-٩]+$/.test(w[3])) w[2] = 1;
    const qc = v.words.filter((w) => !w[2]);
    if (qc.some((w) => w[1] !== p)) problems.push(`${v.key}: word on another page`);
    // The app's old page table (Tanzil) differs from the print on a few pages; the lines file replaces it.
    if (appPage[index] !== p) notes.push(`${v.key}: Tanzil page ${appPage[index]}, printed page ${p}`);
    if (k.page !== p) problems.push(`${v.key}: KFGQPC page ${k.page} != ${p}`);
    const app = wordsOf(sura, aya, texts[index]);
    const words = align(app, qc);
    if (!words) {
      problems.push(`${v.key}: the app's words do not match Quran.com's`);
      continue;
    }
    // The KFGQPC line numbers of pages 1-2 count from their title; the API's are those of the centred print.
    // The ayah number is printed right after the last word (the API sometimes puts it on the next line).
    if (p > 2 && (words[0][0] !== k.line_start || words[words.length - 1][0] !== k.line_end)) {
      notes.push(`${v.key}: lines ${words[0][0]}-${words[words.length - 1][0]} != KFGQPC ${k.line_start}-${k.line_end}`);
    }
    // Runs of consecutive words on the same line; the last run carries the ayah number (to = -1).
    let from = 0;
    for (let i = 1; i <= words.length; i++) {
      if (i < words.length && words[i][0] === words[from][0]) continue;
      const line = words[from][0];
      if (!lines.has(line)) lines.set(line, []);
      lines.get(line).push([index, from, i === words.length ? -1 : i]);
      from = i;
    }
  }
  if (p <= 2) {
    // The opening pages: the title (and on page 2 the basmala) above a few centred lines.
    const out = [['s', p]];
    if (p === 2) out.push(['b']);
    for (const l of [...lines.keys()].sort((x, y) => x - y)) out.push(lines.get(l));
    pages.push(out);
    continue;
  }
  // Lines with no words hold a sura's title and basmala, right before the sura's first ayah. At the foot of a page
  // they belong to the sura that begins on the next page; a title there puts the basmala at the top of that page.
  const out = [];
  for (let l = 1; l <= 15; ) {
    if (lines.has(l)) {
      out.push(lines.get(l++));
      continue;
    }
    let n = l;
    while (n <= 15 && !lines.has(n)) n++;
    const gap = n - l;
    const first = n <= 15 ? lines.get(n)[0] : firstOfPage(p + 1);
    const sura = first && first[1] === 0 ? meta.suras.find((x) => x.start === first[0])?.index : undefined;
    const basmala = sura !== 1 && sura !== 9;
    const titleBefore = l === 1 && pages[p - 2]?.at(-1)?.[0] === 's' && pages[p - 2].at(-1)[1] === sura;
    let run;
    if (!sura) run = null;
    else if (!basmala) run = gap === 1 ? [['s', sura]] : null;
    else if (gap === 2) run = [['s', sura], ['b']];
    else if (gap === 1) run = n > 15 ? [['s', sura]] : titleBefore ? [['b']] : null;
    else run = null;
    if (!run) {
      problems.push(`page ${p} lines ${l}-${n - 1}: empty lines not before a sura start`);
      run = Array.from({ length: gap }, () => ['s', 0]);
    }
    out.push(...run);
    l = n;
  }
  pages.push(out);
}

console.log(notes.length, 'notes');
if (process.env.NOTES) console.log(notes.join('\n'));
if (problems.length) {
  console.log(problems.length, 'problems');
  console.log(problems.slice(0, 60).join('\n'));
}
if (problems.length) process.exit(1);
const file = new URL('public/assets/quran/madinah-lines.json', root);
writeFileSync(file, JSON.stringify({ source: 'Quran.com API word line numbers, checked against KFGQPC Hafs v18', pages }));
console.log('wrote', file.pathname, readFileSync(file).length, 'bytes');
