import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DatabaseService, SqlDb } from '../db/database.service';
import { ContentDataset, CUSTOM_CATEGORY_ID, CustomDhikrInput } from '../models';
import { createFakeDb, StatementRecordingDb } from '../../testing/fake-sql-db';
import { AthkarRepository, clampRepeat } from './athkar.repository';

function dataset(version = 1): ContentDataset {
  return {
    contentVersion: version, quranAttribution: 'Tanzil',
    categories: [{ id: 'morning', icon: 'sunny', nameAr: 'الصباح', nameEn: 'Morning' }],
    items: ['first', 'second', 'third'].map((id, index) => ({
      id, categoryId: 'morning', textAr: 'سُبْحَانَ اللَّهِ ' + id,
      transliteration: 'Subhan Allah', meaningEn: 'Glory be to Allah', repeatCount: index + 1,
      virtueAr: '', virtueEn: '', sourceRef: 'Test source', grade: '', reviewed: false, isQuran: false,
    })),
  };
}
const customInput: CustomDhikrInput = {
  textAr: '  الْحَمْدُ لِلَّهِ  ', meaningEn: '  Praise be to Allah  ', repeatCount: 3, includeInOverlay: false,
};

describe('AthkarRepository', () => {
  let db: SqlDb;
  let repository: AthkarRepository;
  beforeEach(async () => {
    db = await createFakeDb();
    expect(db, 'These behavior tests require real SQLite; see sql.js load diagnostic').not.toBeInstanceOf(StatementRecordingDb);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(), { provide: DatabaseService, useValue: db },
    ] });
    repository = TestBed.inject(AthkarRepository);
    repository.useDb(db);
  });

  it('seeds every item and does no writes for the same content version', async () => {
    const content = dataset();
    await repository.seed(content);
    for (const item of content.items) expect(await repository.byId(item.id)).toMatchObject(item);
    expect(await repository.byCategory('morning')).toHaveLength(3);
    expect(await db.query('SELECT value FROM meta WHERE key = ?', ['contentVersion'])).toEqual([{ value: '1' }]);
    const batch = vi.spyOn(db, 'batch');
    const run = vi.spyOn(db, 'run');
    await repository.seed(content);
    expect(batch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('preserves user order and overlay choices while refreshing bundled text', async () => {
    await repository.seed(dataset());
    await repository.reorder(['third', 'first', 'second']);
    await repository.setIncludeInOverlay('first', false);
    const updated = dataset(2);
    updated.items[0].textAr = 'نَصٌّ مُحَدَّثٌ';
    await repository.seed(updated);
    expect((await repository.byCategory('morning')).map(i => i.id)).toEqual(['third', 'first', 'second']);
    expect(await repository.byId('first')).toMatchObject({ textAr: updated.items[0].textAr, sortOrder: 1, includeInOverlay: false });
    expect((await repository.overlayPool()).map(i => i.id)).toEqual(['third', 'second']);
  });

  it('deletes removed bundled items and retains custom items across reseeding', async () => {
    await repository.seed(dataset());
    const custom = await repository.addCustom(customInput);
    const updated = dataset(2);
    updated.items = updated.items.slice(1);
    await repository.seed(updated);
    expect(await repository.byId('first')).toBeUndefined();
    expect(await repository.byId('second')).toBeDefined();
    expect(await repository.byId(custom.id)).toEqual(custom);
  });

  it('adds, updates and deletes custom items and their daily progress', async () => {
    const custom = await repository.addCustom({ ...customInput, repeatCount: 0 });
    expect(custom).toMatchObject({ categoryId: CUSTOM_CATEGORY_ID, isCustom: true, textAr: customInput.textAr.trim(), meaningEn: customInput.meaningEn.trim(), repeatCount: 1, includeInOverlay: false, sortOrder: 0 });
    const next = await repository.addCustom(customInput);
    expect(next.sortOrder).toBe(1);
    await repository.updateCustom(custom.id, { ...customInput, textAr: '  ذِكْرٌ  ', repeatCount: 20000, includeInOverlay: true });
    expect(await repository.byId(custom.id)).toMatchObject({ textAr: 'ذِكْرٌ', repeatCount: 10000, includeInOverlay: true });
    await repository.updateCustom(custom.id, { ...customInput, repeatCount: 2.6 });
    expect((await repository.byId(custom.id))?.repeatCount).toBe(3);
    await db.run('INSERT INTO dhikr_daily (date, dhikr_id, source, count) VALUES (?, ?, ?, ?)', ['2026-01-01', custom.id, 'app', 2]);
    await repository.deleteCustom(custom.id);
    expect(await repository.byId(custom.id)).toBeUndefined();
    expect(await db.query('SELECT * FROM dhikr_daily WHERE dhikr_id = ?', [custom.id])).toEqual([]);
    expect(await repository.byId(next.id)).toEqual(next);
  });

  it('does not edit or delete bundled content through custom operations', async () => {
    await repository.seed(dataset());
    const original = await repository.byId('first');
    await repository.updateCustom('first', customInput);
    await repository.deleteCustom('first');
    expect(await repository.byId('first')).toEqual(original);
  });

  it('byCategory filters categories and respects persisted sort_order', async () => {
    await repository.seed(dataset());
    await repository.addCustom(customInput);
    await repository.reorder(['second', 'third', 'first']);
    expect((await repository.byCategory('morning')).map(i => [i.id, i.sortOrder])).toEqual([['second', 0], ['third', 1], ['first', 2]]);
    expect(await repository.byCategory('missing')).toEqual([]);
  });

  it('rolls back a failing batch without retaining earlier writes', async () => {
    await expect(db.batch([
      { sql: 'INSERT INTO meta (key, value) VALUES (?, ?)', params: ['rollback', 'first'] },
      { sql: 'INSERT INTO meta (key, value) VALUES (?, ?)', params: ['rollback', 'duplicate'] },
    ])).rejects.toThrow();
    expect(await db.query('SELECT * FROM meta')).toEqual([]);
    const result = await db.run('INSERT INTO tasbih_counter (name) VALUES (?)', ['counter']);
    expect(result).toEqual({ changes: 1, lastId: 1 });
  });
});

describe('clampRepeat', () => {
  it.each([[0, 1], [20000, 10000], [2.6, 3]])('clamps %s to %s', (input, expected) => {
    expect(clampRepeat(input)).toBe(expected);
  });
});
