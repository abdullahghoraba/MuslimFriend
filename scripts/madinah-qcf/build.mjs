// Builds public/assets/quran/madinah-qcf.json: every word of the 604 Madinah pages as its glyph in the King Fahd
// Complex's page fonts (QCF v2, one font per page: p1.woff2 … p604.woff2), for the «صفحة كالمطبوع» view. In those
// fonts each word is drawn the way that page prints it, so a line set in them is the printed line: no kashida or
// spacing has to be invented, and nothing in the text is changed.
//
// Usage: node scripts/madinah-qcf/build.mjs <cacheDir>
//   Downloads the word glyph codes of each page from the Quran.com API (mushaf 1 = the 1421 King Fahd print, the same
//   one madinah-lines.json follows) into <cacheDir>, then checks every page against madinah-lines.json: the same ayat on
//   the same lines, in the same order, with the ayah ends where its runs end.
//
// madinah-qcf.json: { source, font, pages: [[line, ...] x 604] } where a line is
//   ["s", sura]                     the sura's title frame (same place as in madinah-lines.json)
//   ["b"]                           the basmala
//   [[index, ["w1", "w2", …], end], …]  runs of words of the ayah with global index `index` (a word is one glyph, or
//                                   two for an ayah number above 99); end = 1 when the run ends with the ayah's number
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir] = process.argv.slice(2);
if (!dir) throw new Error('usage: build.mjs <cacheDir>');
mkdirSync(dir, { recursive: true });

const root = new URL('../../', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('public/assets/quran/meta.json', root), 'utf8'));
const lines = JSON.parse(readFileSync(new URL('public/assets/quran/madinah-lines.json', root), 'utf8')).pages;
const suraStart = meta.suras.map((s) => s.start);
const indexOf = (key) => {
  const [sura, aya] = key.split(':').map(Number);
  return suraStart[sura - 1] + aya - 1;
};

const url = (p) =>
  `https://api.qurancdn.com/api/qdc/verses/by_page/${p}?words=true&word_fields=code_v2,line_number,page_number,v2_page&per_page=300&mushaf=1`;

async function fetchPage(p) {
  const file = join(dir, `qcf-${p}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url(p));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const verses = j.verses.map((v) => ({
        key: v.verse_key,
        words: v.words.map((w) => ({ line: w.line_number, page: w.page_number, v2: w.v2_page, end: w.char_type_name === 'end', code: w.code_v2 })),
      }));
      writeFileSync(file, JSON.stringify(verses));
      return verses;
    } catch (e) {
      if (attempt >= 5) throw new Error(`page ${p}: ${e}`);
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}

/**
 * Corrections to the API data, each checked by rendering the page in its font (every full line of a page measures the
 * same, within about 1%):
 * - 2:181 (page 27): its last glyph is the ayah's number but is marked as a word, and the last word of line 14
 *   («فَإِنَّمَآ») belongs on line 15. Fixed, lines 14 and 15 measure 630 and 626 like the page's other lines (618–633);
 *   as delivered, 697 and 558.
 */
function correct(p, verses) {
  if (p === 27) {
    const v = verses.find((x) => x.key === '2:181');
    if (v) {
      v.words[v.words.length - 1].end = true;
      const lastOn14 = v.words.filter((w) => w.line === 14).at(-1);
      if (lastOn14) lastOn14.line = 15;
    }
  }
  return verses;
}

/** Pages 1 and 2 are set lower on the printed page: the API numbers their lines from 9 and 10, the app from 2 and 3. */
const LINE_OFFSET = (p) => (p <= 2 ? 7 : 0);

const raw = new Array(604);
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < 604) {
    const p = next++;
    raw[p] = correct(p + 1, await fetchPage(p + 1));
  }
}));

const errors = [];
const seen = new Set();
const pages = raw.map((verses, i) => {
  const p = i + 1;
  /** line number -> runs [index, glyphs[], end] in reading order */
  const byLine = new Map();
  for (const v of verses) {
    const index = indexOf(v.key);
    for (const w of v.words) {
      if (w.page !== p || w.v2 !== p) errors.push(`${v.key}: word on page ${w.page}/${w.v2}, expected ${p}`);
      if (!w.code?.trim()) errors.push(`${v.key}: missing glyph`);
      const lineNo = w.line - LINE_OFFSET(p);
      const runs = byLine.get(lineNo) ?? [];
      const last = runs[runs.length - 1];
      if (last && last[0] === index && !last[2]) last[1].push(w.code);
      else runs.push([index, [w.code], 0]);
      if (w.end) runs[runs.length - 1][2] = 1;
      byLine.set(lineNo, runs);
      if (w.end) seen.add(index);
    }
  }
  return lines[i].map((line, k) => {
    if (line[0] === 's' || line[0] === 'b') {
      if (byLine.has(k + 1)) errors.push(`page ${p} line ${k + 1}: words on a ${line[0] === 's' ? 'title' : 'basmala'} line`);
      return line;
    }
    const runs = byLine.get(k + 1) ?? [];
    // Same words of the same ayat, in the same order, as the line data the rest of the app uses. Only the ayah-number
    // ornaments may sit elsewhere: in the print (and in these fonts, whose full lines all measure the same) a number
    // sometimes begins the next line, where madinah-lines.json keeps it with its ayah's last word.
    const want = line.map(([index]) => index).join(' ');
    const got = runs.filter(([, glyphs, end]) => !(end && glyphs.length === 1)).map(([index]) => index).join(' ');
    if (want !== got) errors.push(`page ${p} line ${k + 1}: expected ayat ${want}, got ${got}`);
    return runs;
  });
});
if (seen.size !== 6236) errors.push(`expected 6236 ayah ends, got ${seen.size}`);
if (errors.length) {
  console.error(errors.slice(0, 30).join('\n'));
  throw new Error(`${errors.length} errors`);
}

const out = {
  source: 'Quran.com API (mushaf 1, the 1421 King Fahd Complex print): word glyph codes for the QCF v2 page fonts',
  font: 'https://static.qurancdn.com/fonts/quran/hafs/v2/woff2/p{page}.woff2',
  pages,
};
writeFileSync(new URL('public/assets/quran/madinah-qcf.json', root), JSON.stringify(out));
console.log('madinah-qcf.json written: 604 pages, 6236 ayat');
