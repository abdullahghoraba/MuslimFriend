import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Preferences } from '@capacitor/preferences';
import { DatabaseService, SqlDb } from '../db/database.service';
import { createFakeDb, StatementRecordingDb } from '../../testing/fake-sql-db';
import { BackupError, BackupFile, BackupService } from './backup.service';
import { SettingsService } from './settings.service';

vi.mock('@capacitor/preferences', () => {
  const values = new Map<string, string>();
  return {
    Preferences: {
      keys: async () => ({ keys: [...values.keys()] }),
      get: async ({ key }: { key: string }) => ({ value: values.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => {
        values.set(key, value);
      },
      clear: async () => {
        values.clear();
      },
    },
  };
});

describe('BackupService', () => {
  let db: SqlDb;
  let service: BackupService;
  let original: BackupFile;
  beforeEach(async () => {
    await Preferences.clear();
    db = await createFakeDb();
    expect(db).not.toBeInstanceOf(StatementRecordingDb);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), { provide: DatabaseService, useValue: db }],
    });
    service = TestBed.inject(BackupService);
    service.useDb(db);
    await db.batch([
      {
        sql: "INSERT INTO user_category VALUES ('col-test', 'الرقية الشرعية', 'book-outline', 0, 2, 123)",
      },
      { sql: "INSERT INTO home_hidden VALUES ('morning')" },
      {
        sql: "INSERT INTO athkar (id, category_id, text_ar, sort_order) VALUES ('builtin', 'morning', 'ذكر', 9)",
      },
      {
        sql: "INSERT INTO athkar (id, category_id, text_ar, repeat_count, is_custom) VALUES ('custom', 'col-test', 'سُبْحَانَ اللَّهِ', 3, 1)",
      },
      { sql: "INSERT INTO dhikr_daily VALUES ('2026-10-20', 'custom', 'app', 2)" },
      { sql: "INSERT INTO category_daily VALUES ('2026-10-20', 'morning', 123)" },
      { sql: "INSERT INTO tasbih_counter VALUES (4, 'تسبيح', 33, 7, 0, 123)" },
      { sql: "INSERT INTO tasbih_daily VALUES ('2026-10-20', 4, 7)" },
      { sql: "INSERT INTO quran_bookmark VALUES (1, 'موضعي', 'green', 2, 1, 2, 123)" },
      { sql: "INSERT INTO quran_mark VALUES (2, 1, 'highlight', 'gold', 'تدبر', NULL, 123)" },
      { sql: "INSERT INTO quran_mark VALUES (2, 1, 'note', NULL, NULL, 'ملاحظة', 123)" },
      { sql: "INSERT INTO khatmah VALUES (1, 'ختمة', 1, 30, '2026-10-20', 21, NULL, 123)" },
      { sql: "INSERT INTO quran_reading_log VALUES ('2026-10-20', 21)" },
    ]);
    await TestBed.inject(SettingsService).update({ language: 'en', fontScale: 1.2 });
    await Preferences.set({ key: 'overlay', value: '{"enabled":true}' });
    original = await service.buildBackup();
  });

  it('round trips hifz plans, tracked ayahs and activity, and accepts older backups', async () => {
    await db.batch([
      { sql: "INSERT INTO hifz_plan VALUES (1,'حفظ','green',1,1,2,286,5,1,123,0)" },
      {
        sql: "INSERT INTO hifz_ayah VALUES (1,1,1,'memorized','2026-10-20',NULL,'2026-10-21',0,0)",
      },
      { sql: "INSERT INTO hifz_log VALUES ('2026-10-20',1,'new',1)" },
    ]);
    const backup = await service.buildBackup();
    expect(backup.data.hifzPlans).toHaveLength(1);
    await service.restore(backup);
    expect((await service.buildBackup()).data).toEqual(backup.data);
    const bad = structuredClone(backup);
    bad.data.hifzAyahs![0]['status'] = 'invalid';
    await expect(service.restore(bad)).rejects.toBeInstanceOf(BackupError);
    expect((await service.buildBackup()).data).toEqual(backup.data);
    delete backup.data.hifzPlans;
    delete backup.data.hifzAyahs;
    delete backup.data.hifzLogs;
    await service.restore(backup);
    expect((await service.buildBackup()).data.hifzPlans).toEqual([]);
    expect(await db.query('SELECT * FROM hifz_ayah')).toEqual([]);
    expect(await db.query('SELECT * FROM hifz_log')).toEqual([]);
  });

  it('round trips hadith bookmarks and notes, validates before deletion, and accepts older backups', async () => {
    await db.run('INSERT INTO hadith_bookmark VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ['bukhari', '1.01', 1, 'ملاحظة عن النية', 123, 'إنما الأعمال بالنيات', 'Actions are by intentions', 'صحيح البخاري']);
    const backup = await service.buildBackup();
    expect(backup.data.hadithBookmarks).toHaveLength(1);
    await db.run('DELETE FROM hadith_bookmark');
    await service.restore(backup);
    expect((await service.buildBackup()).data.hadithBookmarks).toEqual(backup.data.hadithBookmarks);
    const bad = structuredClone(backup); bad.data.hadithBookmarks![0]['number'] = '../invalid';
    await expect(service.restore(bad)).rejects.toBeInstanceOf(BackupError);
    expect((await service.buildBackup()).data.hadithBookmarks).toEqual(backup.data.hadithBookmarks);
    delete backup.data.hadithBookmarks;
    await service.restore(backup);
    expect((await service.buildBackup()).data.hadithBookmarks).toEqual([]);
  });

  it('round trips overrides and accepts older backups without them', async () => {
    await db.run('UPDATE athkar SET repeat_override = 7 WHERE id = ?', ['builtin']);
    const backup = await service.buildBackup();
    expect(backup.data.repeatOverrides).toEqual([{ id: 'builtin', repeat_override: 7 }]);
    await db.run('UPDATE athkar SET repeat_override = NULL');
    await service.restore(backup);
    expect(await db.query('SELECT repeat_override FROM athkar WHERE id = ?', ['builtin'])).toEqual([{ repeat_override: 7 }]);
    backup.data.repeatOverrides![0]['repeat_override'] = 10001;
    await expect(service.restore(backup)).rejects.toBeInstanceOf(BackupError);
    delete backup.data.repeatOverrides;
    await service.restore(backup);
    expect(await db.query('SELECT repeat_override FROM athkar WHERE id = ?', ['builtin'])).toEqual([{ repeat_override: null }]);
  });

  it('round trips hidden built-ins and accepts backups without hidden state', async () => {
    await db.run('UPDATE athkar SET hidden = 1 WHERE id = ?', ['builtin']);
    const backup = await service.buildBackup();
    await db.run('UPDATE athkar SET hidden = 0');
    await service.restore(backup);
    expect(await db.query('SELECT hidden FROM athkar WHERE id = ?', ['builtin'])).toEqual([{ hidden: 1 }]);
    delete backup.data.hiddenIds;
    await service.restore(backup);
    expect(await db.query('SELECT hidden FROM athkar WHERE id = ?', ['builtin'])).toEqual([{ hidden: 0 }]);
  });

  it('round trips all user tables, settings and extra preferences', async () => {
    await db.batch([
      ...[
        'user_category',
        'home_hidden',
        'dhikr_daily',
        'category_daily',
        'tasbih_daily',
        'tasbih_counter',
        'quran_bookmark',
        'quran_mark',
        'khatmah',
        'quran_reading_log',
      ].map((table) => ({ sql: 'DELETE FROM ' + table })),
      { sql: 'DELETE FROM athkar WHERE is_custom = 1' },
      { sql: 'UPDATE athkar SET sort_order = 0' },
    ]);
    await Preferences.set({ key: 'stale', value: 'remove me' });
    await service.restore(JSON.parse(JSON.stringify(original)));
    const restored = await service.buildBackup();
    expect(restored.data).toEqual(original.data);
    expect(restored.settings).toEqual(original.settings);
    expect(restored.extraPreferences).toEqual(original.extraPreferences);
    expect(original.extraPreferences).not.toHaveProperty('settings');
  });

  it.each([
    ['app', 'other', 'app'],
    ['formatVersion', 2, 'version'],
  ])('rejects incorrect %s', async (field, value, code) => {
    await expect(service.restore({ ...original, [field]: value })).rejects.toMatchObject({ code });
  });

  it.each([
    { ...{ repeat_count: 0 } },
    { repeat_count: 10001 },
    { repeat_count: '3' },
    { is_custom: 0 },
    { created_at: -1 },
  ])('rejects malformed custom row %j without changing data', async (patch) => {
    const file = structuredClone(original);
    Object.assign(file.data.customAthkar[0], patch);
    await expect(service.restore(file)).rejects.toBeInstanceOf(BackupError);
    expect((await service.buildBackup()).data).toEqual(original.data);
  });

  it('rejects malformed arrays, dates, settings and preferences', async () => {
    const files: unknown[] = [
      null,
      { ...original, data: [] },
      { ...original, settings: { ...original.settings, haptics: 'yes' } },
      { ...original, extraPreferences: { settings: '{}' } },
      {
        ...original,
        data: {
          ...original.data,
          dhikrDaily: [{ ...original.data.dhikrDaily[0], date: '20/10/2026' }],
        },
      },
    ];
    for (const file of files)
      await expect(service.restore(file)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('rolls back deletes and inserts if a validly typed row causes a SQL constraint failure', async () => {
    const file = structuredClone(original);
    file.data.customAthkar.push({ ...file.data.customAthkar[0], id: 'builtin' });
    await expect(service.restore(file)).rejects.toThrow();
    expect((await service.buildBackup()).data).toEqual(original.data);
    expect((await service.buildBackup()).extraPreferences).toEqual(original.extraPreferences);
  });

  it('ignores unknown and custom ids in builtin userOrder', async () => {
    const file = structuredClone(original);
    file.data.userOrder.push(
      { id: 'unknown', sort_order: 88, include_in_overlay: 0 },
      { id: 'custom', sort_order: 99, include_in_overlay: 0 },
    );
    await service.restore(file);
    expect((await service.buildBackup()).data).toEqual(original.data);
  });

  it('restores legacy formatVersion 1 without the optional Quran arrays', async () => {
    const old = structuredClone(original);
    delete old.data.userCategories;
    delete old.data.homeHidden;
    delete old.data.quranBookmarks;
    delete old.data.quranMarks;
    delete old.data.khatmah;
    delete old.data.quranReadingLog;
    await service.restore(old);
    const restored = await service.buildBackup();
    expect(restored.data.userCategories).toEqual([]);
    expect(restored.data.homeHidden).toEqual([]);
    expect(restored.data.quranBookmarks).toEqual([]);
    expect(restored.data.quranMarks).toEqual([]);
    expect(restored.data.khatmah).toEqual([]);
    expect(restored.data.quranReadingLog).toEqual([]);
  });
  it('rejects malformed new arrays without deleting existing data', async () => {
    const bad = structuredClone(original);
    bad.data.quranReadingLog = [{ date: '2026-10-20', page: 605 }];
    await expect(service.restore(bad)).rejects.toBeInstanceOf(BackupError);
    expect((await service.buildBackup()).data).toEqual(original.data);
  });
  it('maps JSON parse errors to invalid', async () => {
    await expect(service.importFromFile({ text: async () => '{' } as File)).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});
