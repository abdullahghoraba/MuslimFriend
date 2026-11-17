// Reciters that mp3quran.net does not have, from archive.org items with one MP3 per sura ("001.mp3" ... "114.mp3").
// Their ids are far above mp3quran's so they never clash. The suras listed are read from each item's own files.
// These are tilawat (selected passages, mostly mujawwad) filed under their sura, not complete suras.

const ARCHIVE = 'https://archive.org';

const EXTRA = [
  {
    id: 900001,
    ar: 'عبد الناصر حرك',
    en: 'Abdel Nasser Harak',
    item: 'abdel-nasser-al-harak',
  },
  {
    id: 900002,
    ar: 'راغب مصطفى غلوش',
    en: 'Ragheb Mustafa Ghalwash',
    item: 'raghib-mustafa-ghalush',
  },
];

/** The extra reciters in the catalogue's shape, each with one Hafs recording of the suras the item has. */
export async function extraReciters() {
  const out = [];
  for (const r of EXTRA) {
    const res = await fetch(`${ARCHIVE}/metadata/${r.item}`);
    if (!res.ok) throw new Error(`${r.item}: HTTP ${res.status}`);
    const meta = await res.json();
    const suras = [...new Set((meta.files ?? [])
      .filter((f) => f.source === 'original' && /^\d{3}\.mp3$/.test(f.name))
      .map((f) => Number(f.name.slice(0, 3)))
      .filter((s) => s >= 1 && s <= 114))].sort((a, b) => a - b);
    if (suras.length < 10) throw new Error(`${r.item}: only ${suras.length} suras`);
    out.push({
      id: r.id,
      ar: r.ar,
      en: r.en,
      moshaf: [{
        id: r.id,
        ar: 'حفص عن عاصم - تلاوات مجودة مختارة',
        en: 'Hafs from Asim - Selected Mujawwad Recitations',
        rewaya: 1,
        server: `${ARCHIVE}/download/${r.item}/`,
        suras: suras.length === 114 ? '' : suras.join(','),
      }],
    });
  }
  return out;
}

// node scripts/audio-extra-reciters.mjs: adds (or refreshes) them in the bundled catalogue without re-fetching mp3quran.
if (process.argv[1]?.endsWith('audio-extra-reciters.mjs')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public/assets/audio/catalog.json');
  const catalog = JSON.parse(readFileSync(file, 'utf8'));
  const extra = await extraReciters();
  const ids = new Set(extra.map((r) => r.id));
  catalog.reciters = [...catalog.reciters.filter((r) => !ids.has(r.id)), ...extra];
  writeFileSync(file, JSON.stringify(catalog) + '\n');
  for (const r of extra) console.log(`${r.ar}: ${r.moshaf[0].suras.split(',').length} suras`);
}
