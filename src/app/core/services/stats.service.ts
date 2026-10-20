import { Injectable, inject } from '@angular/core';
import { DatabaseService, SqlDb } from '../db/database.service';
import { addDays, dateKey } from '../util/date';

export interface DailyTotal { date: string; athkar: number; tasbih: number }
export interface Totals { athkar: number; tasbih: number }
export interface Streak { current: number; best: number }
type CategoryId = 'morning' | 'evening';

@Injectable({ providedIn: 'root' })
export class StatsService {
  private db: SqlDb = inject(DatabaseService);

  useDb(db: SqlDb): void { this.db = db; }

  async dailyTotals(days: number, today = new Date()): Promise<DailyTotal[]> {
    const count = this.dayCount(days);
    if (!count) return [];
    const start = dateKey(addDays(today, 1 - count));
    const end = dateKey(today);
    const [athkar, tasbih] = await Promise.all([
      this.db.query<{ date: string; total: number }>(
        'SELECT date, SUM(count) AS total FROM dhikr_daily WHERE date BETWEEN ? AND ? GROUP BY date', [start, end]),
      this.db.query<{ date: string; total: number }>(
        'SELECT date, SUM(count) AS total FROM tasbih_daily WHERE date BETWEEN ? AND ? GROUP BY date', [start, end]),
    ]);
    const a = new Map(athkar.map(row => [row.date, Number(row.total)]));
    const t = new Map(tasbih.map(row => [row.date, Number(row.total)]));
    return Array.from({ length: count }, (_, i) => {
      const date = dateKey(addDays(today, i + 1 - count));
      return { date, athkar: a.get(date) ?? 0, tasbih: t.get(date) ?? 0 };
    });
  }

  /** Rolling week, including today and the preceding six local dates. */
  async weekTotal(today = new Date()): Promise<Totals> {
    return (await this.dailyTotals(7, today)).reduce((sum, day) =>
      ({ athkar: sum.athkar + day.athkar, tasbih: sum.tasbih + day.tasbih }), { athkar: 0, tasbih: 0 });
  }

  async todayTotal(today = new Date()): Promise<Totals> {
    const [day] = await this.dailyTotals(1, today);
    return { athkar: day.athkar, tasbih: day.tasbih };
  }

  async streak(categoryId: CategoryId, today = new Date()): Promise<Streak> {
    const rows = await this.db.query<{ date: string }>(
      'SELECT DISTINCT date FROM category_daily WHERE category_id = ? AND date <= ? ORDER BY date',
      [categoryId, dateKey(today)]);
    const dates = new Set(rows.map(row => row.date));
    let cursor = dates.has(dateKey(today)) ? today : addDays(today, -1);
    let current = 0;
    while (dates.has(dateKey(cursor))) { current++; cursor = addDays(cursor, -1); }
    let best = 0;
    let run = 0;
    let previous = '';
    for (const { date } of rows) {
      const [y, m, d] = date.split('-').map(Number);
      run = previous === dateKey(addDays(new Date(y, m - 1, d), -1)) ? run + 1 : 1;
      best = Math.max(best, run);
      previous = date;
    }
    return { current, best };
  }

  async completionRate(categoryId: CategoryId, days: number, today = new Date()): Promise<number> {
    const count = this.dayCount(days);
    if (!count) return 0;
    const [row] = await this.db.query<{ total: number }>(
      'SELECT COUNT(DISTINCT date) AS total FROM category_daily WHERE category_id = ? AND date BETWEEN ? AND ?',
      [categoryId, dateKey(addDays(today, 1 - count)), dateKey(today)]);
    return Number(row.total) / count;
  }

  async overlayShare(days: number, today = new Date()): Promise<{ app: number; overlay: number }> {
    const count = this.dayCount(days);
    const result = { app: 0, overlay: 0 };
    if (!count) return result;
    const rows = await this.db.query<{ source: string; total: number }>(
      'SELECT source, SUM(count) AS total FROM dhikr_daily WHERE date BETWEEN ? AND ? GROUP BY source',
      [dateKey(addDays(today, 1 - count)), dateKey(today)]);
    for (const row of rows) {
      if (row.source === 'app' || row.source === 'overlay') result[row.source] = Number(row.total);
    }
    return result;
  }

  private dayCount(days: number): number {
    return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  }
}
