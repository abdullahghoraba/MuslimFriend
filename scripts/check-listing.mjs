// Checks Play listing limits in store-assets/store-listing.md: title <= 30, short description <= 80.
import { readFileSync } from 'node:fs';

const lines = readFileSync(new URL('../store-assets/store-listing.md', import.meta.url), 'utf8').split(/\r?\n/);
const limits = { 'App name': 30, 'Short description': 80 };
let ok = true;
lines.forEach((line, i) => {
  for (const [label, max] of Object.entries(limits)) {
    if (!line.startsWith(`**${label}`)) continue;
    const text = (lines[i + 1] ?? '').trim();
    const len = [...text].length;
    console.log(`${len <= max ? 'OK      ' : 'TOO LONG'} ${label} (${len}/${max}): ${text}`);
    if (len > max) ok = false;
  }
});
process.exit(ok ? 0 : 1);
