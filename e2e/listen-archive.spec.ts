import { test, expect, Page } from '@playwright/test';
import ar from '../public/assets/i18n/ar.json';

// Sheikh Abdel Nasser Harak and Sheikh Ragheb Mustafa Ghalwash: not on mp3quran.net, their tilawat come from archive.org
// (which redirects each file to one of its servers). They are found, listed as mujawwad, and their suras play.

async function onboard(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: ar.onboarding.next, exact: true }).click();
  await page.getByRole('button', { name: ar.onboarding.skip, exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
}

for (const { query, name, sura } of [
  { query: 'حرك', name: 'عبد الناصر حرك', sura: 'الفاتحة' },
  { query: 'ghalwash', name: 'راغب مصطفى غلوش', sura: 'البقرة' },
]) {
  test(`${name}: found in Listen, and a sura plays from archive.org`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|CSP/i.test(m.text())) errors.push(m.text()); });
    // Every Audio the page makes, to read how far it has played.
    await page.addInitScript(() => {
      const made: HTMLAudioElement[] = ((window as unknown as { __audios: HTMLAudioElement[] }).__audios = []);
      const Native = window.Audio;
      window.Audio = function (src?: string) {
        const a = new Native(src);
        made.push(a);
        return a;
      } as unknown as typeof Audio;
    });
    await onboard(page);
    await page.goto('/listen');
    await page.locator('ion-searchbar input').fill(query);
    const row = page.locator('.row', { hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('مجودة');
    await row.locator('button.open').click();

    await expect(page.locator('ion-title', { hasText: name })).toBeVisible();
    await expect(page.locator('.recording-name')).toHaveText('حفص عن عاصم - تلاوات مجودة مختارة');
    const suraRow = page.locator('button.open', { hasText: sura }).first();
    await expect(suraRow).toBeVisible();
    await suraRow.click();

    // The player shows the sura and its time moves on: the MP3 really streams.
    await expect(page.locator('app-listen-player')).toContainText(sura);
    let played = '';
    await expect.poll(async () => {
      const [src, at] = await page.evaluate(() => {
        const a = (window as unknown as { __audios: HTMLAudioElement[] }).__audios.at(-1);
        return [a?.currentSrc ?? '', a?.currentTime ?? 0] as const;
      });
      played = src;
      return at;
    }, { timeout: 45_000 }).toBeGreaterThan(1);
    expect(played).toMatch(/archive\.org\//);
    await expect(page.locator('app-listen-player .error')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('the mujawwad filter lists both sheikhs', async ({ page }) => {
  await onboard(page);
  await page.goto('/listen');
  await page.locator('ion-select.riwayah').nth(1).evaluate((el: HTMLElement & { value: unknown }) => {
    el.value = 'mujawwad';
    el.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'mujawwad' } }));
  });
  await expect(page.locator('.row', { hasText: 'عبد الناصر حرك' })).toHaveCount(1);
  await expect(page.locator('.row', { hasText: 'راغب مصطفى غلوش' })).toHaveCount(1);
});
