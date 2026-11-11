// Checks public/assets/quran/madinah-qcf.json against the fonts themselves: every page is set in its own QCF v2 font,
// and each of its text lines is measured. In the print every line of a page is full (pages 1 and 2 aside), and these
// fonts are drawn so that a full line always measures the same, so a line much wider or narrower than the others of
// its page means a word on the wrong line, a missing ayah number or a wrong glyph.
//
// Usage: node scripts/madinah-qcf/check.mjs [fromPage=3] [toPage=604]   (downloads the 604 fonts, ~70 MB)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const [from = 3, to = 604] = process.argv.slice(2).map(Number);
const data = JSON.parse(readFileSync(new URL('../../public/assets/quran/madinah-qcf.json', import.meta.url), 'utf8'));
/**
 * Full lines measure alike within this (glyphs differ a little; the page spreads them over the width). The narrowest
 * full lines, checked by eye and complete, are page 254 line 7 (-4.7%) and page 146 line 1 (-4.2%).
 */
const TOLERANCE = 0.05;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setContent('<body></body>');
const problems = [];
for (let p = from; p <= to; p++) {
  const lines = data.pages[p - 1].map((line) => (Array.isArray(line[0]) ? line.flatMap((run) => run[1]).join('') : null));
  const widths = await page.evaluate(async ({ p, lines, url }) => {
    const face = new FontFace(`p${p}`, `url(${url.replace('{page}', p)})`);
    await face.load();
    document.fonts.add(face);
    const span = document.createElement('span');
    span.style.cssText = `font: 40px p${p}; white-space: nowrap`;
    document.body.append(span);
    const out = lines.map((text) => {
      if (text === null) return null;
      span.textContent = text;
      return span.getBoundingClientRect().width;
    });
    span.remove();
    document.fonts.delete(face);
    return out;
  }, { p, lines, url: data.font });
  const full = widths.filter((w) => w !== null).sort((a, b) => a - b);
  const median = full[Math.floor(full.length / 2)];
  widths.forEach((w, i) => {
    if (w === null) return;
    const off = w / median - 1;
    // A sura's closing line may be short (the print centres it): the next line is a sura title, or the Quran ends.
    const next = data.pages[p - 1][i + 1] ?? data.pages[p]?.[0];
    const closesSura = !next || next[0] === 's' || (p === 604 && i >= 13);
    if (off < -TOLERANCE && closesSura) return;
    if (Math.abs(off) > TOLERANCE) problems.push(`page ${p} line ${i + 1}: ${Math.round(w)} vs ${Math.round(median)} (${(off * 100).toFixed(1)}%)`);
  });
  if (p % 50 === 0) console.log(`… page ${p}`);
}
await browser.close();
console.log(problems.length ? `${problems.length} lines to look at:\n${problems.join('\n')}` : `all lines of pages ${from}-${to} measure alike`);
