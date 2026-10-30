import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';
import { DatabaseService, SqlDb } from '../db/database.service';
import { BackupError, BackupService } from '../services/backup.service';
import { createFakeDb } from '../../testing/fake-sql-db';
import { HadithBookmarksService } from './hadith-bookmarks.service';
import { Hadith } from './hadith.models';

vi.mock('@capacitor/preferences', () => {
  const values = new Map<string, string>();
  return { Preferences: {
    keys: async () => ({ keys: [...values.keys()] }),
    get: async ({ key }: { key: string }) => ({ value: values.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { values.set(key, value); },
    clear: async () => { values.clear(); },
  } };
});

describe('Hadith personal data', () => {
  let db: SqlDb;
  let marks: HadithBookmarksService;
  let backup: BackupService;
  const position: Hadith = {
    collection: 'bukhari', number: '12.1', book: 1, arabic: 'إنما الأعمال بالنيات', translation: 'Actions are by intentions',
    translationLang: 'en', grades: [], bookName: '', bookHadith: 1, arabicNumber: '12.1', authenticitySource: 'صحيح البخاري',
  };

  beforeEach(async () => {
    await Preferences.clear();
    db = await createFakeDb();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), { provide: DatabaseService, useValue: db }] });
    marks = TestBed.inject(HadithBookmarksService);
    backup = TestBed.inject(BackupService);
    backup.useDb(db);
  });

  it('persists one bookmark per source identifier, edits its note and remembers the reading position', async () => {
    await marks.save(position, 'First note');
    await marks.save(position, 'ملاحظة');
    await marks.remember(position);
    await marks.load();
    expect(marks.bookmarks()).toHaveLength(1);
    expect(marks.saved(position)?.note).toBe('ملاحظة');
    expect(marks.lastRead()).toEqual({ collection: 'bukhari', number: '12.1', book: 1 });
    await marks.remove(position);
    expect(marks.bookmarks()).toEqual([]);
  });

  it('keeps the text of a saved hadith, so the list reads without the book downloaded', async () => {
    await marks.save(position);
    expect(marks.saved(position)).toMatchObject({ arabic: 'إنما الأعمال بالنيات', translation: 'Actions are by intentions', source: 'صحيح البخاري' });
  });

  it('round trips bookmarks and notes with the existing backup format', async () => {
    await marks.save(position, 'Remember this');
    const file = await backup.buildBackup();
    await marks.remove(position);
    await backup.restore(file);
    await marks.load();
    expect(marks.bookmarks()).toEqual(file.data.hadithBookmarks);
    expect(marks.saved(position)?.note).toBe('Remember this');
  });

  it('rejects malformed bookmark references before changing any saved data', async () => {
    await marks.save(position, 'Keep me');
    const file = await backup.buildBackup();
    file.data.hadithBookmarks![0]['number'] = '../invalid';
    await expect(backup.restore(file)).rejects.toBeInstanceOf(BackupError);
    await marks.load();
    expect(marks.saved(position)?.note).toBe('Keep me');
  });

  it('accepts older backups without a hadith table', async () => {
    await marks.save(position);
    const file = await backup.buildBackup();
    delete file.data.hadithBookmarks;
    await backup.restore(file);
    expect(await db.query('SELECT * FROM hadith_bookmark')).toEqual([]);
  });
});
