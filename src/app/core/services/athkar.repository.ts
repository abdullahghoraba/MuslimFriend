import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DatabaseService, SqlDb } from '../db/database.service';
import {
  CUSTOM_CATEGORY_ID,
  Category,
  ContentDataset,
  CustomDhikrInput,
  Dhikr,
  DhikrContent,
} from '../models';

const CONTENT_VERSION_KEY = 'contentVersion';

interface AthkarRow {
  id: string;
  category_id: string;
  text_ar: string;
  transliteration: string;
  meaning_en: string;
  repeat_count: number;
  virtue_ar: string;
  virtue_en: string;
  source_ref: string;
  grade: string;
  reviewed: number;
  is_quran: number;
  quran_ref: string | null;
  is_custom: number;
  include_in_overlay: number;
  sort_order: number;
}

export function rowToDhikr(r: AthkarRow): Dhikr {
  return {
    id: r.id,
    categoryId: r.category_id,
    textAr: r.text_ar,
    transliteration: r.transliteration,
    meaningEn: r.meaning_en,
    repeatCount: Number(r.repeat_count),
    virtueAr: r.virtue_ar,
    virtueEn: r.virtue_en,
    sourceRef: r.source_ref,
    grade: r.grade,
    reviewed: !!r.reviewed,
    isQuran: !!r.is_quran,
    quranRef: r.quran_ref ?? undefined,
    isCustom: !!r.is_custom,
    includeInOverlay: !!r.include_in_overlay,
    sortOrder: Number(r.sort_order),
  };
}

/**
 * Seeds bundled content into SQLite and serves athkar lists.
 * User state (sort order, overlay inclusion) survives content updates.
 */
@Injectable({ providedIn: 'root' })
export class AthkarRepository {
  private readonly http = inject(HttpClient);
  private db: SqlDb = inject(DatabaseService);

  private readonly categoriesState = signal<Category[]>([]);
  readonly categories = this.categoriesState.asReadonly();
  quranAttribution = '';

  /** For unit tests. */
  useDb(db: SqlDb): void {
    this.db = db;
  }

  async init(): Promise<void> {
    const dataset = await firstValueFrom(this.http.get<ContentDataset>('assets/data/athkar.json'));
    this.categoriesState.set(dataset.categories);
    this.quranAttribution = dataset.quranAttribution;
    await this.seed(dataset);
  }

  /** Upserts built-in content when the bundled content version changes. */
  async seed(dataset: ContentDataset): Promise<void> {
    const rows = await this.db.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', [CONTENT_VERSION_KEY]);
    if (rows.length && Number(rows[0].value) >= dataset.contentVersion) return;

    const existing = new Set(
      (await this.db.query<{ id: string }>('SELECT id FROM athkar WHERE is_custom = 0')).map((r) => r.id),
    );
    const bundledIds = new Set(dataset.items.map((i) => i.id));
    const statements: { sql: string; params?: unknown[] }[] = [];
    const now = Date.now();

    dataset.items.forEach((item: DhikrContent, index) => {
      const content = [
        item.categoryId, item.textAr, item.transliteration, item.meaningEn, item.repeatCount,
        item.virtueAr, item.virtueEn, item.sourceRef, item.grade, item.reviewed ? 1 : 0,
        item.isQuran ? 1 : 0, item.quranRef ?? null,
      ];
      if (existing.has(item.id)) {
        // Refresh text and metadata only; keep sort_order and include_in_overlay.
        statements.push({
          sql: `UPDATE athkar SET category_id=?, text_ar=?, transliteration=?, meaning_en=?, repeat_count=?,
                virtue_ar=?, virtue_en=?, source_ref=?, grade=?, reviewed=?, is_quran=?, quran_ref=? WHERE id=?`,
          params: [...content, item.id],
        });
      } else {
        statements.push({
          sql: `INSERT INTO athkar (category_id, text_ar, transliteration, meaning_en, repeat_count,
                virtue_ar, virtue_en, source_ref, grade, reviewed, is_quran, quran_ref,
                id, is_custom, include_in_overlay, sort_order, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?)`,
          params: [...content, item.id, index, now],
        });
      }
    });
    for (const id of existing) {
      if (!bundledIds.has(id)) statements.push({ sql: 'DELETE FROM athkar WHERE id = ?', params: [id] });
    }
    statements.push({
      sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      params: [CONTENT_VERSION_KEY, String(dataset.contentVersion)],
    });
    await this.db.batch(statements);
  }

