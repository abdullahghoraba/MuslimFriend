import { Injectable, inject, signal } from '@angular/core';
import { DatabaseService, SqlDb } from '../db/database.service';
import { Dhikr } from '../models';
import { dateKey } from '../util/date';

export interface CategoryProgress {
  done: number;
  total: number;
  completed: boolean;
}

/** Tracks today's per-dhikr counts and per-category completion. */
@Injectable({ providedIn: 'root' })
export class ProgressService {
  private db: SqlDb = inject(DatabaseService);
  /** Bumped on every change so views can re-query. */
  readonly version = signal(0);

  /** For unit tests. */
  useDb(db: SqlDb): void {
    this.db = db;
  }

  /** One position per category, scoped to the same local day as its counts.
   * Morning/evening windows occur once per local day (and end by midnight).
   * Store an item id so hiding/reordering items cannot move the bookmark to another dhikr.
   */
  async savePosition(categoryId: string, dhikrId: string, date = dateKey()): Promise<void> {
    await this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['reader.daily.' + categoryId, JSON.stringify({ date, dhikrId })]);
  }

  async positionFor(categoryId: string, date = dateKey()): Promise<string | undefined> {
    const rows = await this.db.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['reader.daily.' + categoryId]);
    try {
      const saved = JSON.parse(rows[0]?.value ?? 'null');
      return saved?.date === date && typeof saved.dhikrId === 'string' ? saved.dhikrId : undefined;
    } catch { return undefined; }
  }

  /** Today's count per dhikr id (app + overlay combined). */
  async countsFor(ids: string[], date = dateKey()): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!ids.length) return result;
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.db.query<{ dhikr_id: string; total: number }>(
      `SELECT dhikr_id, SUM(count) AS total FROM dhikr_daily
       WHERE date = ? AND dhikr_id IN (${placeholders}) GROUP BY dhikr_id`,
      [date, ...ids],
    );
    for (const r of rows) result.set(r.dhikr_id, Number(r.total));
    return result;
  }

  async increment(dhikrId: string, by = 1, source: 'app' | 'overlay' = 'app', date = dateKey()): Promise<void> {
    await this.db.run(
      `INSERT INTO dhikr_daily (date, dhikr_id, source, count) VALUES (?, ?, ?, ?)
       ON CONFLICT(date, dhikr_id, source) DO UPDATE SET count = count + excluded.count`,
      [date, dhikrId, source, by],
    );
    this.version.update((v) => v + 1);
  }

  /** Clears today's count for one dhikr (the "reset" action in the reader). */
  async resetToday(dhikrId: string, date = dateKey()): Promise<void> {
    await this.db.run('DELETE FROM dhikr_daily WHERE date = ? AND dhikr_id = ?', [date, dhikrId]);
    this.version.update((v) => v + 1);
  }

  /** Resets today's progress for every dhikr in a category (to read it again). */
  async resetCategoryToday(items: Dhikr[], date = dateKey()): Promise<void> {
    if (!items.length) return;
    const placeholders = items.map(() => '?').join(',');
    await this.db.run(`DELETE FROM dhikr_daily WHERE date = ? AND dhikr_id IN (${placeholders})`, [date, ...items.map((i) => i.id)]);
    for (const categoryId of new Set(items.map(i => i.categoryId))) {
      await this.db.run('DELETE FROM meta WHERE key = ?', ['reader.daily.' + categoryId]);
    }
    this.version.update((v) => v + 1);
  }

  /** Computes progress for a category's items and records completion the first time it happens. */
  async categoryProgress(categoryId: string, items: Dhikr[], date = dateKey()): Promise<CategoryProgress> {
    const counts = await this.countsFor(items.map((i) => i.id), date);
    const done = items.filter((i) => (counts.get(i.id) ?? 0) >= i.repeatCount).length;
    const completed = items.length > 0 && done === items.length;
    if (completed) {
      await this.db.run(
        'INSERT OR IGNORE INTO category_daily (date, category_id, completed_at) VALUES (?, ?, ?)',
        [date, categoryId, Date.now()],
      );
    }
    return { done, total: items.length, completed };
  }

  async isCategoryCompleted(categoryId: string, date = dateKey()): Promise<boolean> {
    const rows = await this.db.query('SELECT 1 FROM category_daily WHERE date = ? AND category_id = ?', [date, categoryId]);
    return rows.length > 0;
  }
}
