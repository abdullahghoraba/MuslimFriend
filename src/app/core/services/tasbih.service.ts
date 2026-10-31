import { Injectable, computed, inject, signal } from '@angular/core';
import { DatabaseService, SqlDb } from '../db/database.service';
import { TasbihCounter } from '../models';
import { dateKey } from '../util/date';

export function isTargetHit(count: number, target: number): boolean {
  return count > 0 && target > 0 && count % target === 0;
}

/** The count shown for the current round: it reaches the target (33 / 33), then the next tap starts again at 1. */
export function roundCount(count: number, target: number): number {
  return target > 0 && count > 0 ? ((count - 1) % target) + 1 : count;
}

/** Which round of the target the count is in (1 until the target has been completed once). */
export function roundNumber(count: number, target: number): number {
  return target > 0 && count > 0 ? Math.floor((count - 1) / target) + 1 : 1;
}

@Injectable({ providedIn: 'root' })
export class TasbihService {
  private db: SqlDb = inject(DatabaseService);
  private readonly items = signal<TasbihCounter[]>([]);
  private readonly totals = signal(new Map<number, number>());
  readonly counters = this.items.asReadonly();
  readonly todayTotals = this.totals.asReadonly();
  readonly todayGrandTotal = computed(() => [...this.totals().values()].reduce((a, b) => a + b, 0));
  private day = dateKey();
  private pending: Promise<unknown> = Promise.resolve();

  useDb(db: SqlDb): void { this.db = db; }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.catch(() => {});
    return result;
  }

  async load(): Promise<void> {
    await this.enqueue(async () => {
      await this.read();
      if (!this.items().length) await this.create('', 33);
    });
  }

  private async read(): Promise<void> {
    const rows = await this.db.query<TasbihCounter>(
      'SELECT id, name, target, count, sort_order AS sortOrder FROM tasbih_counter ORDER BY sort_order, id');
    const day = dateKey();
    const totals = await this.db.query<{ counter_id: number; count: number }>(
      'SELECT counter_id, count FROM tasbih_daily WHERE date = ?', [day]);
    this.items.set(rows);
    this.day = day;
    this.totals.set(new Map(totals.map(r => [r.counter_id, r.count])));
  }

  private validateTarget(target: number): void {
    if (!Number.isInteger(target) || target < 0 || target > 100000) throw new RangeError('Invalid target');
  }

  private async create(name: string, target: number): Promise<TasbihCounter> {
    const sortOrder = Math.max(-1, ...this.items().map(c => c.sortOrder)) + 1;
    const result = await this.db.run(
      'INSERT INTO tasbih_counter (name, target, count, sort_order, created_at) VALUES (?, ?, 0, ?, ?)',
      [name.trim(), target, sortOrder, Date.now()]);
    if (result.lastId === undefined) throw new Error('Missing counter id');
    const counter = { id: result.lastId, name: name.trim(), target, count: 0, sortOrder };
    this.items.update(items => [...items, counter]);
    return counter;
  }

  add(name: string, target: number): Promise<TasbihCounter> {
    this.validateTarget(target);
    return this.enqueue(() => this.create(name, target));
  }

  rename(id: number, name: string): Promise<void> {
    return this.enqueue(async () => {
      await this.db.run('UPDATE tasbih_counter SET name = ? WHERE id = ?', [name.trim(), id]);
      this.items.update(items => items.map(c => c.id === id ? { ...c, name: name.trim() } : c));
    });
  }

  setTarget(id: number, target: number): Promise<void> {
    this.validateTarget(target);
    return this.enqueue(async () => {
      await this.db.run('UPDATE tasbih_counter SET target = ? WHERE id = ?', [target, id]);
      this.items.update(items => items.map(c => c.id === id ? { ...c, target } : c));
    });
  }

  remove(id: number): Promise<void> {
    return this.enqueue(async () => {
      if (this.items().length <= 1 || !this.items().some(c => c.id === id)) return;
      await this.db.batch([
        { sql: 'DELETE FROM tasbih_daily WHERE counter_id = ?', params: [id] },
        { sql: 'DELETE FROM tasbih_counter WHERE id = ?', params: [id] },
      ]);
      this.items.update(items => items.filter(c => c.id !== id));
      this.totals.update(totals => { const next = new Map(totals); next.delete(id); return next; });
    });
  }

  reset(id: number): Promise<void> {
    const previous = this.items().find(c => c.id === id)?.count ?? 0;
    this.items.update(items => items.map(c => c.id === id ? { ...c, count: 0 } : c));
    return this.enqueue(async () => {
      try { await this.db.run('UPDATE tasbih_counter SET count = 0 WHERE id = ?', [id]); }
      catch (error) {
        this.items.update(items => items.map(c => c.id === id ? { ...c, count: c.count + previous } : c));
        throw error;
      }
    });
  }

  reorder(ids: number[]): Promise<void> {
    return this.enqueue(async () => {
      const items = this.items();
      if (ids.length !== items.length || new Set(ids).size !== ids.length || ids.some(id => !items.some(c => c.id === id))) {
        throw new Error('Reorder must include every counter exactly once');
      }
      await this.db.batch(ids.map((id, sortOrder) => ({
        sql: 'UPDATE tasbih_counter SET sort_order = ? WHERE id = ?', params: [sortOrder, id],
      })));
      this.items.set(ids.map((id, sortOrder) => ({ ...this.items().find(c => c.id === id)!, sortOrder })));
    });
  }

  /** Applies counts taken on the floating counter (over other apps) since the last sync. */
  applyExternal(id: number, delta: number, reset: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!this.items().some(c => c.id === id)) return;
      const statements: { sql: string; params: unknown[] }[] = [];
      if (reset) statements.push({ sql: 'UPDATE tasbih_counter SET count = 0 WHERE id = ?', params: [id] });
      if (delta > 0) {
        statements.push(
          { sql: 'UPDATE tasbih_counter SET count = count + ? WHERE id = ?', params: [delta, id] },
          { sql: 'INSERT INTO tasbih_daily (date, counter_id, count) VALUES (?, ?, ?) ON CONFLICT(date, counter_id) DO UPDATE SET count = count + excluded.count', params: [dateKey(), id, delta] },
        );
      }
      if (!statements.length) return;
      await this.db.batch(statements);
      await this.read();
    });
  }

  increment(id: number): Promise<{ count: number; reachedTarget: boolean }> {
    const counter = this.items().find(c => c.id === id);
    if (!counter) return Promise.reject(new Error('Unknown counter'));
    const day = dateKey();
    if (this.day !== day) { this.day = day; this.totals.set(new Map()); }
    const count = counter.count + 1;
    this.items.update(items => items.map(c => c.id === id ? { ...c, count } : c));
    this.totals.update(totals => new Map(totals).set(id, (totals.get(id) ?? 0) + 1));
    return this.enqueue(async () => {
      try {
        await this.db.batch([
          { sql: 'UPDATE tasbih_counter SET count = count + 1 WHERE id = ?', params: [id] },
          { sql: 'INSERT INTO tasbih_daily (date, counter_id, count) VALUES (?, ?, 1) ON CONFLICT(date, counter_id) DO UPDATE SET count = count + 1', params: [day, id] },
        ]);
      } catch (error) {
        this.items.update(items => items.map(c => c.id === id ? { ...c, count: Math.max(0, c.count - 1) } : c));
        if (this.day === day) this.totals.update(t => new Map(t).set(id, Math.max(0, (t.get(id) ?? 0) - 1)));
        throw error;
      }
      return { count, reachedTarget: isTargetHit(count, counter.target) };
    });
  }
}
