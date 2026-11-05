// Builds public/assets/hadith/enc-index.json: every hadith of HadeethEnc.com (the Encyclopedia of Translated
// Prophetic Hadiths) in Arabic as [id, title], the title being the hadith's own words. The app finds the hadith the
// reader opened in it (its words, offline) and then fetches that hadith's simple explanation online.
//
//   node scripts/fetch-enc-index.mjs
import { writeFile } from 'node:fs/promises';

const API = 'https://hadeethenc.com/api/v1';
const get = async (path) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(API + path, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw Error(`HTTP ${r.status} ${path}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1)));
    }
  }
};

const categories = await get('/categories/list/?language=ar');
const roots = categories.filter((c) => !c.parent_id);
const seen = new Map();
for (const root of roots) {
  for (let page = 1; ; page++) {
    const r = await get(`/hadeeths/list/?language=ar&category_id=${root.id}&page=${page}&per_page=100`);
    for (const h of r.data ?? []) {
      const title = String(h.title ?? '').replace(/\s+/g, ' ').trim();
      if (title && !seen.has(String(h.id))) seen.set(String(h.id), title);
    }
    if (page >= Number(r.meta?.last_page ?? 1)) break;
  }
  console.log(root.title, seen.size);
}
const rows = [...seen].sort((a, b) => Number(a[0]) - Number(b[0]));
await writeFile(new URL('../public/assets/hadith/enc-index.json', import.meta.url), JSON.stringify(rows));
console.log(`${rows.length} hadith`);
