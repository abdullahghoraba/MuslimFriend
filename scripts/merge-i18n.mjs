// Merges i18n-fragments/<feature>.<lang>.json into public/assets/i18n/<lang>.json, then deletes
// the fragments. Fragments let several people (or agents) add strings without editing the same file.
// Usage: node scripts/merge-i18n.mjs

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fragDir = resolve(root, 'i18n-fragments');
if (!existsSync(fragDir)) process.exit(0);

const deepMerge = (target, source) => {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = deepMerge(target[k] ?? {}, v);
    else target[k] = v;
  }
  return target;
};

const keysOf = (o, prefix = '') =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

const merged = {};
for (const file of readdirSync(fragDir).filter((f) => f.endsWith('.json'))) {
  const [, lang] = file.match(/\.([a-z]{2})\.json$/) ?? [];
  if (!lang) continue;
  const target = resolve(root, 'public/assets/i18n', `${lang}.json`);
  const data = JSON.parse(readFileSync(target, 'utf8'));
  deepMerge(data, JSON.parse(readFileSync(resolve(fragDir, file), 'utf8')));
  writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  merged[lang] = true;
  rmSync(resolve(fragDir, file));
  console.log(`merged ${file}`);
}

// Both languages must expose the same keys.
const ar = keysOf(JSON.parse(readFileSync(resolve(root, 'public/assets/i18n/ar.json'), 'utf8')));
const en = keysOf(JSON.parse(readFileSync(resolve(root, 'public/assets/i18n/en.json'), 'utf8')));
const missing = [...ar.filter((k) => !en.includes(k)).map((k) => `en: ${k}`), ...en.filter((k) => !ar.includes(k)).map((k) => `ar: ${k}`)];
if (missing.length) {
  console.error(`Missing translation keys:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n OK (${ar.length} keys)`);
