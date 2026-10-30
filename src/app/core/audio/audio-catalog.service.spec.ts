import { readFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { AudioCatalogService, Moshaf } from './audio-catalog.service';
import { AudioFocusService } from './audio-focus.service';
import { RECITERS } from '../quran/recitation.service';

const moshaf = (suras: string): Moshaf => ({ id: 1, ar: '', en: '', rewaya: 1, server: 'https://cdn.mp3quran.net/audio/x/', suras });

describe('AudioCatalogService', () => {
  const catalog = () => TestBed.inject(AudioCatalogService);

  it('lists all 114 suras for a complete recording and the recorded ones, in order, otherwise', () => {
    expect(catalog().suras(moshaf(''))).toEqual(Array.from({ length: 114 }, (_, i) => i + 1));
    expect(catalog().suras(moshaf('114,1,36,2'))).toEqual([1, 2, 36, 114]);
  });

  it('finds reciters ignoring hamza and tashkeel, and by Latin name in any case', () => {
    expect(catalog().matches('ابراهيم', 'إبراهيم الأخضر', 'Ibrahim Al-Akdar')).toBe(true);
    expect(catalog().matches('akdar', 'إبراهيم الأخضر', 'Ibrahim Al-Akdar')).toBe(true);
    expect(catalog().matches('سديس', 'إبراهيم الأخضر', 'Ibrahim Al-Akdar')).toBe(false);
    expect(catalog().matches('  ', 'anything')).toBe(true);
  });
});

describe('bundled audio catalogue', () => {
  const data = JSON.parse(readFileSync('public/assets/audio/catalog.json', 'utf8')) as {
    reciters: { id: number; ar: string; en: string; moshaf: Moshaf[] }[];
    radios: { id: number; url: string }[];
  };

  it('has hundreds of reciters and radios, all over https (the app allows no cleartext)', () => {
    expect(data.reciters.length).toBeGreaterThan(150);
    expect(data.radios.length).toBeGreaterThan(100);
    for (const r of data.reciters) for (const m of r.moshaf) expect(m.server).toMatch(/^https:\/\/[a-z0-9.]+\.mp3quran\.net\/.+\/$/);
    for (const r of data.radios) expect(r.url).toMatch(/^https:\/\/backup\.qurango\.net\//);
  });

  it('has hosts the page CSP lets play', () => {
    const csp = readFileSync('src/index.html', 'utf8');
    expect(csp).toContain('https://*.mp3quran.net');
    expect(csp).toContain('https://backup.qurango.net');
    expect(csp).toContain('https://www.mp3quran.net');
    expect(csp).toContain('https://dorar.net');
  });
});

describe('verse-by-verse reciters', () => {
  it('have unique EveryAyah folders and names in Arabic and English', () => {
    expect(new Set(RECITERS.map((r) => r.id)).size).toBe(RECITERS.length);
    expect(RECITERS.length).toBeGreaterThanOrEqual(40);
    for (const r of RECITERS) expect(r.nameAr && r.nameEn).toBeTruthy();
  });
});

describe('AudioFocusService', () => {
  it('stops the previous player when another starts, not when the same one plays on', () => {
    const focus = TestBed.inject(AudioFocusService);
    const stops: string[] = [];
    focus.claim('mushaf', () => stops.push('mushaf'));
    focus.claim('mushaf', () => stops.push('mushaf'));
    expect(stops).toEqual([]);
    focus.claim('listen', () => stops.push('listen'));
    expect(stops).toEqual(['mushaf']);
    focus.claim('mushaf', () => stops.push('mushaf'));
    expect(stops).toEqual(['mushaf', 'listen']);
  });
});
