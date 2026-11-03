import { test, expect, Page } from '@playwright/test';
import ar from '../public/assets/i18n/ar.json';
import areas from '../public/assets/quran/shamarly-ayat.json';

async function onboard(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
}

// Needs the network: the scanned pages come from archive.org.
test('the Shamarly mushaf shows the scanned page and a tapped ayah opens its tafsir', async ({ page }) => {
  await onboard(page);
  await page.goto('/mushaf-edition/shamarly/367');
  const scan = page.locator('.scan');
  await expect(scan.locator('img')).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => scan.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // Fatir 30 on page 367: tap the middle of its first area.
  const [, , r] = (areas.pages[366] as [number, number, number[]][]).find(([s, a]) => s === 35 && a === 30)!;
  const box = (await scan.boundingBox())!;
  await page.mouse.click(box.x + (box.width * (r[0] + r[2])) / 2000, box.y + (box.height * (r[1] + r[3])) / 2000);

  await expect(page.locator('.ayah-name')).toContainText('فاطر');
  await expect(page.locator('.ayah-name')).toContainText('٣٠');
  await expect(page.locator('.mark')).not.toHaveCount(0);
  await page.screenshot({ path: 'test-results/shamarly-selected.png' });

  await page.getByRole('button', { name: ar.mushaf.tafsir }).click();
  await expect(page.locator('ion-modal')).toBeVisible();
  await page.screenshot({ path: 'test-results/shamarly-tafsir.png' });
});

test('the Shamarly mushaf reads as text on its own pages, breaking inside ayat as printed', async ({ page }) => {
  await onboard(page);
  // Choose the Shamarly mushaf (as the Mushafs page does).
  await page.evaluate(() => localStorage.setItem('CapacitorStorage.mushafEdition', 'shamarly'));
  await page.goto('/mushaf/1?sp=100');
  const ayat = page.locator('.page-text .ayah');
  await expect(ayat.first()).toBeVisible();
  // Page 100 begins inside al-Ma'idah 83 with «مع الشاهدين», which ends there with its number.
  await expect(ayat.first()).toHaveAttribute('data-ayah', '5:83');
  await expect(ayat.first()).toContainText('مَعَ');
  await expect(ayat.first().locator('.end')).toContainText('83');
  await expect(page.locator('.page-num')).toHaveText('100');
  // The last ayah runs on to page 101: no number yet.
  await expect(ayat.last().locator('.end')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/shamarly-text.png' });

  // Marks and tafsir work as in the Madinah mushaf.
  await ayat.first().click();
  await page.getByRole('button', { name: ar.mushaf.tafsir }).click();
  await expect(page.locator('ion-modal')).toBeVisible();
});
