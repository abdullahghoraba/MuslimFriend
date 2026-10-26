// Looks up Arabic (or Egyptian Arabic) names for the cities that GeoNames lists without one, from Wikidata (CC0), by GeoNames ID (P1566).
// Writes content/cities.ar-names.json ({ "<geonames id>": "<Arabic name>" }); build-cities.mjs uses it as a fallback.
// Usage: node scripts/fetch-arabic-city-names.mjs
import { readFile, writeFile } from 'node:fs/promises';

const ARABIC = /[؀-ۿ]/;
const BATCH = 300;
const out = new URL('../content/cities.ar-names.json', import.meta.url);

const cities = JSON.parse(await readFile(new URL('../public/assets/data/cities.json', import.meta.url), 'utf8'));
const known = JSON.parse(await readFile(out, 'utf8').catch(() => '{}'));
const missing = cities.filter((c) => !ARABIC.test(c.ar) && !(c.id in known)).map((c) => c.id);
console.log(`${missing.length} cities without an Arabic name to look up`);

async function query(ids) {
  const sparql = `SELECT ?gn ?label WHERE { VALUES ?gn { ${ids.map((i) => `"${i}"`).join(' ')} } ?item wdt:P1566 ?gn; rdfs:label ?label. FILTER(LANG(?label) IN ("ar", "arz")) }`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://query.wikidata.org/sparql', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json', 'user-agent': 'MuslimFriendCityNames/1.0 (https://github.com/abdullahghoraba/MuslimFriend)' },
      body: new URLSearchParams({ query: sparql }),
    });
    if (res.ok) return (await res.json()).results.bindings;
    if (attempt >= 4) throw new Error(`Wikidata ${res.status}`);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
}

let found = 0;
for (let i = 0; i < missing.length; i += BATCH) {
  const rows = await query(missing.slice(i, i + BATCH));
  // Standard Arabic first; Egyptian Arabic Wikipedia (arz) covers many smaller towns in the same script.
  rows.sort((a, b) => (a.label['xml:lang'] === 'ar' ? 0 : 1) - (b.label['xml:lang'] === 'ar' ? 0 : 1));
  for (const row of rows) {
    const name = row.label.value.trim();
    // Keep the first label per city; skip labels that are just the Latin name or carry a disambiguation in brackets.
    if (!known[row.gn.value] && ARABIC.test(name) && !/[()]/.test(name)) { known[row.gn.value] = name; found++; }
  }
  console.log(`${Math.min(i + BATCH, missing.length)} / ${missing.length}: ${found} found`);
  await writeFile(out, JSON.stringify(known, null, 0) + '\n');
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`done: ${Object.keys(known).length} Arabic names in content/cities.ar-names.json`);
