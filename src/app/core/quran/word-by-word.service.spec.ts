import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { WordByWordService, parseWords } from './word-by-word.service';

vi.mock('@capacitor/preferences', () => {
  const store = new Map<string, string>();
  return {
    Preferences: {
      get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => void store.set(key, value)),
    },
  };
});

const word = (text: string, meaning: string, audio: string | null = 'wbw/001_002_001.mp3') =>
  ({ char_type_name: 'word', text_uthmani: text, audio_url: audio, translation: { text: meaning }, transliteration: { text: 'al-ḥamdu' } });
const sura1 = {
  verses: [
    { verse_key: '1:1', words: [word('بِسْمِ', 'In (the) name'), { char_type_name: 'end', text_uthmani: '١' }] },
    { verse_key: '1:2', words: [word('ٱلْحَمْدُ', 'All praises and thanks'), word('لِلَّهِ', '(be) to Allah', null)] },
  ],
};

describe('word by word', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps each ayah\'s words in order, without the ayah-number marks', () => {
    const ayat = parseWords(sura1);
    expect(ayat.map((a) => a.length)).toEqual([1, 2]);
    expect(ayat[1]).toEqual([
      { ar: 'ٱلْحَمْدُ', tr: 'al-ḥamdu', meaning: 'All praises and thanks', audio: 'wbw/001_002_001.mp3' },
      { ar: 'لِلَّهِ', tr: 'al-ḥamdu', meaning: '(be) to Allah', audio: '' },
    ]);
  });

  it('asks quran.com once per sura and language, and asks again after a failed try', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('language=ur')) throw new Error('offline');
      return Response.json(sura1);
    });
    vi.stubGlobal('fetch', fetcher);
    const wbw = TestBed.inject(WordByWordService);
    expect((await wbw.ayah(1, 2, 'en')).map((w) => w.meaning)).toEqual(['All praises and thanks', '(be) to Allah']);
    expect((await wbw.ayah(1, 1, 'en'))[0].ar).toBe('بِسْمِ');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('/verses/by_chapter/1?language=en&words=true');
    await expect(wbw.ayah(1, 2, 'ur')).rejects.toThrow('offline');
    await expect(wbw.ayah(1, 2, 'ur')).rejects.toThrow('offline');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('shows meanings in the app language when quran.com has it, otherwise English, until the reader picks one', async () => {
    const wbw = TestBed.inject(WordByWordService);
    await wbw.loadChoice();
    expect(wbw.langFor('ur')).toBe('ur');
    expect(wbw.langFor('ar')).toBe('en');
    expect(wbw.langFor('de')).toBe('en');
    await wbw.choose('id');
    expect(wbw.langFor('ur')).toBe('id');
  });
});
