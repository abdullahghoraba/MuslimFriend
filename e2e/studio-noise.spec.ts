import { test, expect, chromium } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ar from '../public/assets/i18n/ar.json';

// Measures the studio's noise removal: a recitation with room noise mixed in (made by tasmee.spec.ts) is the
// microphone; the enhanced recording must have far less noise between the ayat than the original, relative to the
// voice (signal-to-noise ratio of the 90th / 10th percentile of 50 ms loudness).
// STUDIO_WAV: another microphone file (e.g. phone recordings with real room noise).
const WAV_NOISY = process.env.STUDIO_WAV ?? join(tmpdir(), 'muslim-friend-fatiha-husary-noisy.wav');
const BASE = 'http://localhost:4321';

test.describe.configure({ timeout: 180_000 });

test('the strong noise removal lowers the noise between the ayat by a lot', async () => {
  test.skip(!existsSync(WAV_NOISY), 'run tasmee.spec.ts first (it makes the noisy recitation)');
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV_NOISY}`],
  });
  const page = await browser.newPage({ locale: 'ar', bypassCSP: true });
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  await page.goto(BASE + '/studio');
  // DENOISE=light: measure the lighter noise removal instead.
  if (process.env.DENOISE) await page.locator('section.settings ion-segment').first().locator('ion-segment-button').nth(process.env.DENOISE === 'off' ? 0 : 1).click();
  await page.getByRole('button', { name: ar.studio.openMic }).click();
  await expect(page.getByRole('meter')).toBeVisible();
  await page.getByRole('button', { name: ar.studio.record }).click();
  await page.waitForTimeout(22_000);
  await page.getByRole('button', { name: ar.studio.stop }).click();
  const review = page.locator('section.review');
  await expect(review.locator('audio')).toHaveAttribute('src', /blob:/);

  const snr = () =>
    review.locator('audio').evaluate(async (a: HTMLAudioElement) => {
      const buf = await (await fetch(a.src)).arrayBuffer();
      const audio = await new AudioContext().decodeAudioData(buf);
      const x = audio.getChannelData(0);
      const win = Math.round(audio.sampleRate * 0.05);
      const rms: number[] = [];
      // Skip the first 1.5 s (the chain settling) and the last 0.5 s.
      for (let i = Math.round(audio.sampleRate * 1.5); i + win < x.length - audio.sampleRate * 0.5; i += win) {
        let s = 0;
        for (let j = i; j < i + win; j++) s += x[j] * x[j];
        rms.push(Math.sqrt(s / win) + 1e-9);
      }
      const series = rms.map((v) => Math.round(20 * Math.log10(v)));
      rms.sort((p, q) => p - q);
      const at = (f: number) => rms[Math.floor(rms.length * f)];
      return { series, snr: 20 * Math.log10(at(0.9) / at(0.1)), voice: 20 * Math.log10(at(0.9)), noise: 20 * Math.log10(at(0.1)) };
    });
  const save = async (name: string) => {
    if (!process.env.SAVE_DIR) return;
    const b64 = await review.locator('audio').evaluate(async (a: HTMLAudioElement) => {
      const bytes = new Uint8Array(await (await fetch(a.src)).arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    });
    writeFileSync(join(process.env.SAVE_DIR, name), Buffer.from(b64, 'base64'));
  };
  const enhanced = await snr();
  await save('enhanced.webm');
  await review.locator('ion-segment-button[value=raw]').click();
  await expect.poll(() => review.locator('audio').getAttribute('src')).toMatch(/blob:/);
  await page.waitForTimeout(500);
  const raw = await snr();
  await save('raw.webm');
  if (process.env.SAVE_DIR) writeFileSync(join(process.env.SAVE_DIR, 'levels.json'), JSON.stringify({ raw: raw.series, enhanced: enhanced.series }));
  const brief = (x: typeof raw) => ({ snr: +x.snr.toFixed(1), voice: +x.voice.toFixed(1), noise: +x.noise.toFixed(1) });
  console.log('raw', JSON.stringify(brief(raw)), 'enhanced', JSON.stringify(brief(enhanced)), 'gain dB', (enhanced.snr - raw.snr).toFixed(1));
  expect(enhanced.snr - raw.snr).toBeGreaterThan(20);
  await browser.close();
});

test('the noise removal works as well while recording a video', async () => {
  test.skip(!existsSync(WAV_NOISY), 'run tasmee.spec.ts first (it makes the noisy recitation)');
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV_NOISY}`],
  });
  const page = await browser.newPage({ locale: 'ar', bypassCSP: true });
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  await page.goto(BASE + '/studio');
  await page.locator('ion-segment-button[value=video]').click();
  await page.getByRole('button', { name: ar.studio.openCamera }).click();
  await expect(page.locator('.preview canvas')).toBeVisible();
  await page.getByRole('button', { name: ar.studio.record }).click();
  await page.waitForTimeout(22_000);
  await page.getByRole('button', { name: ar.studio.stop }).click();
  const video = page.locator('section.review video');
  await expect(video).toHaveAttribute('src', /blob:/);
  const m = await video.evaluate(async (v: HTMLVideoElement) => {
    const audio = await new AudioContext().decodeAudioData(await (await fetch(v.src)).arrayBuffer());
    const x = audio.getChannelData(0);
    const win = Math.round(audio.sampleRate * 0.05);
    const rms: number[] = [];
    for (let i = Math.round(audio.sampleRate * 1.5); i + win < x.length - audio.sampleRate * 0.5; i += win) {
      let s = 0;
      for (let j = i; j < i + win; j++) s += x[j] * x[j];
      rms.push(Math.sqrt(s / win) + 1e-9);
    }
    rms.sort((p, q) => p - q);
    const at = (f: number) => rms[Math.floor(rms.length * f)];
    return { snr: 20 * Math.log10(at(0.9) / at(0.1)), noise: 20 * Math.log10(at(0.1)), seconds: audio.duration };
  });
  console.log('video', JSON.stringify({ snr: +m.snr.toFixed(1), noise: +m.noise.toFixed(1), seconds: +m.seconds.toFixed(1) }));
  expect(m.snr).toBeGreaterThan(45);
  await browser.close();
});
