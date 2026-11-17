import { readFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { AudioCatalogService, Moshaf, moshafStyle } from './audio-catalog.service';
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
    expect(catalog().matches('شريم', 'إبراهيم الأخضر', 'Ibrahim Al-Akdar')).toBe(false);
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
    for (const r of data.reciters) {
      for (const m of r.moshaf) expect(m.server).toMatch(/^https:\/\/([a-z0-9.]+\.mp3quran\.net\/.+|archive\.org\/download\/[a-z0-9-]+)\/$/);
    }
    for (const r of data.radios) expect(r.url).toMatch(/^https:\/\/backup\.qurango\.net\//);
  });

  it('has hosts the page CSP lets play', () => {
    const csp = readFileSync('src/index.html', 'utf8');
    const media = csp.match(/media-src[^;]*/)?.[0];
    const connect = csp.match(/connect-src[^;]*/)?.[0];
    expect(media).toContain('https://*.mp3quran.net');
    expect(media).toContain('https://backup.qurango.net');
    expect(connect).toContain('https://*.mp3quran.net');
    // archive.org answers with a redirect to one of its servers (ia800….us.archive.org, dn7….ca.archive.org).
    for (const src of [media, connect]) {
      expect(src).toContain('https://archive.org');
      expect(src).toContain('https://*.archive.org');
    }
    expect(csp).toContain('https://dorar.net');
  });

  it('has Abdel Nasser Harak and Ragheb Mustafa Ghalwash (archive.org), with ids apart from mp3quran\'s', () => {
    for (const name of ['عبد الناصر حرك', 'راغب مصطفى غلوش']) {
      const r = data.reciters.find((x) => x.ar === name);
      expect(r, name).toBeTruthy();
      expect(r!.moshaf).toHaveLength(1);
      expect(r!.moshaf[0].server).toMatch(/^https:\/\/archive\.org\/download\//);
      expect(r!.moshaf[0].suras.split(',').length).toBeGreaterThan(20);
      expect(r!.id).toBeGreaterThanOrEqual(900000);
    }
    const ids = data.reciters.flatMap((r) => r.moshaf.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(data.reciters.map((r) => r.id)).size).toBe(data.reciters.length);
  });

  it('counts the archive.org tilawat as mujawwad, so the mujawwad filter finds them', () => {
    const r = data.reciters.find((x) => x.ar === 'راغب مصطفى غلوش')!;
    expect(moshafStyle(r.moshaf[0])).toBe('mujawwad');
    expect(moshafStyle({ ar: 'حفص عن عاصم - المصحف المجود' })).toBe('mujawwad');
    expect(moshafStyle({ ar: 'حفص عن عاصم - مرتل' })).toBe('murattal');
    expect(moshafStyle({ ar: 'حفص عن عاصم - المصحف المعلم' })).toBe('muallim');
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
