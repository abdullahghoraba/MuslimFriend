import { TestBed } from '@angular/core/testing';
import { DatabaseService, SqlDb } from '../db/database.service';
import { Dhikr } from '../models';
import { createFakeDb, StatementRecordingDb } from '../../testing/fake-sql-db';
import { ProgressService } from './progress.service';

const today = '2026-01-31';
const tomorrow = '2026-02-01';
const items: Dhikr[] = [1, 2].map(n => ({
  id: 'item-' + n, categoryId: 'morning', textAr: 'سُبْحَانَ اللَّهِ', transliteration: '', meaningEn: '',
  repeatCount: n + 1, virtueAr: '', virtueEn: '', sourceRef: 'Test', grade: '', reviewed: false,
  isQuran: false, isCustom: false, includeInOverlay: true, sortOrder: n,
}));

describe('ProgressService', () => {
  let db: SqlDb;
  let service: ProgressService;
  beforeEach(async () => {
    db = await createFakeDb();
    expect(db, 'These behavior tests require real SQLite; see sql.js load diagnostic').not.toBeInstanceOf(StatementRecordingDb);
    TestBed.configureTestingModule({ providers: [{ provide: DatabaseService, useValue: db }] });
    service = TestBed.inject(ProgressService);
    service.useDb(db);
  });

  it('increments repeatedly and sums app and overlay counts for requested ids', async () => {
    await service.increment('item-1', 1, 'app', today);
    await service.increment('item-1', 2, 'app', today);
    await service.increment('item-1', 4, 'overlay', today);
    await service.increment('other', 50, 'app', today);
    expect(await service.countsFor(['item-1', 'missing'], today)).toEqual(new Map([['item-1', 7]]));
    expect(await service.countsFor([], today)).toEqual(new Map());
    expect(service.version()).toBe(4);
  });

  it('keeps counts separate for explicit dates', async () => {
    await service.increment('item-1', 2, 'app', today);
    await service.increment('item-1', 5, 'overlay', tomorrow);
    expect(await service.countsFor(['item-1'], today)).toEqual(new Map([['item-1', 2]]));
    expect(await service.countsFor(['item-1'], tomorrow)).toEqual(new Map([['item-1', 5]]));
    expect(await service.countsFor(['item-1'], '2026-02-02')).toEqual(new Map());
  });

  it('resetToday clears both sources only for the selected item and date', async () => {
    await service.increment('item-1', 2, 'app', today);
    await service.increment('item-1', 3, 'overlay', today);
    await service.increment('item-2', 4, 'app', today);
    await service.increment('item-1', 5, 'app', tomorrow);
    await service.resetToday('item-1', today);
    expect(await service.countsFor(['item-1', 'item-2'], today)).toEqual(new Map([['item-2', 4]]));
    expect(await service.countsFor(['item-1'], tomorrow)).toEqual(new Map([['item-1', 5]]));
    expect(service.version()).toBe(5);
  });

  it('resetCategoryToday clears the supplied items only on the selected date', async () => {
    for (const item of items) {
      await service.increment(item.id, 2, 'app', today);
      await service.increment(item.id, 3, 'overlay', today);
      await service.increment(item.id, 4, 'app', tomorrow);
    }
    await service.increment('other', 9, 'app', today);
    await service.resetCategoryToday(items, today);
    expect(await service.countsFor([...items.map(i => i.id), 'other'], today)).toEqual(new Map([['other', 9]]));
    expect(await service.countsFor(items.map(i => i.id), tomorrow)).toEqual(new Map([['item-1', 4], ['item-2', 4]]));
    const version = service.version();
    await service.resetCategoryToday([], today);
    expect(service.version()).toBe(version);
    expect(await service.countsFor(['other'], today)).toEqual(new Map([['other', 9]]));
  });

  it('records category completion only after every item reaches its repeat count', async () => {
    expect(await service.categoryProgress('morning', items, today)).toEqual({ done: 0, total: 2, completed: false });
    await service.increment('item-1', 20, 'app', today);
    await service.increment('item-2', 2, 'overlay', today);
    expect(await service.categoryProgress('morning', items, today)).toEqual({ done: 1, total: 2, completed: false });
    expect(await service.isCategoryCompleted('morning', today)).toBe(false);
    expect(await db.query('SELECT * FROM category_daily')).toEqual([]);
    await service.increment('item-2', 1, 'app', today);
    expect(await service.categoryProgress('morning', items, today)).toEqual({ done: 2, total: 2, completed: true });
    expect(await service.isCategoryCompleted('morning', today)).toBe(true);
    const recorded = await db.query<{ date: string; category_id: string; completed_at: number }>('SELECT * FROM category_daily');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({ date: today, category_id: 'morning', completed_at: expect.any(Number) });
    await service.categoryProgress('morning', items, today);
    expect(await db.query('SELECT * FROM category_daily')).toEqual(recorded);
    expect(await service.isCategoryCompleted('morning', tomorrow)).toBe(false);
    expect(await service.isCategoryCompleted('evening', today)).toBe(false);
    expect(await service.categoryProgress('morning', items, tomorrow)).toEqual({ done: 0, total: 2, completed: false });
  });

  it('never marks an empty category completed', async () => {
    expect(await service.categoryProgress('empty', [], today)).toEqual({ done: 0, total: 0, completed: false });
    expect(await service.isCategoryCompleted('empty', today)).toBe(false);
    expect(await db.query('SELECT * FROM category_daily')).toEqual([]);
  });
});
