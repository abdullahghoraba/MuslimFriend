import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DatabaseService, SqlDb } from '../db/database.service';
import { createFakeDb, StatementRecordingDb } from '../../testing/fake-sql-db';
import { KhatmahService } from './khatmah.service';
import { dateKey } from '../util/date';
describe('KhatmahService', () => {
  let service: KhatmahService;
  let db: SqlDb;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    db = await createFakeDb();
    expect(db).not.toBeInstanceOf(StatementRecordingDb);
    TestBed.configureTestingModule({ providers: [{ provide: DatabaseService, useValue: db }] });
    service = TestBed.inject(KhatmahService);
    service.useDb(db);
    await service.load();
  });
  afterEach(() => vi.useRealTimers());
  it('creates one active plan and retains ended plans across reload', async () => {
    const plan = await service.create('ختمة', 30);
    expect(plan.currentPage).toBe(0);
    expect(service.progress()).toBe(0);
    await expect(service.create('Other', 7)).rejects.toThrow();
    await service.abandon(plan.id);
    expect(service.active()).toBeNull();
    expect(service.history()[0].completedAt).toBe(0);
    await service.create('New', 10);
    await service.load();
    expect(service.active()?.name).toBe('New');
    expect(service.history()).toHaveLength(1);
  });
  it('advances sequential reads, tolerates one skipped page, and ignores distant pages', async () => {
    await service.create('Plan', 30);
    await service.recordPageRead(20);
    expect(service.active()?.currentPage).toBe(0);
    await service.recordPageRead(1);
    await service.recordPageRead(3);
    expect(service.active()?.currentPage).toBe(3);
    await service.recordPageRead(2);
    expect(service.active()?.currentPage).toBe(3);
    expect(service.progress()).toBeCloseTo(3 / 604);
    await service.load();
    expect(service.active()?.currentPage).toBe(3);
  });
  it('serializes reader callbacks to avoid lost progress', async () => {
    await service.create('Plan', 30);
    await Promise.all([1, 2, 3, 4].map((p) => service.recordPageRead(p)));
    expect(service.active()?.currentPage).toBe(4);
  });
  it('calculates day-zero quota and preserves it after reading 21 pages and reload', async () => {
    await service.create('Plan', 30);
    expect(service.todayWird()).toEqual({ fromPage: 1, toPage: 21, pagesToday: 21, done: false });
    for (let page = 1; page <= 21; page++) await service.recordPageRead(page);
    expect(service.todayWird()).toEqual({ fromPage: 1, toPage: 21, pagesToday: 21, done: true });
    await service.load();
    expect(service.todayWird()?.done).toBe(true);
    vi.setSystemTime(new Date(2026, 9, 21, 12));
    expect(service.todayWird()).toEqual({ fromPage: 22, toPage: 42, pagesToday: 21, done: false });
  });
  it('does not count rereading yesterday’s last page as new plan progress', async () => {
    await service.create('Plan', 30);
    await service.setCurrentPage(21);
    vi.setSystemTime(new Date(2026, 9, 21, 12));
    await service.recordPageRead(21);
    expect(service.todayWird()).toEqual({ fromPage: 22, toPage: 42, pagesToday: 21, done: false });
  });
  it('uses calendar days over DST and a minimum of one remaining day', async () => {
    await service.create('Plan', 1, 600);
    expect(service.todayWird()?.pagesToday).toBe(5);
    expect(service.todayWird(new Date(2026, 10, 5))?.pagesToday).toBe(5);
  });
  it('supports manual progress and completes at 604', async () => {
    await service.create('Plan', 30, 600);
    await service.setCurrentPage(602);
    expect(service.progress()).toBeCloseTo(3 / 5);
    await service.recordPageRead(604);
    expect(service.active()).toBeNull();
    expect(service.history()[0]).toMatchObject({ currentPage: 604, completedAt: Date.now() });
    await service.load();
    expect(service.history()).toHaveLength(1);
    expect(service.todayWird()).toBeNull();
  });
  it('counts distinct page/day logs even without a plan and includes empty dates', async () => {
    await service.recordPageRead(5);
    await service.recordPageRead(5);
    await service.recordPageRead(6);
    await service.recordPageRead(5, '2026-10-19');
    expect(await service.pagesReadOn(dateKey())).toBe(2);
    expect(await service.pagesReadLastDays(3)).toEqual([
      { date: '2026-10-18', pages: 0 },
      { date: '2026-10-19', pages: 1 },
      { date: '2026-10-20', pages: 2 },
    ]);
  });
  it('manual reading satisfies today quota and persists reading logs', async () => {
    await service.create('Plan', 30);
    await service.setCurrentPage(21);
    expect(service.todayWird()?.done).toBe(true);
    expect(await service.pagesReadOn(dateKey())).toBe(21);
  });
  it('rejects invalid pages, dates and durations without writing', async () => {
    await expect(service.create('Plan', 0)).rejects.toThrow();
    await expect(service.create('Plan', 30, 605)).rejects.toThrow();
    await expect(service.recordPageRead(0)).rejects.toThrow();
    await expect(service.recordPageRead(1, '2026-02-30')).rejects.toThrow();
    expect(await db.query('SELECT * FROM khatmah')).toEqual([]);
    expect(await db.query('SELECT * FROM quran_reading_log')).toEqual([]);
  });
});
