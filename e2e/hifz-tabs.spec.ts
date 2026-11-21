import { test, expect, Page } from '@playwright/test';
import ar from '../public/assets/i18n/ar.json';

async function onboard(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test.use({ viewport: { width: 390, height: 844 } });

test('Hifz has its plans, tasmee\' and «test yourself» as three tabs, and «test yourself» is nowhere else', async ({ page }) => {
  await onboard(page);
  await page.goto('/more');
  await expect(page.locator('ion-item', { hasText: ar.hifz.title }).first()).toBeVisible();
  await expect(page.locator('ion-item', { hasText: ar.recall.title })).toHaveCount(0);

  await page.goto('/hifz');
  const tabs = page.locator('ion-segment-button');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(2)).toHaveText(ar.recall.title);
  await expect(page.getByRole('button', { name: ar.recall.title, exact: true })).toHaveCount(0); // no second button for it
  await page.screenshot({ path: 'test-results/hifz-tabs.png' });

  // Old links open the third tab, on their ayat.
  await page.goto('/hifz/test?sura=112&from=1&to=4');
  await expect(page).toHaveURL(/\/hifz\?.*tab=test/);
  const hifz = page.locator('app-hifz:not(.ion-page-hidden)');
  await expect(hifz.locator('app-hifz-test')).toBeVisible();
  await expect(hifz.locator('ion-toolbar ion-segment-button.segment-button-checked')).toHaveText(ar.recall.title);
  await page.screenshot({ path: 'test-results/hifz-test-tab.png' });

  await hifz.locator('ion-segment-button[value=tasmee]').click();
  // From memory or reading from the mushaf, then the engine: the Quran AI first, and chosen by default.
  await expect(hifz.locator('app-tasmee ion-segment.read-mode ion-segment-button')).toHaveCount(2);
  const engines = hifz.locator('app-tasmee ion-segment-button[value=offline], app-tasmee ion-segment-button[value=phone]');
  await expect(engines.first()).toHaveAttribute('value', 'offline');
  await expect(engines.first()).toHaveClass(/segment-button-checked/);
  await page.screenshot({ path: 'test-results/hifz-tasmee-tab.png' });
});

test('tasmee\' can check the harakat, or the harakat and tajweed, and remembers the choice', async ({ page }) => {
  await onboard(page);
  await page.goto('/hifz?tab=tasmee');
  const tasmee = page.locator('app-hifz:not(.ion-page-hidden) app-tasmee');
  const level = tasmee.locator('ion-segment.check-level ion-segment-button');
  await expect(level).toHaveCount(3);
  await expect(level.first()).toHaveClass(/segment-button-checked/); // the words only, by default
  await expect(tasmee.getByText(ar.tasmee.checkHint)).toHaveCount(0);
  await tasmee.locator('ion-segment.check-level ion-segment-button[value=tashkeel]').click();
  await expect(tasmee.getByText(ar.tasmee.checkHint)).toBeVisible();
  await page.screenshot({ path: 'test-results/tasmee-check-level.png' });
  await page.reload();
  await expect(page.locator('app-hifz:not(.ion-page-hidden) app-tasmee ion-segment.check-level ion-segment-button[value=tashkeel]')).toHaveClass(/segment-button-checked/);
});

test('the tab bar keeps every icon in the same place and fills the selected one', async ({ page }) => {
  await onboard(page);
  await page.goto('/tasbih');
  await expect(page.getByText(ar.tasbih.noTarget)).toBeVisible();
  const boxes = await page.locator('ion-tab-button').evaluateAll((buttons) =>
    buttons.map((b) => {
      const i = b.querySelector('ion-icon')!.getBoundingClientRect();
      const l = b.querySelector('ion-label')!.getBoundingClientRect();
      return { tab: b.getAttribute('tab'), name: b.querySelector('ion-icon')!.getAttribute('name'), w: Math.round(i.width), h: Math.round(i.height), top: Math.round(i.top), label: Math.round(l.top) };
    }),
  );
  expect(new Set(boxes.map((b) => `${b.w}x${b.h}@${b.top}/${b.label}`)).size).toBe(1);
  expect(boxes.find((b) => b.tab === 'tasbih')?.name).toBe('prayer-beads');
  expect(boxes.find((b) => b.tab === 'home')?.name).toBe('home-outline');
  // Room around the bar: the end tabs (Home, Settings) away from the screen's corners, the labels off its bottom edge.
  const room = await page.locator('ion-tab-bar').evaluate((bar) => {
    const tabs = [...bar.querySelectorAll('ion-tab-button')].map((t) => t.getBoundingClientRect());
    const labels = [...bar.querySelectorAll('ion-label')].map((l) => l.getBoundingClientRect().bottom);
    return { left: Math.min(...tabs.map((t) => t.left)), right: innerWidth - Math.max(...tabs.map((t) => t.right)), bottom: innerHeight - Math.max(...labels) };
  });
  expect(room.left).toBeGreaterThanOrEqual(12);
  expect(room.right).toBeGreaterThanOrEqual(12);
  expect(room.bottom).toBeGreaterThanOrEqual(10);
  await page.screenshot({ path: 'test-results/tabbar-tasbih.png' });
});
