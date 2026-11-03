import { test, expect, chromium } from '@playwright/test';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ar from '../public/assets/i18n/ar.json';

// The real thing: al-Fatihah recited by Mishary Alafasy (everyayah.com) is played into Chrome's fake microphone, and
// Tarteel's Whisper (downloaded from Hugging Face, ~80 MB) must follow it word by word. Needs the network; slow.
// Kept outside test-results, which Playwright empties at the start of every run.
const WAV = join(tmpdir(), 'muslim-friend-fatiha-alafasy.wav');
/** The same recitation with ayah 4 («مالك يوم الدين») left out: a skipped ayah to catch. */
const WAV_SKIP = join(tmpdir(), 'muslim-friend-fatiha-alafasy-no4.wav');
const BASE = 'http://localhost:4321';

test.describe.configure({ mode: 'serial', timeout: 600_000 });

async function makeWav(path: string, ayat: number[]): Promise<void> {
  if (existsSync(path)) return;
  const parts: string[] = [];
  for (const aya of ayat) {
    const res = await fetch(`https://everyayah.com/data/Alafasy_128kbps/001${String(aya).padStart(3, '0')}.mp3`);
    expect(res.ok).toBe(true);
    parts.push(Buffer.from(await res.arrayBuffer()).toString('base64'));
  }
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('about:blank');
  // Decode each ayah, put 1.2 s of silence between them, 48 kHz mono 16-bit WAV (what the fake device reads).
  const wav = await page.evaluate(async (b64s: string[]) => {
    const rate = 48000;
    const ctx = new OfflineAudioContext(1, rate, rate);
    const buffers = await Promise.all(b64s.map((b) => ctx.decodeAudioData(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer)));
    const gap = Math.round(rate * 1.2);
    const total = buffers.reduce((n, x) => n + Math.round(x.duration * rate) + gap, gap);
    const off = new OfflineAudioContext(1, total, rate);
    let at = gap / rate;
    for (const x of buffers) {
      const src = off.createBufferSource();
      src.buffer = x;
      src.connect(off.destination);
      src.start(at);
      at += x.duration + gap / rate;
    }
    const pcm = (await off.startRendering()).getChannelData(0);
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
    out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data');
    out.setUint32(40, pcm.length * 2, true);
    pcm.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
    let s = '';
    const bytes = new Uint8Array(out.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, parts);
  writeFileSync(path, Buffer.from(wav, 'base64'));
  await browser.close();
}

test('prepares recitations of al-Fatihah as the microphone', async () => {
  await makeWav(WAV, [1, 2, 3, 4, 5, 6, 7]);
  await makeWav(WAV_SKIP, [1, 2, 3, 5, 6, 7]);
});

test('tasmee with the offline AI follows al-Fatihah and finds no mistakes', async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
  });
  const page = await browser.newPage({ locale: 'ar', viewport: { width: 412, height: 915 } });
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning' || m.text().includes('tasmee')) && console.log('console:', m.type(), m.text().slice(0, 300)));
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  await page.goto(BASE + '/tasmee?sura=1&from=1&to=7');
  await page.locator('ion-segment-button[value=whisper]').click();
  await page.getByRole('button', { name: ar.tasmee.download }).click();
  await expect(page.getByText(ar.tasmee.whisperReady)).toBeVisible({ timeout: 420_000 });

  await page.getByRole('button', { name: ar.tasmee.start }).click();
  // It finishes by itself when the last word is recited.
  await expect(page.locator('.summary .score')).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: 'test-results/tasmee-fatiha.png', fullPage: true });
  const pct = Number((await page.locator('.summary .score').textContent())!.replace('%', ''));
  console.log('tasmee score', pct, 'heard:', await page.locator('.recital').innerText());
  expect(pct).toBeGreaterThanOrEqual(90);
  await browser.close();
});

test('tasmee stops at a skipped ayah and shows the right words', async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${WAV_SKIP}`],
  });
  const page = await browser.newPage({ locale: 'ar', viewport: { width: 412, height: 915 } });
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console:', m.type(), m.text().slice(0, 300)));
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  await page.goto(BASE + '/tasmee?sura=1&from=1&to=7');
  await page.locator('ion-segment-button[value=whisper]').click();
  // A new browser profile: the model downloads again (from the network; the cache is per profile).
  await page.getByRole('button', { name: ar.tasmee.download }).click();
  await expect(page.getByText(ar.tasmee.whisperReady)).toBeVisible({ timeout: 420_000 });
  await page.locator('ion-toggle').nth(1).click(); // stop at a mistake
  await page.getByRole('button', { name: ar.tasmee.start }).click();
  const correction = page.locator('.correction');
  await expect(correction).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: 'test-results/tasmee-correction.png', fullPage: true });
  // The whole skipped ayah: «مالك يوم الدين».
  const right = (await correction.locator('.right').innerText()).trim().split(/\s+/);
  expect(right).toHaveLength(3);
  expect(right[1]).toBe('يَوْمِ');
  await expect(page.locator('.controls')).toHaveCount(0);
  await browser.close();
});
