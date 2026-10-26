// Builds the offline Quran assets from Tanzil sources (all verbatim, never edited):
//   content/tanzil/quran-uthmani.txt          Uthmani text (CC BY 3.0)
//   content/quran-sources/quran-data.xml      metadata: suras, juz, hizb quarters, 604 Madani pages, sajdas
//   content/quran-sources/ar.muyassar.txt     Tafsir al-Muyassar (King Fahd Complex) — Tanzil, non-commercial
// Output (public/assets/quran/):
//   text.json                 string[6236] — global ayah index = sura start + ayah - 1
//   meta.json                 suras, juz, quarters, pages, sajdas, sources
//   tafsir/<id>/<sss>.json    string[] per sura (muyassar)
// Usage: node scripts/build-quran.mjs [--check]

import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => resolve(root, 'content/quran-sources', p);
const out = (p) => resolve(root, 'public/assets/quran', p);
const checkOnly = process.argv.includes('--check');

function readTanzilLines(path) {
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const first = line.indexOf('|');
    const second = line.indexOf('|', first + 1);
    map.set(`${line.slice(0, first)}:${line.slice(first + 1, second)}`, line.slice(second + 1));
  }
  return map;
}

function attrs(xml, tag) {
  const re = new RegExp(`<${tag}\\s+([^>]*?)\\s*/>`, 'g');
  return [...xml.matchAll(re)].map((m) => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
}

const xml = readFileSync(src('quran-data.xml'), 'utf8');
const suras = attrs(xml, 'sura').map((s) => ({
  index: +s.index, ayas: +s.ayas, start: +s.start, name: s.name, tname: s.tname, ename: s.ename,
  type: s.type, order: +s.order,
}));
const point = (x) => ({ sura: +x.sura, aya: +x.aya });
const meta = {
  suras,
  juz: attrs(xml, 'juz').map(point),
  quarters: attrs(xml, 'quarter').map(point),
  pages: attrs(xml, 'page').map(point),
  sajdas: attrs(xml, 'sajda').map((x) => ({ ...point(x), type: x.type })),
  sources: {
    text: 'Tanzil Quran Text (Uthmani, v1.1) © Tanzil Project, CC BY 3.0 — tanzil.net',
    metadata: 'Tanzil Quran Metadata — tanzil.net',
    tafsir: {
      muyassar: { nameAr: 'التفسير الميسر', nameEn: 'Al-Muyassar', by: 'King Fahd Glorious Quran Printing Complex', lang: 'ar' },
    },
    tafsirNote: 'Tafsir and translation texts from tanzil.net/trans — for non-commercial use.',
  },
};

const errors = [];
const expect = (cond, msg) => { if (!cond) errors.push(msg); };
expect(suras.length === 114, `expected 114 suras, got ${suras.length}`);
expect(meta.juz.length === 30, `expected 30 juz, got ${meta.juz.length}`);
expect(meta.quarters.length === 240, `expected 240 quarters, got ${meta.quarters.length}`);
expect(meta.pages.length === 604, `expected 604 pages, got ${meta.pages.length}`);
expect(meta.sajdas.length === 15, `expected 15 sajdas, got ${meta.sajdas.length}`);

const quran = readTanzilLines(resolve(root, 'content/tanzil/quran-uthmani.txt'));
const text = [];
for (const s of suras) for (let a = 1; a <= s.ayas; a++) text.push(quran.get(`${s.index}:${a}`));
expect(text.length === 6236 && text.every(Boolean), 'quran text incomplete');
suras.forEach((s) => expect(text.length && s.start < 6236, `bad start for ${s.index}`));

// Only al-Muyassar ships with the app; every other tafsir is a download in the tafsir library.
const tafsirs = { muyassar: 'ar.muyassar.txt' };
const tafsirData = {};
for (const [id, file] of Object.entries(tafsirs)) {
  const lines = readTanzilLines(src(file));
  tafsirData[id] = suras.map((s) => Array.from({ length: s.ayas }, (_, i) => lines.get(`${s.index}:${i + 1}`) ?? ''));
  const missing = tafsirData[id].flat().filter((t) => !t).length;
  expect(missing === 0, `${id}: ${missing} ayat without text`);
}

if (errors.length) {
  console.error('Quran build failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}
if (checkOnly) {
  console.log('Quran sources OK (check only)');
  process.exit(0);
}

mkdirSync(out('.'), { recursive: true });
writeFileSync(out('text.json'), JSON.stringify(text));
writeFileSync(out('meta.json'), JSON.stringify(meta));
for (const [id, perSura] of Object.entries(tafsirData)) {
  mkdirSync(out(`tafsir/${id}`), { recursive: true });
  perSura.forEach((ayat, i) => writeFileSync(out(`tafsir/${id}/${String(i + 1).padStart(3, '0')}.json`), JSON.stringify(ayat)));
}
mkdirSync(resolve(root, 'public/assets/fonts'), { recursive: true });
copyFileSync(src('AmiriQuran-Regular.ttf'), resolve(root, 'public/assets/fonts/AmiriQuran-Regular.ttf'));
copyFileSync(src('AmiriQuran-OFL.txt'), resolve(root, 'public/assets/fonts/AmiriQuran-OFL.txt'));
console.log(`Quran assets written: 6236 ayat, 604 pages, tafsir: ${Object.keys(tafsirs).join(', ')}`);
