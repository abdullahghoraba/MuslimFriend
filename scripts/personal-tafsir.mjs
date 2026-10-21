// Personal builds only: bundles tafsir files you keep OUTSIDE the project (e.g. a personal copy of a book that
// can't be redistributed) into public/assets/personal-tafsir/, so the app installs them on first start.
// The folder is git-ignored, and `npm run release` empties it first, so Play builds never contain these files.
//
// Usage: node scripts/personal-tafsir.mjs          → copy *.json from PERSONAL_TAFSIR_DIR (default ../zilal-personal)
//        node scripts/personal-tafsir.mjs --clear  → remove bundled personal tafsirs
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'public/assets/personal-tafsir');
rmSync(target, { recursive: true, force: true });
if (process.argv.includes('--clear')) {
  console.log('personal tafsir: cleared');
  process.exit(0);
}

const source = resolve(root, process.env.PERSONAL_TAFSIR_DIR ?? '../zilal-personal');
const files = existsSync(source)
  ? readdirSync(source).filter((f) => f.endsWith('.json') && f !== 'zilal-raw.json')
  : [];
const index = [];
for (const f of files) {
  const path = resolve(source, f);
  try {
    const head = JSON.parse(readFileSync(path, 'utf8'));
    if (head.type !== 'muslim-friend-tafsir') continue;
    mkdirSync(target, { recursive: true });
    copyFileSync(path, resolve(target, basename(f)));
    index.push({ file: basename(f), name: head.name ?? basename(f) });
  } catch {
    console.warn('personal tafsir: skipped unreadable', f);
  }
}
if (index.length) writeFileSync(resolve(target, 'index.json'), JSON.stringify(index));
console.log(index.length ? `personal tafsir: bundled ${index.map((i) => i.name).join(', ')}` : 'personal tafsir: none found (skipped)');
