import { TestBed } from '@angular/core/testing';
import { DatabaseService, SqlDb } from '../db/database.service';
import { createFakeDb, StatementRecordingDb } from '../../testing/fake-sql-db';
import { StatsService } from './stats.service';

const today = new Date(2026, 1, 2, 23, 45);
describe('StatsService', () => {
  let db: SqlDb;
  let service: StatsService;
  beforeEach(async () => {
    db = await createFakeDb();
    expect(db, 'Statistics tests require real SQLite').not.toBeInstanceOf(StatementRecordingDb);
    TestBed.configureTestingModule({ providers: [{ provide: DatabaseService, useValue: db }] });
    service = TestBed.inject(StatsService);
    service.useDb(db);
  });
  async function complete(dates: string[], category = 'morning'): Promise<void> {
    for (const date of dates) await db.run('INSERT INTO category_daily VALUES (?, ?, ?)', [date, category, 1]);
  }
  async function count(date: string, source: string, value: number, id = 'dhikr'): Promise<void> {
    await db.run('INSERT INTO dhikr_daily VALUES (?, ?, ?, ?)', [date, id, source, value]);
  }

  it('zero-fills local dates in oldest-to-newest order across a month boundary and sums both sources', async () => {
    await count('2026-02-02', 'app', 3);
    await count('2026-01-31', 'app', 2);
    await count('2026-01-31', 'overlay', 4);
    await count('2026-01-31', 'app', 1, 'other');
    await count('2026-01-29', 'app', 99);
    await count('2026-02-03', 'app', 99);
    await db.run('INSERT INTO tasbih_daily VALUES (?, ?, ?)', ['2026-01-31', 1, 5]);
    await db.run('INSERT INTO tasbih_daily VALUES (?, ?, ?)', ['2026-01-31', 2, 6]);
    expect(await service.dailyTotals(4, today)).toEqual([
      { date: '2026-01-30', athkar: 0, tasbih: 0 },
      { date: '2026-01-31', athkar: 7, tasbih: 11 },
      { date: '2026-02-01', athkar: 0, tasbih: 0 },
      { date: '2026-02-02', athkar: 3, tasbih: 0 },
    ]);
  });
  it('returns today and rolling seven-day totals with inclusive boundaries', async () => {
    await count('2026-02-02', 'app', 3);
    await count('2026-01-27', 'overlay', 7);
    await count('2026-01-26', 'app', 99);
    await count('2026-02-03', 'app', 99);
    await db.run('INSERT INTO tasbih_daily VALUES (?, ?, ?)', ['2026-02-02', 1, 4]);
    expect(await service.todayTotal(today)).toEqual({ athkar: 3, tasbih: 4 });
    expect(await service.weekTotal(today)).toEqual({ athkar: 10, tasbih: 4 });
  });
  it('counts a streak ending today and retains the longest historical run', async () => {
    await complete(['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-02-01', '2026-02-02']);
    await complete(['2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06', '2026-02-07']);
    expect(await service.streak('morning', today)).toEqual({ current: 2, best: 4 });
    expect(await service.streak('evening', today)).toEqual({ current: 0, best: 0 });
  });
  it('allows an unfinished today when yesterday was completed', async () => {
    await complete(['2026-01-30', '2026-01-31', '2026-02-01']);
    expect(await service.streak('morning', today)).toEqual({ current: 3, best: 3 });
  });
  it('resets current after a gap while preserving best', async () => {
    await complete(['2026-01-30', '2026-01-31']);
    expect(await service.streak('morning', today)).toEqual({ current: 0, best: 2 });
    await complete(['2026-02-02']);
    expect(await service.streak('morning', today)).toEqual({ current: 1, best: 2 });
  });
  it('computes completion fractions for the requested category and inclusive date window', async () => {
    await complete(['2026-01-29', '2026-01-30', '2026-02-02', '2026-02-03']);
    await complete(['2026-01-31'], 'evening');
    expect(await service.completionRate('morning', 4, today)).toBe(0.5);
    expect(await service.completionRate('evening', 4, today)).toBe(0.25);
    expect(await service.completionRate('morning', 1, today)).toBe(1);
  });
  it('sums source counts rather than row counts and excludes dates outside the window', async () => {
    await count('2026-01-30', 'app', 3);
    await count('2026-02-02', 'app', 5);
    await count('2026-02-02', 'overlay', 7);
    await count('2026-02-02', 'overlay', 2, 'other');
    await count('2026-01-29', 'overlay', 99);
    await count('2026-02-03', 'app', 99);
    expect(await service.overlayShare(4, today)).toEqual({ app: 8, overlay: 9 });
    expect(await service.overlayShare(1, new Date(2025, 0, 1))).toEqual({ app: 0, overlay: 0 });
  });
  it('handles empty databases and empty windows', async () => {
    expect(await service.todayTotal(today)).toEqual({ athkar: 0, tasbih: 0 });
    expect(await service.streak('morning', today)).toEqual({ current: 0, best: 0 });
    expect(await service.completionRate('morning', 30, today)).toBe(0);
    expect(await service.dailyTotals(0, today)).toEqual([]);
    expect(await service.completionRate('morning', 0, today)).toBe(0);
    expect(await service.overlayShare(0, today)).toEqual({ app: 0, overlay: 0 });
  });
});
