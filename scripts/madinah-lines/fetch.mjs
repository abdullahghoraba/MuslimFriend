// Downloads the word line numbers of the 604-page Madinah mushaf from the Quran.com API (one request per page; mushaf 1 = the 1421 King Fahd print, as in the KFGQPC data)
// into a raw cache, for build.mjs. Usage: node scripts/madinah-lines/fetch.mjs <cacheDir> [mushafId=1]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, mushaf = '1'] = process.argv.slice(2);
if (!dir) throw new Error('usage: fetch.mjs <cacheDir> [mushafId]');
mkdirSync(dir, { recursive: true });

const url = (p) =>
  `https://api.qurancdn.com/api/qdc/verses/by_page/${p}?words=true&word_fields=text_uthmani,text_qpc_hafs,line_number,page_number&per_page=300&mushaf=${mushaf}`;

async function page(p) {
  const file = join(dir, `${mushaf}-${p}.json`);
  if (existsSync(file)) return;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url(p));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const verses = j.verses.map((v) => ({
        key: v.verse_key,
        words: v.words.map((w) => [w.line_number, w.page_number, w.char_type_name === 'end' ? 1 : 0, w.text_uthmani ?? w.text, w.text_qpc_hafs ?? ""]),
      }));
      writeFileSync(file, JSON.stringify(verses));
      return;
    } catch (e) {
      if (attempt >= 5) throw new Error(`page ${p}: ${e}`);
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}

const pages = Array.from({ length: 604 }, (_, i) => i + 1);
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < pages.length) await page(pages[next++]);
}));
console.log('done', dir);
