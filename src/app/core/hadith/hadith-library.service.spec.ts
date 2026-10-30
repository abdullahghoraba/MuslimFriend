import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { HadithLibraryService } from './hadith-library.service';
import { HadithStorage } from './hadith-storage.service';
import { HadithCollection, HadithEdition } from './hadith.models';

describe('HadithLibraryService', () => {
  const catalog: HadithCollection[] = [
    { id: 'nawawi', nameAr: '', nameEn: '', count: 1, sections: [], bundled: true, editions: { ar: 'ara-nawawi', en: 'eng-nawawi' } },
    { id: 'bukhari', nameAr: '', nameEn: '', count: 1, sections: [], bundled: false, editions: { ar: 'ara-bukhari', en: 'eng-bukhari', fr: 'fra-bukhari' } },
  ];
  const edition: HadithEdition = { metadata: { name: '', sections: { '1': 'Book' } }, hadiths: [{ hadithnumber: 1, text: 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ', grades: [], reference: { book: 1, hadith: 1 } }] };
  const disk = new Map<string, unknown>();
  const storage = { keys: async () => [...disk.keys()], read: async (k: string) => disk.get(k) ?? null, write: vi.fn(async (k: string, value: unknown) => { disk.set(k, value); }), remove: async (k: string) => { disk.delete(k); } };
  const fetcher = vi.fn();
  beforeEach(() => {
    disk.clear(); vi.clearAllMocks();
    TestBed.configureTestingModule({ providers: [{ provide: HadithStorage, useValue: storage }] });
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/catalog.json')) return Response.json(catalog);
      if (url.endsWith('/daily.json')) return Response.json([]);
      if (url === 'assets/hadith/nawawi.json') return Response.json({ version: 1, collection: 'nawawi', editions: { ar: edition, en: { ...edition, hadiths: [{ ...edition.hadiths[0], text: 'Actions are by intentions' }] } } });
      return Response.json(edition);
    });
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('opens bundled content and searches without any remote downloads', async () => {
    const service = TestBed.inject(HadithLibraryService); await service.init();
    expect((await service.hadiths('bukhari', 'en'))).toEqual([]);
    expect(await service.search('الاعمال', 'en')).toHaveLength(1);
    expect(await service.search('intentions', 'en')).toHaveLength(1);
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('assets/'))).toBe(true);
  });
  it('downloads requested Arabic, English fallback and user language, then deletes device data', async () => {
    const service = TestBed.inject(HadithLibraryService); await service.init();
    await service.download('bukhari', 'fr');
    expect(fetcher.mock.calls.filter(([u]) => String(u).startsWith('https:'))).toHaveLength(3);
    expect(service.available('bukhari')).toBe(true);
    expect(Object.keys((await service.package('bukhari'))!.editions)).toEqual(['ar', 'en', 'fr']);
    await service.remove('bukhari'); expect(service.available('bukhari')).toBe(false); expect(disk.size).toBe(0);
  });
  it('cancels an in-flight transfer and publishes no partial download', async () => {
    const service = TestBed.inject(HadithLibraryService); await service.init();
    fetcher.mockImplementation((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const download = service.download('bukhari', 'en');
    await vi.waitFor(() => expect(service.progress()).not.toBeNull());
    service.cancelDownload(); expect(await download).toBe('cancelled');
    expect(storage.write).not.toHaveBeenCalled(); expect(service.available('bukhari')).toBe(false); expect(service.progress()).toBeNull();
  });
  it('keeps the previous complete download if an added translation is invalid', async () => {
    const service = TestBed.inject(HadithLibraryService); await service.init(); await service.download('bukhari', 'en');
    const original = disk.get('collection-bukhari');
    fetcher.mockResolvedValueOnce(Response.json({ html: 'invalid' }));
    await expect(service.download('bukhari', 'fr')).rejects.toThrow();
    expect(disk.get('collection-bukhari')).toEqual(original); expect(service.available('bukhari')).toBe(true);
  });
  it('rejects stale search work after cancellation', async () => {
    const service = TestBed.inject(HadithLibraryService); await service.init();
    const controller = new AbortController(); controller.abort();
    await expect(service.search('intentions', 'en', controller.signal)).rejects.toThrow();
  });
});
