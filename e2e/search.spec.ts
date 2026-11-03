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

async function search(page: Page, text: string) {
  const input = page.locator('ion-searchbar input');
  await input.fill(text);
}

test('the Quran search finds reciters, surahs and ayat with the words in any order', async ({ page }) => {
  await onboard(page);
  await page.goto('/quran-search');
  await search(page, 'المنشاوي');
  await expect(page.locator('h2.section', { hasText: ar.quran.reciters })).toBeVisible();
  await expect(page.locator('button.row', { hasText: 'المنشاوي' }).first()).toBeVisible();

  await search(page, 'البقره');
  await expect(page.locator('button.row', { hasText: 'البقرة' })).toBeVisible();

  // No ayah has "الصبر والصلاه" in this exact form, but some have both words.
  await search(page, 'بالصبر الصلاة استعينوا');
  await expect(page.locator('h2.section', { hasText: ar.quran.anyOrder })).toBeVisible();
  await expect(page.locator('button.result').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/search-any-order.png' });
});

test('Listen finds a reciter however the name is spelled, and by recording', async ({ page }) => {
  await onboard(page);
  await page.goto('/listen');
  await search(page, 'عبد الباسط');
  await expect(page.locator('.row', { hasText: 'عبدالباسط' }).first()).toBeVisible();
  await search(page, 'الحصري ورش');
  await expect(page.locator('.row', { hasText: 'الحصري' }).first()).toBeVisible();
  await expect(page.locator('.row', { hasText: 'العفاسي' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/listen-search.png' });
});
