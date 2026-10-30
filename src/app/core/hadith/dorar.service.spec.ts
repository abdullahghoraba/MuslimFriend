import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { DorarService, dorarQuery, nativeHttp, parseDorar } from './dorar.service';
import { HadithStorage } from './hadith-storage.service';
import { Hadith } from './hadith.models';

const text = 'لَا يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لِأَخِيهِ مَا يُحِبُّ لِنَفْسِهِ';
const fixture = (scholar: string, ruling: string, body = text, url = '/h/abc123') => `<div class="hadith">1 - ${body}</div><div class="hadith-info"><span class="info-subtitle">الراوي:</span> أنس بن مالك <span class="info-subtitle">المحدث:</span><b>${scholar}</b> <span class="info-subtitle">المصدر:</span> صحيح الجامع <span class="info-subtitle">الصفحة أو الرقم:</span> 7583 <span class="info-subtitle">خلاصة حكم المحدث:</span> ${ruling}<a href="${url}"></a></div>`;
const hadith: Hadith = { collection: 'nawawi', number: '13', book: 1, arabic: text, translation: '', translationLang: 'en', grades: [], bookName: '', bookHadith: 13, arabicNumber: '13' };

describe('Dorar ruling lookup', () => {
  const cache = new Map<string, unknown>();
  const storage = { read: vi.fn(async (key: string) => cache.get(key) ?? null), write: vi.fn(async (key: string, value: unknown) => { cache.set(key, value); }) };
  beforeEach(() => { cache.clear(); vi.clearAllMocks(); TestBed.configureTestingModule({ providers: [{ provide: HadithStorage, useValue: storage }] }); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('extracts every scholar for the matched text and rejects unrelated hits', () => {
    const html = fixture('الألباني', 'صحيح') + fixture('الترمذي', 'حسن صحيح') + fixture('غيره', 'ضعيف', 'إنما الأعمال بالنيات وإنما لكل امرئ ما نوى');
    const result = parseDorar(html, text);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ narrator: 'أنس بن مالك', scholar: 'الألباني', source: 'صحيح الجامع', number: '7583', ruling: 'صحيح', url: 'https://dorar.net/h/abc123' });
  });
  it('never follows unsafe links or executes source markup', () => {
    const r = parseDorar(fixture('أحمد', 'إسناده ضعيف فيه فلان مجهول', text, 'javascript:alert(1)') + '<script>throw Error()</script>', text);
    expect(r[0].url.startsWith('https://dorar.net/hadith/search?')).toBe(true);
    expect(r[0].ruling).toBe('إسناده ضعيف فيه فلان مجهول');
    expect(parseDorar('<html>Blocked</html>', text)).toEqual([]);
  });
  it('uses matn words after the narration preamble when available', () => {
    expect(dorarQuery(`عن أنس رضي الله عنه عن النبي صلى الله عليه و سلم قال: ${text}`)).toBe('لا يومن احدكم حتي يحب لاخيه ما يحب');
  });
  it('does not access the network for cache reads and preserves a good cache on errors or empty matches', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ahadith: { result: fixture('الألباني', 'صحيح') } })));
    vi.stubGlobal('fetch', fetcher);
    const service = TestBed.inject(DorarService);
    expect(await service.cached(hadith)).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
    await service.lookup(hadith); expect((await service.cached(hadith))?.rulings).toHaveLength(1);
    fetcher.mockResolvedValueOnce(new Response('blocked', { status: 403 }));
    await expect(service.lookup(hadith)).rejects.toThrow();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ahadith: { result: '' } })));
    expect((await service.lookup(hadith)).rulings).toEqual([]);
    expect((await service.cached(hadith))?.rulings).toHaveLength(1);
    expect(await service.cached({ ...hadith, arabic: 'different text' })).toBeNull();
  });
  it('uses CapacitorHttp on native Android, with the URL encoded', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const get = vi.spyOn(nativeHttp, 'get').mockResolvedValue({ status: 200, data: { ahadith: { result: fixture('الألباني', 'صحيح') } }, headers: {}, url: '' });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await TestBed.inject(DorarService).lookup(hadith);
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('skey=%'), responseType: 'json' }));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Dorar search words', () => {
  it('starts at the Prophet\'s words, with or without «قال» after the salutation', () => {
    expect(dorarQuery('عَنْ أَبِي هُرَيْرَةَ رَضِيَ اللهُ عَنْهُ قَالَ: قَالَ رَسُولُ اللهِ صلى الله عليه و سلم مِنْ حُسْنِ إسْلَامِ الْمَرْءِ تَرْكُهُ مَا لَا يَعْنِيهِ'))
      .toBe('من حسن اسلام المرء تركه ما لا يعنيه');
    expect(dorarQuery('عن عمر قال: سمعت رسول الله صلى الله عليه وسلم يقول: إنما الأعمال بالنيات')).toBe('انما الاعمال بالنيات');
  });
});
