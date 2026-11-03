import { test, expect, Page } from '@playwright/test';
import ar from '../public/assets/i18n/ar.json';

// Chrome's fake microphone (a beep) and camera (a moving test picture), granted without a prompt.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

async function onboard(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test('records a recitation with noise removal, then plays the enhanced and original sound', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await onboard(page);
  await page.goto('/studio');
  await page.getByRole('button', { name: ar.studio.openMic }).click();
  await expect(page.getByRole('meter')).toBeVisible();
  // The strong (AI) model loads; no fallback note.
  await expect(page.getByText(ar.studio.strongUnavailable)).toHaveCount(0);

  await page.getByRole('button', { name: ar.studio.record }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: ar.studio.stop }).click();

  const review = page.locator('section.review');
  await expect(review).toBeVisible();
  await expect(review.locator('audio')).toHaveAttribute('src', /blob:/);
  await expect.poll(() => review.locator('audio').evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 10_000 }).toBeGreaterThan(0);
  await review.locator('ion-segment-button[value=raw]').click();
  await expect(review.locator('audio')).toHaveAttribute('src', /blob:/);
  await expect(page.locator('button.row')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('records a video with the ayah shown over the picture', async ({ page }) => {
  await onboard(page);
  await page.goto('/studio');
  await page.locator('ion-segment-button[value=video]').click();
  // Al-Fatihah, to show its ayat on the video.
  await page.locator('section.ayat ion-select').first().click();
  await page.locator('.action-sheet-button', { hasText: 'الفاتحة' }).first().click();
  await page.getByRole('button', { name: ar.studio.openCamera }).click();
  await expect(page.locator('.preview canvas')).toBeVisible();
  await page.getByRole('button', { name: ar.studio.record }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: ar.studio.nextAyah }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/studio-video-recording.png' });
  await page.getByRole('button', { name: ar.studio.stop }).click();
  const video = page.locator('section.review video');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(720);
});