  category(id: string): Category | undefined {
    if (id === CUSTOM_CATEGORY_ID) {
      return { id, icon: 'create-outline', nameAr: 'أذكاري', nameEn: 'My Athkar' };
    }
    return this.categoriesState().find((c) => c.id === id);
  }

  async byCategory(categoryId: string): Promise<Dhikr[]> {
    const rows = await this.db.query<AthkarRow>(
      'SELECT * FROM athkar WHERE category_id = ? ORDER BY sort_order, created_at',
      [categoryId],
    );
    return rows.map(rowToDhikr);
  }

  async byId(id: string): Promise<Dhikr | undefined> {
    const rows = await this.db.query<AthkarRow>('SELECT * FROM athkar WHERE id = ?', [id]);
    return rows.length ? rowToDhikr(rows[0]) : undefined;
  }

  async overlayPool(): Promise<Dhikr[]> {
    const rows = await this.db.query<AthkarRow>('SELECT * FROM athkar WHERE include_in_overlay = 1 ORDER BY category_id, sort_order');
    return rows.map(rowToDhikr);
  }

  /** Persists a new order for a list (built-in category or custom). */
  async reorder(orderedIds: string[]): Promise<void> {
    await this.db.batch(
      orderedIds.map((id, index) => ({ sql: 'UPDATE athkar SET sort_order = ? WHERE id = ?', params: [index, id] })),
    );
  }

  async setIncludeInOverlay(id: string, include: boolean): Promise<void> {
    await this.db.run('UPDATE athkar SET include_in_overlay = ? WHERE id = ?', [include ? 1 : 0, id]);
  }

  /** Adds the user's own dhikr at the END of [categoryId] (built-in categories included). */
  async addCustom(input: CustomDhikrInput, categoryId: string = CUSTOM_CATEGORY_ID): Promise<Dhikr> {
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await this.db.run(
      `INSERT INTO athkar (id, category_id, text_ar, meaning_en, repeat_count, is_custom, include_in_overlay, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, categoryId, input.textAr.trim(), input.meaningEn.trim(), clampRepeat(input.repeatCount),
        input.includeInOverlay ? 1 : 0, await this.nextSortOrder(categoryId), Date.now()],
    );
    return (await this.byId(id))!;
  }

  /** Updates a custom dhikr; passing another [categoryId] moves it to the end of that list. */
  async updateCustom(id: string, input: CustomDhikrInput, categoryId?: string): Promise<void> {
    const current = await this.byId(id);
    if (!current?.isCustom) return;
    const move = categoryId && categoryId !== current.categoryId;
    await this.db.run(
      `UPDATE athkar SET text_ar = ?, meaning_en = ?, repeat_count = ?, include_in_overlay = ?, category_id = ?, sort_order = ?
       WHERE id = ? AND is_custom = 1`,
      [input.textAr.trim(), input.meaningEn.trim(), clampRepeat(input.repeatCount), input.includeInOverlay ? 1 : 0,
        move ? categoryId : current.categoryId, move ? await this.nextSortOrder(categoryId!) : current.sortOrder, id],
    );
  }

  /** Every dhikr the user added, in any category. */
  async listCustom(): Promise<Dhikr[]> {
    const rows = await this.db.query<AthkarRow>('SELECT * FROM athkar WHERE is_custom = 1 ORDER BY category_id, sort_order, created_at');
    return rows.map(rowToDhikr);
  }

  private async nextSortOrder(categoryId: string): Promise<number> {
    const max = await this.db.query<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM athkar WHERE category_id = ?', [categoryId]);
    return (max[0]?.m ?? -1) + 1;
  }

  async deleteCustom(id: string): Promise<void> {
    await this.db.batch([
      { sql: 'DELETE FROM athkar WHERE id = ? AND is_custom = 1', params: [id] },
      { sql: 'DELETE FROM dhikr_daily WHERE dhikr_id = ?', params: [id] },
    ]);
  }
}

export function clampRepeat(n: number): number {
  return Math.min(10000, Math.max(1, Math.round(Number(n) || 1)));
}
