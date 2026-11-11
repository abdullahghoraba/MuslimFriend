import { test, expect, Page } from '@playwright/test';
import ar from '../public/assets/i18n/ar.json';
import qcf from '../public/assets/quran/madinah-qcf.json';

// The Madinah mushaf's two views: the flowing text in the King Fahd Complex's font (default) and «صفحة كالمطبوع»,
// the printed page in the Complex's page fonts (downloaded from static.qurancdn.com the first time a page opens).

type View = { view?: 'flow' | 'print'; scale?: number; theme?: string };

async function openMushaf(page: Page, p: number, prefs: View = {}) {
  // Only on the first load of the test's fresh context, so what the app saves itself survives a reload.
  await page.addInitScript((v) => {
    if (localStorage.getItem('CapacitorStorage.mushafView')) return;
    localStorage.setItem('CapacitorStorage.onboarded', 'true');
    localStorage.setItem('CapacitorStorage.mushafView', JSON.stringify({ theme: v.theme ?? 'paper', scale: v.scale ?? 1, view: v.view ?? 'flow' }));
  }, prefs);
  await page.goto(`/mushaf/${p}`);
}

/** Per line of the printed page: overflow, the widest gap between two words (in em), and whether it is centred. */
async function printLines(page: Page) {
  return page.locator('.print-page').evaluate((pg) => {
    const size = parseFloat(getComputedStyle(pg).getPropertyValue('--qcf-size'));
    return [...pg.querySelectorAll<HTMLElement>('.print-line:not(.print-basmala-line)')].map((line) => {
      const boxes = [...line.children].map((c) => c.getBoundingClientRect());
      let gap = 0;
      for (let i = 0; i < boxes.length - 1; i++) gap = Math.max(gap, boxes[i].left - boxes[i + 1].right);
      return { overflow: line.scrollWidth - line.clientWidth, gapEm: gap / size, short: line.classList.contains('short') };
    });
  });
}

const textLines = (p: number) => (qcf.pages[p - 1] as unknown[][]).filter((l) => Array.isArray(l[0])).length;
/** Text lines (1-based among the page's text lines) that close a sura: the print centres them when they are short. */
function closingLines(p: number): number[] {
  const lines = qcf.pages[p - 1] as unknown[][];
  const out: number[] = [];
  let n = 0;
  lines.forEach((l, i) => {
    if (!Array.isArray(l[0])) return;
    n++;
    const next = (lines[i + 1] ?? (qcf.pages[p] as unknown[][] | undefined)?.[0]) as unknown[] | undefined;
    if (!next || next[0] === 's' || p === 604) out.push(n);
  });
  return out;
}

