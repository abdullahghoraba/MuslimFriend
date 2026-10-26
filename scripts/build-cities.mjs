// Builds public/assets/data/cities.json: every city of 50,000+ people plus capitals, worldwide, from GeoNames
// (cities15000, CC BY 4.0, https://www.geonames.org), with an Arabic name where GeoNames has one and the usual
// prayer-time calculation method of the country. The hand-checked cities in content/cities.curated.json keep
// their Arabic names and exact coordinates.
// Usage: node scripts/build-cities.mjs <path to cities15000.txt>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , source] = process.argv;
if (!source) throw new Error('usage: node scripts/build-cities.mjs <cities15000.txt>');
const curated = JSON.parse(readFileSync('content/cities.curated.json', 'utf8'));

/** The calculation method used by each country's religious authority (MuslimWorldLeague elsewhere). */
const METHOD_BY_COUNTRY = {
  EG: 'Egyptian', SD: 'Egyptian', LY: 'Egyptian', SY: 'Egyptian', LB: 'Egyptian', IQ: 'Egyptian', PS: 'Egyptian',
  SA: 'UmmAlQura', YE: 'UmmAlQura', AE: 'Dubai', KW: 'Kuwait', QA: 'Qatar', BH: 'Gulf', OM: 'Gulf', JO: 'Jordan',
  DZ: 'Algeria', MA: 'Morocco', TN: 'Tunisia', TR: 'Turkey', IR: 'Tehran', PK: 'Karachi', IN: 'Karachi',
  BD: 'Karachi', AF: 'Karachi', ID: 'Indonesia', MY: 'Malaysia', SG: 'Singapore', BN: 'Singapore', RU: 'Russia',
  FR: 'France', US: 'NorthAmerica', CA: 'NorthAmerica', GB: 'MoonsightingCommittee',
};
const curatedMethod = Object.fromEntries(curated.map((c) => [c.country, c.method]));
const methodOf = (country) => METHOD_BY_COUNTRY[country] ?? curatedMethod[country] ?? 'MuslimWorldLeague';

// Arabic script without the letters only Persian, Urdu, Pashto and Kurdish use.
const ARABIC = /^[ء-يً-ْٰ\s\-'()]+$/;
const arabicName = (alternates) => alternates.split(',').find((n) => ARABIC.test(n) && /[ء-ي]/.test(n));
// Wikidata labels for the cities GeoNames has no Arabic name for (scripts/fetch-arabic-city-names.mjs), without a leading «مدينة» ("city of").
const wikidataArabic = JSON.parse(readFileSync(new URL('../content/cities.ar-names.json', import.meta.url), 'utf8'));
const fromWikidata = (id) => wikidataArabic[id]?.replace(/^مدينة\s+/, '');

// About 1 km: prayer times move by seconds, and the file stays small.
const round = (n) => Math.round(n * 100) / 100;
const cities = [];
for (const line of readFileSync(source, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  const [id, name, ascii, alternates, lat, lng, , feature, country] = f;
  const population = Number(f[14]);
  if (population < 50_000 && feature !== 'PPLC') continue;
  cities.push({
    id, ar: arabicName(alternates) ?? fromWikidata(id) ?? name, en: name !== ascii && /[^\x00-\x7F]/.test(name) ? name : ascii,
    country, lat: round(+lat), lng: round(+lng), method: methodOf(country), population,
  });
}

// Curated entries replace the nearest GeoNames city (same country, within 25 km, the same name or else the biggest, each used once), or are added.
const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const taken = new Set();
for (const c of curated) {
  const near = cities.filter((g) => !taken.has(g) && g.country === c.country && km(g, c) < 25);
  const sameName = (g) => g.ar === c.ar || g.en.toLowerCase() === c.en.toLowerCase();
  const match = near.find(sameName) ?? near.sort((a, b) => b.population - a.population)[0];
  // They also come first in the list shown before the user types.
  if (match) {
    taken.add(match);
    Object.assign(match, { ar: c.ar, en: c.en, lat: round(c.lat), lng: round(c.lng), population: 1e9 + match.population });
  } else cities.push({ ...c, lat: round(c.lat), lng: round(c.lng), method: methodOf(c.country), population: 1e9 });
}

// Biggest first, so a search lists the city people mean before smaller places of the same name.
cities.sort((a, b) => b.population - a.population);
const out = cities.map(({ population, ...c }) => c);
writeFileSync('public/assets/data/cities.json', JSON.stringify(out));
console.log(`${out.length} cities, ${out.filter((c) => /[ء-ي]/.test(c.ar)).length} with an Arabic name`);
