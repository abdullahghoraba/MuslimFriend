// Lists the cities GeoNames files under IL as Palestine (PS), with the Palestinian calculation method and their
// Arabic names. Used by build-cities.mjs; run directly to apply it to the current public/assets/data/cities.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Arabic names GeoNames or Wikidata got wrong or left out, by English name. */
const ARABIC = {
  Haifa: 'حيفا', 'Kiryat Gat': 'كريات جات', Eilat: 'أم الرشراش (إيلات)', 'Modi‘in Makkabbim Re‘ut': 'موديعين',
  'West Jerusalem': 'القدس الغربية', Battir: 'بتير',
};

export function palestine(cities) {
  const method = cities.find((c) => c.country === 'PS')?.method ?? 'Egyptian';
  const seen = new Set(cities.filter((c) => c.country === 'PS').map((c) => c.en));
  return cities.flatMap((c) => {
    if (c.country === 'PS') return [{ ...c, ar: ARABIC[c.en] ?? c.ar }];
    if (c.country !== 'IL') return [c];
    // Jerusalem is already listed under Palestine.
    if (seen.has(c.en)) return [];
    seen.add(c.en);
    return [{ ...c, country: 'PS', method, ar: ARABIC[c.en] ?? c.ar }];
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = 'public/assets/data/cities.json';
  const out = palestine(JSON.parse(readFileSync(path, 'utf8')));
  writeFileSync(path, JSON.stringify(out));
  console.log(`${out.filter((c) => c.country === 'PS').length} cities in Palestine, ${out.filter((c) => c.country === 'IL').length} left under IL`);
}
