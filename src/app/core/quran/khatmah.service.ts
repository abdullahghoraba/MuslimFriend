import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { DatabaseService, SqlDb } from '../db/database.service';
import { addDays, dateKey } from '../util/date';
export interface Khatmah {
  id: number;
  name: string;
  startPage: number;
  targetDays: number;
  startedOn: string;
  currentPage: number;
  completedAt: number | null;
}
export interface Wird {
  fromPage: number;
  toPage: number;
  pagesToday: number;
  done: boolean;
}
type Log = { date: string; page: number };
@Injectable({ providedIn: 'root' })
export class KhatmahService {
  private db: SqlDb = inject(DatabaseService);
  private readonly plans = signal<Khatmah[]>([]);
  private readonly logs = signal<Log[]>([]);
  // Zero is an ended/abandoned plan; positive timestamps mean completed Quran.
  readonly active: Signal<Khatmah | null> = computed(
    () => this.plans().find((p) => p.completedAt === null) ?? null,
  );
  readonly history: Signal<Khatmah[]> = computed(() =>
    this.plans().filter((p) => p.completedAt !== null),
  );
  private pending: Promise<unknown> = Promise.resolve();
  useDb(db: SqlDb): void {
    this.db = db;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.then(work);
    this.pending = next.catch(() => {});
    return next;
  }
  async load(): Promise<void> {
    await this.pending;
    const [plans, logs] = await Promise.all([
      this.db.query<Khatmah>(
        'SELECT id, name, start_page AS startPage, target_days AS targetDays, started_on AS startedOn, current_page AS currentPage, completed_at AS completedAt FROM khatmah ORDER BY created_at DESC, id DESC',
      ),
      this.db.query<Log>('SELECT date, page FROM quran_reading_log'),
    ]);
    this.plans.set(plans);
    this.logs.set(logs);
  }
  create(name: string, targetDays: number, startPage = 1): Promise<Khatmah> {
    return this.serial(async () => {
      if (this.active()) throw new Error('End the current plan first');
      this.page(startPage);
      if (!Number.isSafeInteger(targetDays) || targetDays < 1) throw new Error('Invalid duration');
      const plan = {
        name: name.trim() || 'Khatmah',
        startPage,
        targetDays,
        startedOn: dateKey(),
        currentPage: startPage - 1,
        completedAt: null,
      };
      const result = await this.db.run(
        'INSERT INTO khatmah (name, start_page, target_days, started_on, current_page, completed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
        [plan.name, startPage, targetDays, plan.startedOn, plan.currentPage, Date.now()],
      );
      const value = { id: result.lastId!, ...plan };
      this.plans.update((list) => [value, ...list]);
      return value;
    });
  }
  abandon(id: number): Promise<void> {
    return this.serial(async () => {
      const plan = this.plans().find((p) => p.id === id && p.completedAt === null);
      if (!plan) return;
      // completed_at = 0 marks a plan ended early; the page shows a translated «منتهية» label.
      await this.db.run('UPDATE khatmah SET completed_at = 0 WHERE id = ?', [id]);
      this.plans.update((list) =>
        list.map((p) => (p.id === id ? { ...p, completedAt: 0 } : p)),
      );
    });
  }
  recordPageRead(page: number, date = dateKey()): Promise<void> {
    return this.serial(async () => {
      this.page(page);
      this.validDate(date);
      const plan = this.active();
      const advance =
        plan && page > plan.currentPage && page <= plan.currentPage + 2 && date >= plan.startedOn;
      const completedAt = page === 604 ? Date.now() : null;
      await this.db.batch([
        {
          sql: 'INSERT OR IGNORE INTO quran_reading_log (date, page) VALUES (?, ?)',
          params: [date, page],
        },
        ...(advance
          ? [
              {
                sql: 'UPDATE khatmah SET current_page = ?, completed_at = ? WHERE id = ?',
                params: [page, completedAt, plan.id],
              },
            ]
          : []),
      ]);
      if (!this.logs().some((l) => l.date === date && l.page === page))
        this.logs.update((list) => [...list, { date, page }]);
      if (advance)
        this.plans.update((list) =>
          list.map((p) => (p.id === plan.id ? { ...p, currentPage: page, completedAt } : p)),
        );
    });
  }
  setCurrentPage(page: number): Promise<void> {
    return this.serial(async () => {
      this.page(page);
      const plan = this.active();
      if (!plan) return;
      if (page < plan.startPage - 1) throw new Error('Page precedes plan');
      const completedAt = page === 604 ? Date.now() : null;
      const date = dateKey();
      const added: Log[] = [];
      for (let n = plan.currentPage + 1; n <= page; n++) added.push({ date, page: n });
      await this.db.batch([
        ...added.map((l) => ({
          sql: 'INSERT OR IGNORE INTO quran_reading_log (date, page) VALUES (?, ?)',
          params: [l.date, l.page],
        })),
        {
          sql: 'UPDATE khatmah SET current_page = ?, completed_at = ? WHERE id = ?',
          params: [page, completedAt, plan.id],
        },
      ]);
      this.logs.update((list) => [
        ...list,
        ...added.filter((l) => !list.some((old) => old.date === l.date && old.page === l.page)),
      ]);
      this.plans.update((list) =>
        list.map((p) => (p.id === plan.id ? { ...p, currentPage: page, completedAt } : p)),
      );
    });
  }
  todayWird(today = new Date()): Wird | null {
    const plan = this.active();
    if (!plan) return null;
    const key = dateKey(today);
    const previouslyRead = new Set(
      this.logs()
        .filter((l) => l.date >= plan.startedOn && l.date < key)
        .map((l) => l.page),
    );
    const pages = new Set(
      this.logs()
        .filter(
          (l) =>
            l.date === key &&
            l.page >= plan.startPage &&
            l.page <= plan.currentPage &&
            !previouslyRead.has(l.page),
        )
        .map((l) => l.page),
    );
    // Reconstruct the day's starting position from the contiguous read suffix, tolerating one skipped page.
    let baseline = plan.currentPage;
    while (baseline >= plan.startPage && pages.has(baseline)) {
      baseline--;
      if (!pages.has(baseline) && pages.has(baseline - 1)) baseline--;
    }
    const elapsed = Math.max(
      0,
      Math.round((Date.parse(key) - Date.parse(plan.startedOn)) / 86400000),
    );
    const quota = Math.ceil((604 - baseline) / Math.max(1, plan.targetDays - elapsed));
    const toPage = Math.min(604, baseline + quota);
    return { fromPage: baseline + 1, toPage, pagesToday: quota, done: plan.currentPage >= toPage };
  }
  progress(): number {
    const p = this.active();
    return p
      ? Math.max(0, Math.min(1, (p.currentPage - p.startPage + 1) / (605 - p.startPage)))
      : 0;
  }
  async pagesReadOn(date: string): Promise<number> {
    this.validDate(date);
    const rows = await this.db.query<{ pages: number }>(
      'SELECT COUNT(*) AS pages FROM quran_reading_log WHERE date = ?',
      [date],
    );
    return Number(rows[0]?.pages ?? 0);
  }
  async pagesReadLastDays(
    days: number,
    today = new Date(),
  ): Promise<{ date: string; pages: number }[]> {
    if (!Number.isSafeInteger(days) || days < 0) throw new Error('Invalid days');
    return Promise.all(
      Array.from({ length: days }, async (_, i) => {
        const date = dateKey(addDays(today, i - days + 1));
        return { date, pages: await this.pagesReadOn(date) };
      }),
    );
  }
  private page(page: number): void {
    if (!Number.isSafeInteger(page) || page < 1 || page > 604) throw new Error('Invalid page');
  }
  private validDate(date: string): void {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new Error('Invalid date');
  }
}
