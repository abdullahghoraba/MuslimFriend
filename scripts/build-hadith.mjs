// Reproducible, network-free build. Source snapshots and provenance live in content/hadith-sources.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (p) => resolve(root, 'content/hadith-sources', p);
const output = (p) => resolve(root, 'public/assets/hadith', p);
const read = (p) => JSON.parse(readFileSync(source(p), 'utf8'));
const check = process.argv.includes('--check');
const editions = read('editions.json');
const prefixes = { ar: 'ara', en: 'eng', ur: 'urd', fa: 'fas', tr: 'tur', id: 'ind', ms: 'msa', bn: 'ben', hi: 'hin', fr: 'fra', es: 'spa', de: 'deu', ru: 'rus', pt: 'por', zh: 'zho', sw: 'swa', ha: 'hau', uz: 'uzb' };
const names = { bukhari: 'صحيح البخاري', muslim: 'صحيح مسلم', abudawud: 'سنن أبي داود', tirmidhi: 'جامع الترمذي', nasai: 'سنن النسائي', ibnmajah: 'سنن ابن ماجه', malik: 'موطأ مالك', nawawi: 'الأربعون النووية', qudsi: 'الأربعون القدسية', dehlawi: 'أربعون الدهلوي' };
const catalog = read('catalog.json').map((c) => ({
  id: c.id, nameAr: names[c.id], nameEn: c.name, count: c.count, sections: c.sections,
  bundled: ['nawawi', 'qudsi'].includes(c.id),
  editions: Object.fromEntries(Object.entries(prefixes).flatMap(([lang, prefix]) => {
    const e = editions[c.id].collection.find((e) => e.name === `${prefix}-${c.id}`);
    return e ? [[lang, e.name]] : [];
  })),
}));
const artifacts = new Map([['catalog.json', catalog]]);
const packages = {};
for (const c of catalog.filter((c) => c.bundled)) {
  const data = {};
  for (const [lang, edition] of Object.entries(c.editions)) {
    const raw = read(`${edition}.json`);
    const ids = new Set();
    for (const h of raw.hadiths) {
      if (!/^\d+(\.\d+)?$/.test(String(h.hadithnumber)) || ids.has(String(h.hadithnumber)) || !h.text?.trim() || !Number.isInteger(h.reference?.book) || !Array.isArray(h.grades)) throw Error(`Invalid hadith in ${edition}`);
      ids.add(String(h.hadithnumber));
    }
    if (ids.size !== c.count) throw Error(`Incomplete ${edition}`);
    data[lang] = raw;
  }
  packages[c.id] = { version: 1, collection: c.id, editions: data };
  artifacts.set(`${c.id}.json`, packages[c.id]);
}
// Hadith of the day: every bundled hadith whose narrator («عن فلان رضي الله عنه») and source («رواه ...») the text
// states; the hand-checked entries of daily.json keep their wording. One a day, a different one each day.
const plain = (s) => s.replace(/<br\s*\/?>/gi, ' ').replace(/[ً-ْٰـ]/g, '').replace(/\s+/g, ' ').trim();
const narratorOf = (text) => {
  const m = /^عن\s+(.{3,80}?)\s+(?:رضي\s+الله\s+عن(?:ه|هما|ها|هم)|قال|أن\s|عن\s)/.exec(plain(text));
  // «عن أبي هريرة» -> «أبو هريرة» (only the kunya that opens the name, never «بن أبي ...»).
  return m ? m[1].replace(/[،,:]+$/, '').replace(/^(أمير المؤمنين )?أبي /, '$1أبو ').trim() : '';
};
const sourceOf = (text) => {
  // The compiler's grade may come first: «حديث حسن، رواه الترمذي»; one source says «رويناه».
  const m = /(?:حديث\s+(?:حسن|صحيح)(?:\s+صحيح)?[،,]?\s*)?\[?\s*(?:رواه|أخرجه|رويناه)[^]*$/.exec(plain(text));
  return m ? m[0].replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300) : '';
};
const curated = read('daily.json');
const handChecked = new Map(curated.map((e) => [`${e.collection}:${e.number}`, e]));
const derived = ['nawawi', 'qudsi'].flatMap((id) =>
  packages[id].editions.ar.hadiths.map((h) => {
    const number = String(h.hadithnumber);
    const known = handChecked.get(`${id}:${number}`);
    if (known) return known;
    const narrator = narratorOf(h.text), authenticitySource = sourceOf(h.text);
    return narrator && authenticitySource ? { collection: id, number, book: h.reference.book, narrator, authenticitySource } : null;
  }).filter(Boolean),
);
if (derived.length < 60) throw Error(`Daily set is too small (${derived.length})`);
const daily = derived.map((entry) => {
  const pack = packages[entry.collection];
  const texts = Object.fromEntries(Object.entries(pack.editions).map(([lang, edition]) => {
    const h = edition.hadiths.find((h) => String(h.hadithnumber) === entry.number);
    if (!h) throw Error(`Missing daily hadith ${entry.number}`);
    return [lang, h.text];
  }));
  if (!entry.narrator || !entry.authenticitySource || !texts.ar) throw Error('Missing daily provenance');
  return { ...entry, texts };
});
artifacts.set('daily.json', daily);
let bytes = 0;
for (const [file, value] of artifacts) {
  const text = JSON.stringify(value) + '\n';
  bytes += Buffer.byteLength(text);
  if (check) {
    if (!existsSync(output(file)) || readFileSync(output(file), 'utf8') !== text) throw Error(`Stale hadith asset: ${file}; run node scripts/build-hadith.mjs`);
  } else {
    mkdirSync(output('.'), { recursive: true });
    writeFileSync(output(file), text);
  }
}
if (bytes > 3_000_000) throw Error('Hadith bundle exceeds 3 MB');
if (!readFileSync(source('LICENSE'), 'utf8').includes('unlicense.org')) throw Error('Missing upstream licence');
console.log(`Hadith ${check ? 'checked' : 'built'}: ${catalog.length} collections, ${Object.values(packages).reduce((n, p) => n + p.editions.ar.hadiths.length, 0)} bundled hadith, ${daily.length} daily choices, ${bytes} bytes`);
