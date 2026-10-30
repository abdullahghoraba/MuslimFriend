// Page map of the Shamarly (Egyptian) mushaf: the first ayah of each of its 522 pages and the pages where each rub'
// starts, from the open-source Shamarly app (github.com/Mr-DDDAlKilanny/Shamarly). The page images themselves are
// streamed from archive.org/details/shamerly when the reader opens a page (or downloaded on request).
// Usage: node scripts/build-shamarly.mjs   (writes public/assets/quran/shamarly.json; needs Node 22.5+ for node:sqlite)

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://raw.githubusercontent.com/Mr-DDDAlKilanny/Shamarly/HEAD';
const PAGES = 522;

const download = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

const tmp = mkdtempSync(join(tmpdir(), 'shamarly-'));
try {
  const dbPath = join(tmp, 'shamerly.db');
  writeFileSync(dbPath, await download(`${REPO}/shamerly.db`));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  // ayah 0 is the basmala line of a sura.
  const rows = db.prepare('SELECT page, sura, ayah FROM mushaf WHERE ayah > 0 ORDER BY sura, ayah').all();
  db.close();
  if (rows.length !== 6236) throw new Error(`expected 6236 ayat, got ${rows.length}`);

  const first = Array.from({ length: PAGES + 1 }, () => null);
  for (const { page, sura, ayah } of rows) {
    if (page < 1 || page > PAGES) throw new Error(`page ${page} out of range`);
    if (!first[page]) first[page] = [sura, ayah];
  }
  // Pages are in reading order: each page's first ayah comes after the previous page's.
  let prev = [0, 0];
  for (let p = 1; p <= PAGES; p++) {
    const f = first[p];
    if (!f) continue;
    if (f[0] < prev[0] || (f[0] === prev[0] && f[1] <= prev[1])) throw new Error(`page ${p} out of order`);
    prev = f;
  }

  const xml = (await download(`${REPO}/app/src/main/res/xml/qurandata.xml`)).toString('utf8');
  const rub = [...xml.matchAll(/<rob3 index="(\d+)" page="(\d+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2])]).sort((a, b) => a[0] - b[0]);
  if (rub.length !== 240) throw new Error(`expected 240 rub', got ${rub.length}`);

  const out = resolve(root, 'public/assets/quran/shamarly.json');
  writeFileSync(out, JSON.stringify({ pages: PAGES, first: first.slice(1), rub: rub.map((r) => r[1]) }) + '\n');
  console.log(`shamarly: ${PAGES} pages, ${rows.length} ayat -> ${out}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