test('the Madinah mushaf opens in the flowing view, in the King Fahd Complex font, and re-wraps when enlarged', async ({ page }) => {
  for (const scale of [1, 1.8]) {
    await openMushaf(page, 50, { scale });
    await expect(page.locator('.page-text.qpc [data-ayah]').first()).toBeVisible();
    await expect(page.locator('.print-page')).toHaveCount(0);
    await expect(page.locator('app-sura-banner')).toHaveCount(1);
    // Nothing runs off the screen: the text wraps instead.
    const overflow = await page.evaluate(() => document.querySelector('.page-text')!.scrollWidth - document.querySelector('.page-text')!.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test('«صفحة كالمطبوع» is chosen in the reading settings and kept', async ({ page }) => {
  await openMushaf(page, 50);
  await page.getByRole('button', { name: ar.mushaf.viewSettings }).click();
  await expect(page.locator('ion-segment.view-mode')).toContainText(ar.mushaf.viewPrint);
  await page.locator('ion-segment.view-mode ion-segment-button[value="print"]').click();
  await expect(page.locator('.print-page .qcf-word').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.print-page .qcf-word').first()).toBeVisible();
  await page.getByRole('button', { name: ar.mushaf.viewSettings }).click();
  await page.locator('ion-segment.view-mode ion-segment-button[value="flow"]').click();
  await expect(page.locator('.page-text.qpc [data-ayah]').first()).toBeVisible();
  await expect(page.locator('.print-page')).toHaveCount(0);
});

for (const p of [1, 2, 3, 27, 50, 106, 187, 255, 300, 377, 420, 512, 590, 602, 604]) {
  test(`printed page ${p}: every line as printed, no wide gaps, nothing off the screen`, async ({ page }) => {
    await openMushaf(page, p, { view: 'print' });
    await expect(page.locator('.print-page .qcf-word').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const lines = await printLines(page);
    expect(lines.length).toBe(textLines(p));
    const closing = closingLines(p);
    lines.forEach((l, i) => {
      expect(l.overflow, `line ${i + 1} overflows`).toBeLessThanOrEqual(1);
      if (p > 2) {
        // Only a sura's short closing line is centred; every other line is spread with tiny gaps between its words.
        if (l.short) expect(closing, `line ${i + 1} is centred but does not close a sura`).toContain(i + 1);
        else expect(l.gapEm, `line ${i + 1} has a wide gap`).toBeLessThan(0.25);
      }
    });
  });
}

test('the printed page keeps its size: a larger text size shows the flowing text, with a note', async ({ page }) => {
  await openMushaf(page, 50, { view: 'print', scale: 1.3 });
  await expect(page.locator('.page-text.qpc [data-ayah]').first()).toBeVisible();
  await expect(page.locator('.print-page')).toHaveCount(0);
  await page.getByRole('button', { name: ar.mushaf.viewSettings }).click();
  await expect(page.getByText(ar.mushaf.printZoomHint)).toBeVisible();
});

test('offline the first time, a printed page falls back to the flowing text and says why', async ({ page }) => {
  await page.route('https://static.qurancdn.com/**', (route) => route.abort('internetdisconnected'));
  await openMushaf(page, 50, { view: 'print' });
  await expect(page.locator('.page-text.qpc [data-ayah]').first()).toBeVisible();
  await expect(page.getByText(ar.mushaf.printOffline)).toBeVisible();
  // Back online, the next page opens printed.
  await page.unroute('https://static.qurancdn.com/**');
  await page.getByRole('button', { name: ar.mushaf.nextPage }).click();
  await expect(page.locator('.print-page .qcf-word').first()).toBeVisible();
});

test('on the printed page, tapping a word selects its whole ayah and turning the page loads the next one', async ({ page }) => {
  await openMushaf(page, 50, { view: 'print' });
  const word = page.locator('.print-page .qcf-word[data-ayah="3:2"]').first();
  await expect(word).toBeVisible();
  await word.click();
  await expect(page.locator('.ayah-actions')).toBeVisible();
  const ayah = page.locator('.print-page .qcf-word[data-ayah="3:2"]');
  const n = await ayah.count();
  expect(n).toBeGreaterThan(3);
  await expect(page.locator('.print-page .qcf-word[data-ayah="3:2"].selected')).toHaveCount(n);
  await expect(page.locator('.print-page .qcf-word.selected:not([data-ayah="3:2"])')).toHaveCount(0);
  // One band over the ayah, not a box round each word.
  const outlines = await ayah.evaluateAll((els) => els.map((e) => getComputedStyle(e).outlineStyle));
  expect(outlines.every((o) => o === 'none')).toBe(true);
  await page.getByRole('button', { name: ar.mushaf.nextPage }).click();
  await expect(page).toHaveURL(/\/mushaf\/51$/);
  await expect(page.locator('.print-page .qcf-word').first()).toBeVisible();
});

test('the printed page in the night theme and on a tablet', async ({ page }) => {
  await openMushaf(page, 50, { view: 'print', theme: 'night' });
  await expect(page.locator('.print-page .qcf-word').first()).toBeVisible();
  const colour = await page.locator('.print-page').evaluate((el) => getComputedStyle(el).color);
  expect(colour).not.toBe('rgb(0, 0, 0)');
  await page.setViewportSize({ width: 800, height: 1200 });
  await page.waitForTimeout(400);
  const lines = await printLines(page);
  for (const l of lines) expect(l.overflow).toBeLessThanOrEqual(1);
  const width = await page.locator('.print-page').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(600);
});
