import { TestBed } from '@angular/core/testing';
import { DatabaseService, SqlDb } from '../db/database.service';
import { TasbihCounter } from '../models';
import { TasbihService, isTargetHit } from './tasbih.service';
import { dateKey } from '../util/date';

type Statement = { sql: string; params?: unknown[] };
class FakeDb implements SqlDb {
  statements: Statement[] = [];
  rows: TasbihCounter[] = [{ id: 1, name: '', target: 33, count: 0, sortOrder: 0 }];
  daily = new Map<number, number>();
  async query<T>(sql: string): Promise<T[]> {
    return (sql.includes('FROM tasbih_counter') ? this.rows.map(c => ({ ...c })) : [...this.daily].map(([counter_id, count]) => ({ counter_id, count }))) as T[];
  }
  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastId?: number }> {
    this.statements.push({ sql, params });
    if (sql.startsWith('INSERT INTO tasbih_counter')) {
      const id = Math.max(0, ...this.rows.map(c => c.id)) + 1;
      this.rows.push({ id, name: String(params[0]), target: Number(params[1]), count: 0, sortOrder: Number(params[2]) });
      return { changes: 1, lastId: id };
    }
    if (sql.includes('SET count = 0')) this.rows.find(c => c.id === params[0])!.count = 0;
    if (sql.startsWith('UPDATE tasbih_counter SET count = count + 1')) this.rows.find(c => c.id === params[0])!.count++;
    if (sql.startsWith('INSERT INTO tasbih_daily')) this.daily.set(Number(params[1]), (this.daily.get(Number(params[1])) ?? 0) + 1);
    if (sql.startsWith('DELETE FROM tasbih_daily')) this.daily.delete(Number(params[0]));
    if (sql.startsWith('DELETE FROM tasbih_counter')) this.rows = this.rows.filter(c => c.id !== params[0]);
    return { changes: 1 };
  }
  async batch(statements: Statement[]): Promise<void> {
    for (const statement of statements) await this.run(statement.sql, statement.params);
  }
}

function setup(): { service: TasbihService; db: FakeDb } {
  const db = new FakeDb();
  TestBed.configureTestingModule({ providers: [{ provide: DatabaseService, useValue: db }] });
  const service = TestBed.inject(TasbihService);
  service.useDb(db);
  return { service, db };
}

describe('isTargetHit', () => {
  it('recognizes each completed cycle', () => {
    expect(isTargetHit(33, 33)).toBe(true);
    expect(isTargetHit(66, 33)).toBe(true);
    expect(isTargetHit(32, 33)).toBe(false);
    expect(isTargetHit(0, 33)).toBe(false);
  });
  it('never completes an open-ended counter', () => {
    for (const count of [0, 1, 33, 66]) expect(isTargetHit(count, 0)).toBe(false);
  });
});

describe('TasbihService', () => {
  it('creates the default only when empty', async () => {
    const { service, db } = setup();
    db.rows = [];
    await service.load();
    expect(service.counters()[0]).toMatchObject({ name: '', target: 33, count: 0 });
    await service.load();
    expect(service.counters()).toHaveLength(1);
  });
  it('increments optimistically and persists daily totals for rapid taps', async () => {
    const { service, db } = setup();
    db.rows[0].count = 32;
    await service.load();
    const first = service.increment(1);
    const second = service.increment(1);
    expect(service.counters()[0].count).toBe(34);
    expect(service.todayTotals().get(1)).toBe(2);
    expect(service.todayGrandTotal()).toBe(2);
    expect(await first).toEqual({ count: 33, reachedTarget: true });
    expect(await second).toEqual({ count: 34, reachedTarget: false });
    expect(db.rows[0].count).toBe(34);
    expect(db.daily.get(1)).toBe(2);
    expect(db.statements.some(s => s.sql.includes('ON CONFLICT(date, counter_id) DO UPDATE SET count = count + 1') && s.params?.[0] === dateKey())).toBe(true);
  });
  it('resets the counter while retaining daily history, including queued taps', async () => {
    const { service, db } = setup();
    await service.load();
    const first = service.increment(1);
    const reset = service.reset(1);
    const second = service.increment(1);
    await Promise.all([first, reset, second]);
    expect(service.counters()[0].count).toBe(1);
    expect(db.rows[0].count).toBe(1);
    expect(service.todayTotals().get(1)).toBe(2);
    expect(db.daily.get(1)).toBe(2);
  });
  it('deletes daily rows along with a removed counter and protects the last one', async () => {
    const { service, db } = setup();
    await service.load();
    await service.add('Second', 0);
    await service.increment(1);
    await service.remove(1);
    expect(db.statements).toContainEqual({ sql: 'DELETE FROM tasbih_daily WHERE counter_id = ?', params: [1] });
    expect(service.todayGrandTotal()).toBe(0);
    expect(service.counters()).toHaveLength(1);
    await service.remove(service.counters()[0].id);
    expect(service.counters()).toHaveLength(1);
  });
  it('rejects invalid targets', async () => {
    const { service } = setup();
    await service.load();
    for (const target of [-1, 1.5, 100001, NaN]) expect(() => service.setTarget(1, target)).toThrow(RangeError);
  });
});

describe('tasbih rounds', () => {
  it('counts up to the target, then starts again at 1 in the next round', async () => {
    const { roundCount, roundNumber } = await import('./tasbih.service');
    expect([1, 32, 33, 34, 66, 67].map((c) => roundCount(c, 33))).toEqual([1, 32, 33, 1, 33, 1]);
    expect([0, 33, 34, 66, 67].map((c) => roundNumber(c, 33))).toEqual([1, 1, 2, 2, 3]);
    expect([100, 101].map((c) => roundCount(c, 100))).toEqual([100, 1]);
    expect(roundCount(150, 0)).toBe(150);
    expect(roundCount(0, 33)).toBe(0);
  });
});
