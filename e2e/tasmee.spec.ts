import { test, expect, chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ar from '../public/assets/i18n/ar.json';

// The real thing: al-Fatihah recited by Mahmoud Khalil Al-Husary (everyayah.com) is played into Chrome's fake microphone, and
// the offline Quran model (downloaded from Hugging Face, 36 MB) must follow it word by word, also with the noise of a
// room mixed in. Needs the network; slow.
// Kept outside test-results, which Playwright empties at the start of every run.
const WAV = join(tmpdir(), 'al-uns-billah-fatiha-husary.wav');
/** The same recitation with ayah 4 («مالك يوم الدين») left out: a skipped ayah to catch. */
const WAV_SKIP = join(tmpdir(), 'al-uns-billah-fatiha-husary-no4.wav');
/** The full recitation, quieter, through a phone-like band and with room noise at about 10 dB below the voice. */
const WAV_NOISY = join(tmpdir(), 'al-uns-billah-fatiha-husary-noisy.wav');
const BASE = 'http://localhost:4321';

function makeNoisy(src: string, dst: string): void {
  if (existsSync(dst)) return;
  const b = readFileSync(src);
  const n = (b.length - 44) / 2;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + 2 * i) / 32768;
  let power = 0;
  for (const v of x) power += v * v;
  power /= n;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const amp = Math.sqrt(power / 10);
  let brown = 0;
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    hp = 0.96 * (hp + x[i] - prev); // a small phone speaker / microphone: little bass
    prev = x[i];
    brown = 0.98 * brown + 0.2 * rnd();
    const hum = 0.3 * Math.sin((2 * Math.PI * 100 * i) / 48000);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, 0.5 * (hp + amp * (0.7 * rnd() + 0.9 * brown + hum)))) * 0x7fff), 44 + 2 * i);
  }
  writeFileSync(dst, b);
}

async function openTasmee(wav: string) {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
  });
  const page = await browser.newPage({ locale: 'ar', viewport: { width: 412, height: 915 } });
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning' || m.text().includes('tasmee')) && console.log('console:', m.type(), m.text().slice(0, 300)));
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  // The old link: now the Hifz page's tasmee' tab.
  await page.goto(BASE + '/tasmee?sura=1&from=1&to=7');
  await expect(page).toHaveURL(/\/hifz\?.*tab=tasmee/);
  await page.locator('ion-segment-button[value=offline]').click();
  // A new browser profile: the model downloads again (the cache is per profile).
  await page.getByRole('button', { name: ar.tasmee.download }).click();
  await expect(page.getByText(ar.tasmee.offlineReady)).toBeVisible({ timeout: 300_000 });
  return { browser, page };
}

test.describe.configure({ mode: 'serial', timeout: 600_000 });

async function makeWav(path: string, ayat: number[]): Promise<void> {
  if (existsSync(path)) return;
  const parts: string[] = [];
  for (const aya of ayat) {
    const res = await fetch(`https://everyayah.com/data/Husary_128kbps/001${String(aya).padStart(3, '0')}.mp3`);
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
  makeNoisy(WAV, WAV_NOISY);
});

for (const [name, wav] of [['clean', WAV], ['noisy', WAV_NOISY]] as const) {
  test(`tasmee with the offline Quran AI follows al-Fatihah (${name}) and finds no mistakes`, async () => {
    const { browser, page } = await openTasmee(wav);
    await page.getByRole('button', { name: ar.tasmee.start }).click();
    // Live words while reciting, and the microphone meter.
    await expect(page.locator('.meter')).toBeVisible();
    // It finishes by itself when the last word is recited.
    await expect(page.locator('.summary .score')).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: `test-results/tasmee-fatiha-${name}.png`, fullPage: true });
    const pct = Number((await page.locator('.summary .score').textContent())!.replace('%', ''));
    console.log('tasmee', name, 'score', pct);
    expect(pct).toBeGreaterThanOrEqual(95);
    await browser.close();
  });
}

test('tasmee stops at a skipped ayah and shows the right words', async () => {
  const { browser, page } = await openTasmee(WAV_SKIP);
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
