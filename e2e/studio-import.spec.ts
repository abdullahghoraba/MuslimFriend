import { test, expect, Page } from '@playwright/test';
import ar from '../public/assets/i18n/ar.json';

// «استيراد من الهاتف»: a video made with the phone's own camera app goes through the studio's sound and picture
// (noise removal, echo, caption, logo, fades) and comes out like a studio recording.

async function onboard(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** A short "phone video" made in the page: a moving landscape picture with a tone, as WebM (no duration stored). */
async function makeClip(page: Page, seconds: number): Promise<Buffer> {
  const b64 = await page.evaluate(async (seconds) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const g = canvas.getContext('2d')!;
    const ctx = new AudioContext();
    const osc = new OscillatorNode(ctx, { frequency: 330 });
    const dest = new MediaStreamAudioDestinationNode(ctx);
    osc.connect(dest);
    osc.start();
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    let t = 0;
    const timer = setInterval(() => {
      g.fillStyle = `hsl(${(t * 12) % 360} 70% 40%)`;
      g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#fff';
      g.fillRect((t * 8) % 600, 150, 40, 40);
      t++;
    }, 33);
    rec.start(250);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    await new Promise<void>((r) => {
      rec.onstop = () => r();
      rec.stop();
    });
    clearInterval(timer);
    osc.stop();
    await ctx.close();
    const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, seconds);
  return Buffer.from(b64, 'base64');
}

test('imports a video from the phone and makes it a studio video, with the ayah over the picture', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await onboard(page);
  await page.goto('/studio');
  const clip = await makeClip(page, 3);

  await page.locator('ion-segment-button[value=video]').first().click();
  // An ayah range, so the caption is drawn over the picture.
  await page.locator('section.ayat ion-select').first().evaluate((el: HTMLElement & { value: unknown }) => {
    el.value = 1;
    el.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 1 } }));
  });

  await expect(page.getByRole('button', { name: ar.studio.importVideo })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'my-recitation.webm', mimeType: 'video/webm', buffer: clip });
  await expect(page.getByText(ar.studio.importHint)).toBeVisible();
  const canvas = page.locator('.preview canvas');
  await expect(canvas).toBeVisible();
  // Portrait, as studio videos are.
  const size = await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(size[1]).toBeGreaterThan(size[0]);

  await page.getByRole('button', { name: ar.studio.importStart }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: ar.studio.nextAyah }).click();

  // Plays to its end, rings out, and saves itself.
  const review = page.locator('section.review');
  await expect(review).toBeVisible({ timeout: 30_000 });
  const video = review.locator('video');
  await expect(video).toHaveAttribute('src', /blob:/);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 10_000 }).toBeGreaterThan(0);
  const out = await video.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight]);
  expect(out[1]).toBeGreaterThan(out[0]);
  await expect(page.locator('button.row')).toHaveCount(1);
  // Back to normal: the camera / import buttons again, no import left open.
  await expect(page.getByRole('button', { name: ar.studio.importVideo })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('imports a video’s sound as a studio recording, and can cancel an import', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await onboard(page);
  await page.goto('/studio');
  const clip = await makeClip(page, 2);

  // Cancel: back to the start buttons.
  await page.locator('input[type=file]').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: clip });
  await expect(page.getByText(ar.studio.importHint)).toBeVisible();
  await page.getByRole('button', { name: ar.studio.importCancel }).click();
  await expect(page.getByRole('button', { name: ar.studio.importAudio })).toBeVisible();

  await page.locator('input[type=file]').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: clip });
  await page.getByRole('button', { name: ar.studio.importStart }).click();
  const review = page.locator('section.review');
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review.locator('audio')).toHaveAttribute('src', /blob:/);
  // No "original" switch: the original is still on the phone.
  await expect(review.locator('ion-segment-button[value=raw]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a file that is not a playable video says so', async ({ page }) => {
  await onboard(page);
  await page.goto('/studio');
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a video') });
  await expect(page.getByText(ar.studio.errors.unreadable)).toBeVisible();
});
