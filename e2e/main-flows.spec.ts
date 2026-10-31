import { test, expect, Page } from '@playwright/test';
import ar from '../public/assets/i18n/ar.json';
import content from '../public/assets/data/athkar.json';

// Playwright's page fixture creates an isolated context, including IndexedDB,
// for every test. Onboard through the UI rather than seeding storage.
async function onboard(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator('app-home .daily-card')).toHaveCount(2);
}
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}
async function count(page: Page, repetitions: number) {
  const card = page.locator('app-category article.card').first();
  for (let i = 1; i <= repetitions; i++) {
    await card.locator('button.counter').click();
    await expect(card.locator('.of')).toHaveText(i + '/' + repetitions);
  }
  await expect(card).toHaveClass(/done/);
}

test('first launch can skip setup and shows morning and evening cards', async ({ page }) => {
  await onboard(page);
  await expect(page.locator('.daily-card').filter({ hasText: ar.home.morning })).toBeVisible();
  await expect(page.locator('.daily-card').filter({ hasText: ar.home.evening })).toBeVisible();
});

test('the setup screen keeps each language button in place when the language flips the page direction', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  const button = (code: string) => page.locator(`.languages button[lang="${code}"]`);
  const columns = () => Promise.all(['ar', 'en', 'ur', 'fa', 'tr'].map(async (code) => (await button(code).boundingBox())!.x));
  await expect(button('en')).toBeEnabled();
  const arabic = await columns();
  await page.screenshot({ path: 'test-results/onboarding-ar.png' });
  await button('en').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(button('ar')).toBeEnabled();
  await page.screenshot({ path: 'test-results/onboarding-en.png' });
  expect(await columns()).toEqual(arabic);
});

test('language changes survive reloads with the matching document direction', async ({ page }) => {
  await onboard(page);
  await open(page, '/settings');
  await page.locator('ion-segment-button[value="en"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('ion-segment-button[value="ar"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
});

test('all morning items render together and progress can be restarted', async ({ page }) => {
  await onboard(page);
  await open(page, '/category/morning');
  const items = content.items.filter(item => item.categoryId === 'morning');
  const cards = page.locator('app-category article.card');
  await expect(cards).toHaveCount(items.length);
  // Exact text per card, in order (some athkar start with the same words as others).
  await expect(page.locator('app-category article.card .dhikr-text')).toHaveText(items.map(item => item.textAr));
  await expect(page.locator('app-category .position')).toHaveText(`0 من ${items.length}`);
  await count(page, items[0].repeatCount);
  await expect(page.locator('app-category .position')).toHaveText(`1 من ${items.length}`);
  await listMenu(page, ar.category.resetToday);
  await expect(cards.first()).not.toHaveClass(/done/);
  await expect(cards.first().locator('.of')).toHaveText('0/' + items[0].repeatCount);
  await expect(page.locator('app-category .position')).toHaveText(`0 من ${items.length}`);
});

/** Less frequent list actions live in the header's "More options" (⋮) action sheet. */
async function listMenu(page: import('@playwright/test').Page, action: string) {
  await page.getByRole('button', { name: ar.category.moreOptions, exact: true }).click();
  await page.locator('ion-action-sheet').getByRole('button', { name: action, exact: true }).click();
  await expect(page.locator('ion-action-sheet')).toHaveCount(0);
}

test('tasbih reaches its default target and records 33 today', async ({ page }) => {
  await onboard(page);
  await open(page, '/tasbih');
  const button = page.locator('app-tasbih button.count');
  await expect(button.locator('.target')).toHaveText('/ 33');
  for (let i = 1; i <= 33; i++) {
    await button.click();
    await expect(button.locator('.number')).toHaveText(String(i));
  }
  await expect(page.locator('ion-toast').getByText(ar.tasbih.completed, { exact: true })).toBeVisible();
  await expect(page.locator('app-tasbih .totals strong')).toHaveText('33');
  await expect(page.locator('app-tasbih .totals')).toContainText(ar.tasbih.todayTotal.replace('{{count}}', '33'));
});

test('custom dhikr can be added, read three times and deleted', async ({ page }) => {
  await onboard(page);
  await open(page, '/my-athkar');
  await page.getByRole('button', { name: ar.myAthkar.add, exact: true }).first().click();
  const modal = page.locator('ion-modal');
  const text = 'سبحان الله وبحمده — اختبار';
  await modal.getByRole('textbox', { name: ar.myAthkar.text, exact: true }).fill(text);
  await modal.getByRole('spinbutton', { name: ar.myAthkar.repeat, exact: true }).fill('3');
  await modal.getByRole('button', { name: ar.common.save, exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.locator('app-my-athkar .text')).toHaveText(text);
  await page.getByRole('button', { name: ar.myAthkar.read, exact: true }).click();
  await expect(page.locator('app-category article.card')).toHaveCount(1);
  await count(page, 3);
  await open(page, '/my-athkar');
  await page.getByText(text, { exact: true }).click();
  await modal.getByRole('button', { name: ar.common.delete, exact: true }).click();
  await page.locator('ion-alert').getByRole('button', { name: ar.common.delete, exact: true }).click();
  await expect(page.locator('app-my-athkar .text')).toHaveCount(0);
  await expect(page.getByText(ar.myAthkar.empty, { exact: true })).toBeVisible();
});

test('evening reorder mode exposes handles and exits cleanly', async ({ page }) => {
  await onboard(page);
  await open(page, '/category/evening');
  const total = content.items.filter(item => item.categoryId === 'evening').length;
  await expect(page.locator('app-category article.card')).toHaveCount(total);
  await listMenu(page, ar.common.reorder);
  await expect(page.locator('app-category ion-reorder-group')).toHaveJSProperty('disabled', false);
  await expect(page.locator('app-category ion-reorder')).toHaveCount(total);
  await expect(page.locator('app-category ion-reorder').first()).toBeVisible();
  // Ionic pointer reordering is sensitive to scroll/animation timing. Exercise
  // the permitted mode/handle fallback without synthesizing component events.
  await page.getByRole('button', { name: ar.common.finishReorder, exact: true }).click();
  await expect(page.locator('app-category ion-reorder')).toHaveCount(0);
  await expect(page.locator('app-category article.card')).toHaveCount(total);
});

test('choosing Cairo calculates all six prayer times', async ({ page }) => {
  await onboard(page);
  await open(page, '/reminders');
  await page.getByText(ar.reminders.chooseCity, { exact: true }).click();
  await page.locator('ion-modal').getByText('القاهرة', { exact: true }).click();
  await expect(page.locator('ion-modal')).not.toBeVisible();
  const list = page.locator('app-reminders ion-list').filter({ has: page.getByText(ar.reminders.todayTimes, { exact: true }) });
  await expect(list.locator('ion-item')).toHaveCount(6);
  for (const row of await list.locator('ion-item').all()) {
    await expect(row.locator('.time')).toHaveText(/\d{1,2}:\d{2}/);
  }
});

test('export backup downloads a JSON file', async ({ page }) => {
  await onboard(page);
  await open(page, '/settings');
  const downloaded = page.waitForEvent('download');
  await page.getByText(ar.backup.export, { exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.json$/i);
  expect(await download.failure()).toBeNull();
});
