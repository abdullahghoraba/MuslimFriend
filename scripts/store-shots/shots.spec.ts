import { test, expect, Page, chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The 8 Play Store screenshots of «الأُنس بالله» (Al-Uns Billah), for every listing language: the app in that
 * language at 360x800 (x3), then framed (1080x1920: gold headline over the app's green, the app in a phone).
 * Raw: store-assets/screenshots/raw[/<lang>]/<name>.png; framed: store-assets/screenshots/<listing code>/<nn>-<name>.png.
 * Usage: npx playwright test -c scripts/store-shots   (LANGS=ar,en to limit; SHOTS=mushaf,athkar to limit the screens)
 */
const ROOT = resolve(__dirname, '../..');
const RAW = resolve(ROOT, 'store-assets/screenshots/raw');
const OUT = resolve(ROOT, 'store-assets/screenshots');
const HEADLINES = JSON.parse(readFileSync(resolve(__dirname, 'headlines.json'), 'utf8')) as Record<string, Record<string, [string, string]>>;
/** App language -> Play listing code. */
const LANGS: Record<string, string> = {
  ar: 'ar', en: 'en-US', fr: 'fr-FR', es: 'es-419', de: 'de-DE', pt: 'pt-BR', tr: 'tr-TR', id: 'id', ms: 'ms', ru: 'ru-RU',
  ur: 'ur', fa: 'fa', bn: 'bn-BD', hi: 'hi-IN', zh: 'zh-CN', sw: 'sw',
};
/** The listing order. */
export const ORDER = {
  tasmee: '01', mushaf: '02', studio: '03', shamarly: '04', hifz: '05', tafsir: '06', 'prayer-times': '07', athkar: '08',
} as const;
type Shot = keyof typeof ORDER;
const only = process.env.LANGS?.split(',');
const shots = (process.env.SHOTS?.split(',') ?? Object.keys(ORDER)) as Shot[];

/** Makkah, so the prayer times and qibla look right for everyone. */
const PRAYER = JSON.stringify({
  location: { latitude: 21.4225, longitude: 39.8262, name: 'Makkah', source: 'manual' }, method: 'UmmAlQura', madhab: 'shafi',
  adjustments: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 }, hijriOffset: 0,
});

const rawPath = (lang: string, name: string) => (lang === 'ar' ? resolve(RAW, `${name}.png`) : resolve(RAW, lang, `${name}.png`));

async function setup(page: Page, lang: string, extra: Record<string, string> = {}): Promise<void> {
  await page.goto('/');
  await page.evaluate(([l, ex]) => {
    localStorage.clear();
    localStorage.setItem('CapacitorStorage.settings', JSON.stringify({ language: l, theme: 'light', fontScale: 1, haptics: true, onboardingDone: true }));
    for (const [k, v] of Object.entries(ex)) localStorage.setItem(`CapacitorStorage.${k}`, v);
  }, [lang, { prayerSettings: PRAYER, ...extra }] as const);
}

async function shoot(page: Page, lang: string, name: string): Promise<void> {
  await page.waitForTimeout(900);
  const path = rawPath(lang, name);
  mkdirSync(resolve(path, '..'), { recursive: true });
  await page.screenshot({ path });
}

const capture: Record<Shot, (page: Page, lang: string) => Promise<void>> = {
  // Tasmee': al-Mulk 1-3 recited from memory, one word said wrongly (shown in red with the word heard).
  async tasmee(page, lang) {
    await setup(page, lang);
    await page.goto('/tasmee?sura=67&from=1&to=4');
    await expect(page.locator('.recital .w').first()).toBeAttached();
    await page.evaluate(() => {
      const ng = (window as unknown as { ng: { getComponent(el: Element): Record<string, { set(v: unknown): void } & (() => { text: string }[])> } }).ng;
      const c = ng.getComponent(document.querySelector('app-tasmee')!);
      const words = (c['words'] as unknown as () => { text: string; ref: { aya: number } }[])().filter((w) => w.ref.aya <= 3).map((w) => w.text);
      words[12] = 'وَٱلنَّجَاةَ'; // «والحياة» said wrongly
      c['finals'].set([{ text: words.join(' ') }]);
      c['state'].set('listening');
    });
    await shoot(page, lang, 'tasmee');
  },
  // The Madinah mushaf: the opening of Al Imran (the sura's band, the basmala, 15 printed lines), an ayah tapped.
  async mushaf(page, lang) {
    await setup(page, lang);
    await page.goto('/mushaf/50');
    await expect(page.locator('.madinah-lines.qpc .mushaf-word').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.locator('.mushaf-word[data-ayah="3:2"]').first().click();
    await shoot(page, lang, 'mushaf');
  },
  // Studio: al-Ikhlas on the screen, the microphone on (meter), noise removal and the Haram echo.
  async studio(page, lang) {
    await setup(page, lang, { studioPrefs: JSON.stringify({ kind: 'audio', facing: 'user', denoise: 'strong', reverb: 'haram', captions: true, voiceDb: 0, clarityDb: 3, reverbAmount: 1 }) });
    await page.goto('/studio');
    await expect(page.locator('section.ayat ion-select')).toBeVisible();
    await page.evaluate(() => {
      const ng = (window as unknown as { ng: { getComponent(el: Element): Record<string, (v: unknown) => void> } }).ng;
      ng.getComponent(document.querySelector('app-studio')!)['setSura'](112);
    });
    await page.locator('button.start').click();
    await expect(page.getByRole('meter')).toBeVisible();
    await page.waitForTimeout(1500);
    await shoot(page, lang, 'studio');
  },
  // Shamarly: the printed page with an ayah tapped (tafsir and the other actions below).
  async shamarly(page, lang) {
    await setup(page, lang);
    await page.goto('/mushaf-edition/shamarly/367');
    const scan = page.locator('.scan');
    await expect(scan.locator('img')).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => scan.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 90_000 }).toBeGreaterThan(0);
    const box = (await scan.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * (0.227 + 0.255) / 2);
    await expect(page.locator('.ayah-name')).toBeVisible();
    await shoot(page, lang, 'shamarly');
  },
  // Hifz: the memorisation page.
  async hifz(page, lang) {
    await setup(page, lang);
    await page.goto('/hifz');
    await page.waitForTimeout(2500);
    await shoot(page, lang, 'hifz');
  },
  // Tafsir: Ayat al-Kursi's tafsir opened from the mushaf.
  async tafsir(page, lang) {
    await setup(page, lang);
    await page.goto('/mushaf/42');
    await expect(page.locator('.madinah-lines.qpc .mushaf-word').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.locator('.mushaf-word[data-ayah="2:255"]').first().click();
    await page.locator('button:has(ion-icon[name="book-outline"])').first().click();
    await page.waitForTimeout(2500);
    await shoot(page, lang, 'tafsir');
  },
  // Prayer times for Makkah, with the athan settings.
  async 'prayer-times'(page, lang) {
    await setup(page, lang);
    await page.goto('/athan');
    await page.waitForTimeout(2500);
    await shoot(page, lang, 'prayer-times');
  },
  // Morning athkar with their sources and counters.
  async athkar(page, lang) {
    await setup(page, lang);
    await page.goto('/category/morning');
    await expect(page.locator('[data-index="0"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shoot(page, lang, 'athkar');
  },
};

test('capture the screens in every language', async () => {
  const browser = await chromium.launch({ channel: 'msedge', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  for (const lang of Object.keys(LANGS).filter((l) => !only || only.includes(l))) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, locale: lang, baseURL: 'http://localhost:4321' });
    const page = await ctx.newPage();
    for (const name of shots) await capture[name](page, lang);
    await ctx.close();
  }
  await browser.close();
});

test('frame them for the store', async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const font = (f: string) => `url(data:font/woff2;base64,${readFileSync(resolve(ROOT, 'public/assets/fonts', f)).toString('base64')}) format('woff2')`;
  for (const [lang, code] of Object.entries(LANGS).filter(([l]) => !only || only.includes(l))) {
    for (const name of shots) {
      const [title, sub] = HEADLINES[lang][name];
      const shot = readFileSync(rawPath(lang, name)).toString('base64');
      const rtl = ['ar', 'ur', 'fa'].includes(lang);
      await page.setContent(`<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><style>
        @font-face { font-family: H; src: ${font('Amiri-Bold.woff2')}; }
        @font-face { font-family: S; src: ${font('IBMPlexSansArabic-Regular.woff2')}; }
        html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; }
        body { background: radial-gradient(120% 80% at 50% 18%, #0b5e51 0%, #03483f 52%, #013c3a 100%); font-family: S, 'Noto Sans', sans-serif; }
        .t { position: absolute; top: 108px; left: 60px; right: 60px; text-align: center; color: rgb(232,190,110);
             font-family: H, 'Noto Serif', serif; font-weight: 700; line-height: 1.15; white-space: nowrap; }
        .s { position: absolute; top: 246px; left: 70px; right: 70px; text-align: center; color: #f4f1e8; font-size: 44px; line-height: 1.25; }
        .phone { position: absolute; left: 212px; top: 404px; width: 656px; height: 1416px; background: #0a0f0d; border-radius: 86px; }
        .screen { position: absolute; left: 22px; top: 24px; width: 612px; height: 1368px; border-radius: 64px; overflow: hidden; background: #fbf7ec; }
        .screen img { width: 100%; display: block; }
      </style></head><body>
        <div class="t" id="t">${title}</div><div class="s" id="s">${sub}</div>
        <div class="phone"><div class="screen"><img src="data:image/png;base64,${shot}"></div></div>
      </body></html>`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        // The headline as large as fits on one line (at most 86px); the subtitle on at most two lines.
        const t = document.getElementById('t')!;
        let size = 86;
        t.style.fontSize = `${size}px`;
        while (t.scrollWidth > t.clientWidth && size > 40) t.style.fontSize = `${--size}px`;
        const s = document.getElementById('s')!;
        let ss = 44;
        while (s.scrollHeight > 44 * 1.25 * 2 + 4 && ss > 30) s.style.fontSize = `${--ss}px`;
      });
      mkdirSync(resolve(OUT, code), { recursive: true });
      writeFileSync(resolve(OUT, code, `${ORDER[name]}-${name}.png`), await page.screenshot({ type: 'png' }));
    }
  }
  await browser.close();
});
