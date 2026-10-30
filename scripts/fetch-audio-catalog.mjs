// Snapshot of the mp3quran.net catalogue (full-sura reciters and live Quran radios) bundled with the app,
// so the Listen page has its lists on first open and offline; the app refreshes it in the reader's language.
// Usage: node scripts/fetch-audio-catalog.mjs   (writes public/assets/audio/catalog.json)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://mp3quran.net/api/v3';

const get = async (path) => {
  const res = await fetch(`${API}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

const [recAr, recEn, radAr, radEn, rwAr] = await Promise.all([
  get('reciters?language=ar'),
  get('reciters?language=eng'),
  get('radios?language=ar'),
  get('radios?language=eng'),
  get('riwayat?language=ar'),
]);

const byId = (list) => new Map(list.map((x) => [x.id, x]));
const recEnById = byId(recEn.reciters);
const radEnById = byId(radEn.radios);

const reciters = recAr.reciters
  .map((r) => {
    const en = recEnById.get(r.id);
    const enMoshaf = byId(en?.moshaf ?? []);
    return {
      id: r.id,
      ar: r.name.trim(),
      en: (en?.name ?? r.name).trim(),
      moshaf: r.moshaf
        .filter((m) => m.server && m.surah_list)
        .map((m) => ({
          id: m.id,
          ar: m.name.trim(),
          en: (enMoshaf.get(m.id)?.name ?? m.name).trim(),
          rewaya: m.rewaya_id,
          server: m.server,
          // Empty means all 114 suras.
          suras: m.surah_total === 114 ? '' : m.surah_list,
        })),
    };
  })
  .filter((r) => r.moshaf.length);

const radios = radAr.radios
  // radiojar.com redirects every stream to plain http, which the app does not load (no cleartext traffic).
  .filter((r) => r.url?.startsWith('https://') && !new URL(r.url).hostname.endsWith('radiojar.com'))
  .map((r) => ({ id: r.id, ar: r.name.trim(), en: (radEnById.get(r.id)?.name ?? r.name).trim(), url: r.url }));

// The riwayat (Warsh, Qalun, Khalaf...), to browse the ten qira'at. mp3quran's English names are garbled, so ours.
const RIWAYAH_EN = {
  1: 'Hafs from Asim', 2: "Warsh from Nafi'", 3: 'Khalaf from Hamzah', 4: 'Al-Bazzi from Ibn Kathir', 5: "Qalun from Nafi'",
  6: 'Qunbul from Ibn Kathir', 7: 'As-Susi from Abu Amr', 8: "Qalun from Nafi' (Abu Nashit)", 9: "Ya'qub: Ruways and Rawh",
  10: "Warsh from Nafi' (al-Asbahani)", 11: 'Al-Bazzi and Qunbul from Ibn Kathir', 12: "Ad-Duri from al-Kisa'i",
  13: 'Ad-Duri from Abu Amr', 15: "Shu'bah from Asim", 16: 'Ibn Dhakwan from Ibn Amir', 18: "Warsh from Nafi' (al-Azraq)",
  19: 'Hisham from Ibn Amir', 20: "Ibn Jammaz from Abu Ja'far", 21: 'Teaching recitation', 22: 'Mujawwad',
};
const used = new Set(reciters.flatMap((r) => r.moshaf.map((m) => m.rewaya)));
const riwayat = rwAr.riwayat
  .filter((r) => used.has(r.id))
  .map((r) => ({ id: r.id, ar: r.name.replace(/\s+/g, ' ').trim(), en: RIWAYAH_EN[r.id] ?? r.name }));

if (reciters.length < 100 || radios.length < 50) throw new Error(`catalogue too small: ${reciters.length} reciters, ${radios.length} radios`);

const out = resolve(root, 'public/assets/audio/catalog.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), riwayat, reciters, radios }) + '\n');
console.log(`audio catalogue: ${reciters.length} reciters, ${riwayat.length} riwayat, ${radios.length} radios -> ${out}`);
