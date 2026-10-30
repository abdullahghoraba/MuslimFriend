import { TestBed } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';
import { HadeethEncService, encHadith } from './hadeethenc.service';
import { HadithStorage } from './hadith-storage.service';
import { dorarHadith } from './dorar.service';

describe('Encyclopedia of Translated Hadiths (HadeethEnc)', () => {
  const disk = new Map<string, unknown>();
  const storage = { read: async (k: string) => disk.get(k) ?? null, write: async (k: string, v: unknown) => { disk.set(k, v); } };
  const roots = [{ id: '3', title: 'Creed', hadeeths_count: '5', parent_id: null }, { id: '5', title: 'Virtues', hadeeths_count: '7', parent_id: null }, { id: '9', title: 'Sub', hadeeths_count: '2', parent_id: '5' }];
  const one = (id: string) => ({ id, title: 'T' + id, hadeeth: 'Text ' + id, attribution: 'Agreed upon', grade: 'Authentic', explanation: 'E', hints: ['a\r', ''], hadeeth_ar: 'نص ' + id, attribution_ar: 'متفق عليه', grade_ar: 'صحيح' });
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/categories/list/')) return Response.json(roots);
    const page = Number(/page=(\d+)/.exec(url)?.[1]);
    const cat = /category_id=(\d+)/.exec(url)?.[1];
    const per = Number(/per_page=(\d+)/.exec(url)?.[1]);
    if (url.includes('/hadeeths/list/')) return Response.json({ data: Array.from({ length: per }, (_, i) => ({ id: `${cat}-${(page - 1) * per + i}`, title: '' })), meta: { last_page: 9, total_items: 90 } });
    return Response.json(one(/id=([\w-]+)/.exec(url)![1]));
  });
  beforeEach(async () => {
    disk.clear(); fetcher.mockClear(); await Preferences.clear();
    vi.stubGlobal('fetch', fetcher);
    TestBed.configureTestingModule({ providers: [{ provide: HadithStorage, useValue: storage }] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('gives a different hadith each day in the reader\'s language, with Arabic, grade and lessons', async () => {
    const enc = TestBed.inject(HadeethEncService);
    const ids = new Set<string>();
    for (let d = 1; d <= 12; d++) {
      const h = await enc.daily(new Date(2026, 9, d), 'de');
      expect(h.arabic).toMatch(/^نص /);
      expect(h.hints).toEqual(['a']);
      ids.add(h.id);
    }
    // 12 hadith in the top topics (the subtopic's are inside its parent's count): all 12 days differ.
    expect(ids.size).toBe(12);
  });

  it('asks the network once a day and keeps each opened hadith for reading offline', async () => {
    const enc = TestBed.inject(HadeethEncService);
    const first = await enc.daily(new Date(2026, 9, 1), 'de');
    const calls = fetcher.mock.calls.length;
    expect((await enc.daily(new Date(2026, 9, 1, 22), 'de')).id).toBe(first.id);
    expect(fetcher.mock.calls.length).toBe(calls);
    fetcher.mockRejectedValueOnce(new Error('offline'));
    expect((await enc.one('de', first.id)).text).toBe(first.text);
  });

  it('shows as a hadith card with the Arabic grade and source', () => {
    const card = encHadith({ id: '7', lang: 'de', title: 'T', text: 'Text', arabic: 'نص', grade: 'Authentisch', gradeAr: 'صحيح', attribution: 'B', attributionAr: 'رواه البخاري', explanation: '', hints: [], wordMeanings: [] });
    expect(card).toMatchObject({ collection: 'enc', number: '7', translation: 'Text', grades: [{ grade: 'صحيح' }], authenticitySource: 'رواه البخاري · صحيح' });
  });
});

describe('Dorar search results', () => {
  it('can be saved: a stable numeric id, the scholar\'s ruling and the book', () => {
    const r = { text: 'إنما الأعمال بالنيات', narrator: 'عمر', scholar: 'الألباني', source: 'غاية المرام', number: '14', ruling: 'صحيح', url: '', score: 0 };
    const a = dorarHadith(r), b = dorarHadith({ ...r });
    expect(a.number).toMatch(/^\d+$/);
    expect(a.number).toBe(b.number);
    expect(a).toMatchObject({ collection: 'dorar', grades: [{ name: 'الألباني', grade: 'صحيح' }], bookName: 'غاية المرام 14', narrator: 'عمر' });
    expect(a.authenticitySource).toContain('الألباني: صحيح');
  });
});
