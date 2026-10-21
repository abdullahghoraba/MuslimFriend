import { Injectable, computed, inject, signal } from '@angular/core';
import { DatabaseService, SqlDb } from '../db/database.service';
import { addDays, dateKey } from '../util/date';
import { QuranService } from './quran.service';
import { AyahRef } from './quran-utils';
import { MARK_COLORS, MarkColor } from './marks.service';
import {
  HifzAyah,
  HifzStatus,
  activityStreak,
  ayahKey,
  dueAyahs,
  enumerateRange,
  newPortion,
  reviewSchedule,
} from './hifz-utils';
export interface HifzPlanInput {
  name: string;
  color: MarkColor;
  from: AyahRef;
  to: AyahRef;
  dailyNew: number;
  followUp: boolean;
}
export interface HifzPlan extends HifzPlanInput {
  id: number;
  createdAt: number;
  archived: boolean;
}
export interface HifzLog {
  date: string;
  planId: number;
  kind: 'new' | 'review';
  ayat: number;
}
export interface HifzToday {
  newPortion: AyahRef[];
  due: AyahRef[];
  memorized: number;
  total: number;
}
@Injectable({ providedIn: 'root' })
export class HifzService {
  private db: SqlDb = inject(DatabaseService);
  private readonly quran = inject(QuranService);
  private readonly planState = signal<HifzPlan[]>([]);
  private readonly ayahs = signal<HifzAyah[]>([]);
  private readonly logs = signal<HifzLog[]>([]);
  readonly plans = this.planState.asReadonly();
  /** Overlapping plans: the oldest active plan wins, keeping markers stable. */
  readonly memorizedIndex = computed(() => {
    const index = new Map<string, { planId: number; color: MarkColor; status: HifzStatus }>();
    for (const p of this.plans()
      .filter((p) => !p.archived)
      .slice()
      .sort((a, b) => a.id - b.id))
      for (const a of this.ayahs().filter((a) => a.planId === p.id))
        if (!index.has(ayahKey(a)))
          index.set(ayahKey(a), { planId: p.id, color: p.color, status: a.status });
    return index;
  });
  private pending: Promise<unknown> = Promise.resolve();
  useDb(db: SqlDb): void {
    this.db = db;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.then(work);
    this.pending = next.catch(() => {});
    return next;
  }
  load(): Promise<void> {
    return this.serial(async () => {
      await this.quran.load();
      await this.refresh();
    });
  }
  private async refresh(): Promise<void> {
    const [plans, ayahs, logs] = await Promise.all([
      this.db.query<{
        id: number;
        name: string;
        color: MarkColor;
        from_sura: number | null;
        from_aya: number | null;
        to_sura: number | null;
        to_aya: number | null;
        daily_new: number;
        follow_up: number;
        created_at: number;
        archived: number;
      }>('SELECT * FROM hifz_plan ORDER BY created_at DESC, id DESC'),
      this.db.query<HifzAyah>(
        'SELECT plan_id AS planId, sura, aya, status, memorized_on AS memorizedOn, last_review AS lastReview, next_review AS nextReview, reviews, step FROM hifz_ayah',
      ),
      this.db.query<HifzLog>('SELECT date, plan_id AS planId, kind, ayat FROM hifz_log'),
    ]);
    this.planState.set(
      plans.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        from: { sura: p.from_sura ?? 1, aya: p.from_aya ?? 1 },
        to: {
          sura: p.to_sura ?? this.counts.length,
          aya: p.to_aya ?? this.counts[this.counts.length - 1],
        },
        dailyNew: p.daily_new,
        followUp: !!p.follow_up,
        createdAt: p.created_at,
        archived: !!p.archived,
      })),
    );
    this.ayahs.set(ayahs);
    this.logs.set(logs);
  }
  private get counts(): number[] {
    return this.quran.meta.suras.map((s) => s.ayas);
  }
  list(includeArchived = false): HifzPlan[] {
    return this.plans().filter((p) => includeArchived || !p.archived);
  }
  private plan(id: number): HifzPlan {
    const p = this.plans().find((p) => p.id === id);
    if (!p) throw new Error('Unknown plan');
    return p;
  }
  private validate(p: HifzPlanInput): void {
    if (
      !p.name.trim() ||
      !MARK_COLORS.some((c) => c.id === p.color) ||
      !Number.isSafeInteger(p.dailyNew) ||
      p.dailyNew < 1 ||
      typeof p.followUp !== 'boolean'
    )
      throw new Error('Invalid plan');
    enumerateRange(this.counts, p.from, p.to);
  }
  create(input: HifzPlanInput): Promise<HifzPlan> {
    return this.serial(async () => {
      this.validate(input);
      const result = await this.db.run(
        'INSERT INTO hifz_plan (name,color,from_sura,from_aya,to_sura,to_aya,daily_new,follow_up,created_at,archived) VALUES (?,?,?,?,?,?,?,?,?,0)',
        [
          input.name.trim(),
          input.color,
          input.from.sura,
          input.from.aya,
          input.to.sura,
          input.to.aya,
          input.dailyNew,
          Number(input.followUp),
          Date.now(),
        ],
      );
      await this.refresh();
      return this.plan(result.lastId!);
    });
  }
  update(id: number, patch: Partial<HifzPlanInput>): Promise<void> {
    return this.serial(async () => {
      const p = { ...this.plan(id), ...patch };
      this.validate(p);
      const allowed = new Set(enumerateRange(this.counts, p.from, p.to).map(ayahKey));
      await this.db.batch([
        {
          sql: 'UPDATE hifz_plan SET name=?,color=?,from_sura=?,from_aya=?,to_sura=?,to_aya=?,daily_new=?,follow_up=? WHERE id=?',
          params: [
            p.name.trim(),
            p.color,
            p.from.sura,
            p.from.aya,
            p.to.sura,
            p.to.aya,
            p.dailyNew,
            Number(p.followUp),
            id,
          ],
        },
        ...this.ayahs()
          .filter((a) => a.planId === id && !allowed.has(ayahKey(a)))
          .map((a) => ({
            sql: 'DELETE FROM hifz_ayah WHERE plan_id=? AND sura=? AND aya=?',
            params: [id, a.sura, a.aya],
          })),
      ]);
      await this.refresh();
    });
  }
  archive(id: number, archived = true): Promise<void> {
    return this.serial(async () => {
      this.plan(id);
      await this.db.run('UPDATE hifz_plan SET archived=? WHERE id=?', [Number(archived), id]);
      await this.refresh();
    });
  }
  delete(id: number): Promise<void> {
    return this.serial(async () => {
      this.plan(id);
      await this.db.batch(
        ['hifz_ayah', 'hifz_log', 'hifz_plan'].map((t) => ({
          sql: 'DELETE FROM ' + t + ' WHERE ' + (t === 'hifz_plan' ? 'id' : 'plan_id') + '=?',
          params: [id],
        })),
      );
      await this.refresh();
    });
  }
  private refs(id: number, refs: AyahRef[]): AyahRef[] {
    const p = this.plan(id);
    if (p.archived) throw new Error('Archived plan');
    const allowed = new Set(enumerateRange(this.counts, p.from, p.to).map(ayahKey));
    if (refs.some((r) => !allowed.has(ayahKey(r)))) throw new Error('Ayah outside plan');
    return [...new Map(refs.map((r) => [ayahKey(r), r])).values()];
  }
  markRange(planId: number, refs: AyahRef[], status: HifzStatus | null): Promise<void> {
    return this.serial(async () => {
      if (status !== null && status !== 'learning' && status !== 'memorized')
        throw new Error('Invalid status');
      const unique = this.refs(planId, refs);
      const now = new Date();
      const today = dateKey(now);
      const changed = unique.filter(
        (r) =>
          this.ayahs().find((a) => a.planId === planId && ayahKey(a) === ayahKey(r))?.status !==
          status,
      );
      const statements = changed.map((r) =>
        status === null
          ? {
              sql: 'DELETE FROM hifz_ayah WHERE plan_id=? AND sura=? AND aya=?',
              params: [planId, r.sura, r.aya],
            }
          : {
              sql: 'INSERT INTO hifz_ayah (plan_id,sura,aya,status,memorized_on,last_review,next_review,reviews,step) VALUES (?,?,?,?,?,NULL,?,0,0) ON CONFLICT(plan_id,sura,aya) DO UPDATE SET status=excluded.status,memorized_on=excluded.memorized_on,last_review=NULL,next_review=excluded.next_review,reviews=0,step=0',
              params: [
                planId,
                r.sura,
                r.aya,
                status,
                status === 'memorized' ? today : null,
                status === 'memorized' ? dateKey(addDays(now, 1)) : null,
              ],
            },
      );
      if (status === 'memorized' && changed.length)
        statements.push(this.logStatement(planId, 'new', changed.length, today));
      await this.db.batch(statements);
      await this.refresh();
    });
  }
  private logStatement(
    id: number,
    kind: 'new' | 'review',
    count: number,
    date: string,
  ): { sql: string; params: (string | number)[] } {
    return {
      sql: 'INSERT INTO hifz_log (date,plan_id,kind,ayat) VALUES (?,?,?,?) ON CONFLICT(date,plan_id,kind) DO UPDATE SET ayat=ayat+excluded.ayat',
      params: [date, id, kind, count],
    };
  }
  review(planId: number, refs: AyahRef[], result: 'good' | 'hard'): Promise<void> {
    return this.serial(async () => {
      if (result !== 'good' && result !== 'hard') throw new Error('Invalid review');
      const unique = this.refs(planId, refs);
      const now = new Date();
      const today = dateKey(now);
      const rows = unique.map((r) =>
        this.ayahs().find((a) => a.planId === planId && ayahKey(a) === ayahKey(r)),
      );
      if (rows.some((a) => a?.status !== 'memorized'))
        throw new Error('Only memorized ayahs can be reviewed');
      const statements = rows.map((a) => {
        const schedule = reviewSchedule(a!.step, result, now);
        return {
          sql: 'UPDATE hifz_ayah SET step=?,next_review=?,reviews=reviews+1,last_review=? WHERE plan_id=? AND sura=? AND aya=?',
          params: [schedule.step, schedule.nextReview, today, planId, a!.sura, a!.aya],
        };
      });
      if (rows.length) statements.push(this.logStatement(planId, 'review', rows.length, today));
      await this.db.batch(statements);
      await this.refresh();
    });
  }
  today(planId: number, now = new Date()): HifzToday {
    const p = this.plan(planId);
    const range = enumerateRange(this.counts, p.from, p.to);
    const rows = this.ayahs().filter((a) => a.planId === planId);
    return {
      newPortion: newPortion(range, rows, p.dailyNew),
      due: dueAyahs(rows, dateKey(now)),
      memorized: rows.filter((a) => a.status === 'memorized').length,
      total: range.length,
    };
  }
  progress(planId: number): { memorized: number; total: number; percent: number } {
    const { memorized, total } = this.today(planId);
    return { memorized, total, percent: total ? (memorized / total) * 100 : 0 };
  }
  streak(planId: number, now = new Date()): number {
    this.plan(planId);
    return activityStreak(
      this.logs()
        .filter((l) => l.planId === planId && l.ayat > 0)
        .map((l) => l.date),
      now,
    );
  }
  activity(planId: number, now = new Date()): { date: string; new: number; review: number }[] {
    this.plan(planId);
    return Array.from({ length: 30 }, (_, i) => {
      const date = dateKey(addDays(now, i - 29));
      const rows = this.logs().filter((l) => l.planId === planId && l.date === date);
      return {
        date,
        new: rows.find((l) => l.kind === 'new')?.ayat ?? 0,
        review: rows.find((l) => l.kind === 'review')?.ayat ?? 0,
      };
    });
  }
}
