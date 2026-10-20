import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
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
  private builtins: Category[] = [];
  readonly homeHidden = signal<Set<string>>(new Set());
  readonly homeCategories = computed(() =>
    this.categories().filter((c) => (c.isUser ? c.showOnHome : !this.homeHidden().has(c.id))),
  );
  quranAttribution = '';

  /** For unit tests. */
  useDb(db: SqlDb): void {
    this.db = db;
  }

  async init(): Promise<void> {
    const dataset = await firstValueFrom(this.http.get<ContentDataset>('assets/data/athkar.json'));
    this.builtins = dataset.categories;
    this.quranAttribution = dataset.quranAttribution;
    await this.seed(dataset);
    await this.refreshCategories();
  }

  /** Upserts built-in content when the bundled content version changes. */
  async seed(dataset: ContentDataset): Promise<void> {
    const rows = await this.db.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
      CONTENT_VERSION_KEY,
    ]);
    if (rows.length && Number(rows[0].value) >= dataset.contentVersion) return;

    const existing = new Set(
      (await this.db.query<{ id: string }>('SELECT id FROM athkar WHERE is_custom = 0')).map(
        (r) => r.id,
      ),
    );
    const bundledIds = new Set(dataset.items.map((i) => i.id));
    const statements: { sql: string; params?: unknown[] }[] = [];
    const now = Date.now();

    dataset.items.forEach((item: DhikrContent, index) => {
      const content = [
        item.categoryId,
        item.textAr,
        item.transliteration,
        item.meaningEn,
        item.repeatCount,
        item.virtueAr,
        item.virtueEn,
        item.sourceRef,
        item.grade,
        item.reviewed ? 1 : 0,
        item.isQuran ? 1 : 0,
        item.quranRef ?? null,
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
      if (!bundledIds.has(id))
        statements.push({ sql: 'DELETE FROM athkar WHERE id = ?', params: [id] });
    }
    statements.push({
      sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      params: [CONTENT_VERSION_KEY, String(dataset.contentVersion)],
    });
    await this.db.batch(statements);

    // On a content update (not the first install), slot new built-in items in right after the item that
    // precedes them in the bundled list, keeping the user's own order of everything else.
    const added = dataset.items.filter((i) => !existing.has(i.id));
    if (existing.size && added.length) await this.placeNewItems(dataset, new Set(added.map((i) => i.id)));
  }

  private async placeNewItems(dataset: ContentDataset, added: Set<string>): Promise<void> {
    for (const categoryId of new Set(dataset.items.filter((i) => added.has(i.id)).map((i) => i.categoryId))) {
      const bundled = dataset.items.filter((i) => i.categoryId === categoryId).map((i) => i.id);
      const ordered = (await this.byCategory(categoryId)).map((d) => d.id).filter((id) => !added.has(id));
      for (const id of bundled.filter((x) => added.has(x))) {
        const prev = bundled[bundled.indexOf(id) - 1];
        const at = prev ? ordered.indexOf(prev) + 1 : 0;
        ordered.splice(at, 0, id);
      }
      await this.reorder(ordered);
    }
  }

  async refreshCategories(): Promise<void> {
    const rows = await this.db.query<{
      id: string;
      name: string;
      icon: string;
      show_on_home: number;
    }>('SELECT * FROM user_category ORDER BY sort_order, created_at, id');
    this.categoriesState.set([
      ...this.builtins,
      ...rows.map((r) => ({
        id: r.id,
        nameAr: r.name,
        nameEn: r.name,
        icon: r.icon,
        isUser: true,
        showOnHome: !!r.show_on_home,
      })),
    ]);
    this.homeHidden.set(
      new Set(
        (await this.db.query<{ category_id: string }>('SELECT category_id FROM home_hidden')).map(
          (r) => r.category_id,
        ),
      ),
    );
  }

  async addCollection(name: string, icon: string, showOnHome = true): Promise<Category> {
    if (!name.trim()) throw new Error('Collection name is required');
    const id = 'col-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    await this.db.run(
      'INSERT INTO user_category (id, name, icon, show_on_home, sort_order, created_at) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM user_category), ?)',
      [id, name.trim(), icon, showOnHome ? 1 : 0, Date.now()],
    );
    await this.refreshCategories();
    return this.category(id)!;
  }

  async updateCollection(
    id: string,
    patch: { name?: string; icon?: string; showOnHome?: boolean },
  ): Promise<void> {
    if (patch.name !== undefined && !patch.name.trim())
      throw new Error('Collection name is required');
    const updates: { sql: string; params: unknown[] }[] = [];
    if (patch.name !== undefined)
      updates.push({
        sql: 'UPDATE user_category SET name = ? WHERE id = ?',
        params: [patch.name.trim(), id],
      });
    if (patch.icon !== undefined)
      updates.push({
        sql: 'UPDATE user_category SET icon = ? WHERE id = ?',
        params: [patch.icon, id],
      });
    if (patch.showOnHome !== undefined)
      updates.push({
        sql: 'UPDATE user_category SET show_on_home = ? WHERE id = ?',
        params: [patch.showOnHome ? 1 : 0, id],
      });
    await this.db.batch(updates);
    await this.refreshCategories();
  }

  async deleteCollection(id: string, mode: 'move' | 'delete'): Promise<void> {
    if (!(await this.db.query('SELECT id FROM user_category WHERE id = ?', [id])).length) return;
    const items = await this.byCategory(id);
    const statements: { sql: string; params?: unknown[] }[] = [];
    let order = await this.nextSortOrder(CUSTOM_CATEGORY_ID);
    for (const item of items) {
      if (mode === 'move')
        statements.push({
          sql: 'UPDATE athkar SET category_id = ?, sort_order = ? WHERE id = ?',
          params: [CUSTOM_CATEGORY_ID, order++, item.id],
        });
      else
        statements.push(
          { sql: 'DELETE FROM dhikr_daily WHERE dhikr_id = ?', params: [item.id] },
          { sql: 'DELETE FROM athkar WHERE id = ?', params: [item.id] },
        );
    }
    statements.push(
      { sql: 'DELETE FROM category_daily WHERE category_id = ?', params: [id] },
      { sql: 'DELETE FROM home_hidden WHERE category_id = ?', params: [id] },
      { sql: 'DELETE FROM user_category WHERE id = ?', params: [id] },
    );
    await this.db.batch(statements);
    await this.refreshCategories();
  }

  async reorderCollections(ids: string[]): Promise<void> {
    await this.db.batch(
      ids.map((id, index) => ({
        sql: 'UPDATE user_category SET sort_order = ? WHERE id = ?',
        params: [index, id],
      })),
    );
    await this.refreshCategories();
  }

  async setHomeVisible(categoryId: string, visible: boolean): Promise<void> {
    if (this.category(categoryId)?.isUser)
      await this.updateCollection(categoryId, { showOnHome: visible });
    else {
      await this.db.run(
        visible
          ? 'DELETE FROM home_hidden WHERE category_id = ?'
          : 'INSERT OR IGNORE INTO home_hidden (category_id) VALUES (?)',
        [categoryId],
      );
      await this.refreshCategories();
    }
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
    const rows = await this.db.query<AthkarRow>(
      'SELECT * FROM athkar WHERE include_in_overlay = 1 ORDER BY category_id, sort_order',
    );
    return rows.map(rowToDhikr);
  }

  /** Persists a new order for a list (built-in category or custom). */
  async reorder(orderedIds: string[]): Promise<void> {
    await this.db.batch(
      orderedIds.map((id, index) => ({
        sql: 'UPDATE athkar SET sort_order = ? WHERE id = ?',
        params: [index, id],
      })),
    );
  }

  async setIncludeInOverlay(id: string, include: boolean): Promise<void> {
    await this.db.run('UPDATE athkar SET include_in_overlay = ? WHERE id = ?', [
      include ? 1 : 0,
      id,
    ]);
  }

  /** Adds the user's own dhikr at the END of [categoryId] (built-in categories included). */
  async addCustom(
    input: CustomDhikrInput,
    categoryId: string = CUSTOM_CATEGORY_ID,
  ): Promise<Dhikr> {
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await this.db.run(
      `INSERT INTO athkar (id, category_id, text_ar, meaning_en, repeat_count, is_custom, include_in_overlay, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id,
        categoryId,
        input.textAr.trim(),
        input.meaningEn.trim(),
        clampRepeat(input.repeatCount),
        input.includeInOverlay ? 1 : 0,
        await this.nextSortOrder(categoryId),
        Date.now(),
      ],
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
      [
        input.textAr.trim(),
        input.meaningEn.trim(),
        clampRepeat(input.repeatCount),
        input.includeInOverlay ? 1 : 0,
        move ? categoryId : current.categoryId,
        move ? await this.nextSortOrder(categoryId!) : current.sortOrder,
        id,
      ],
    );
  }

  /** Every dhikr the user added, in any category. */
  async listCustom(): Promise<Dhikr[]> {
    const rows = await this.db.query<AthkarRow>(
      'SELECT * FROM athkar WHERE is_custom = 1 ORDER BY category_id, sort_order, created_at',
    );
    return rows.map(rowToDhikr);
  }

  private async nextSortOrder(categoryId: string): Promise<number> {
    const max = await this.db.query<{ m: number | null }>(
      'SELECT MAX(sort_order) AS m FROM athkar WHERE category_id = ?',
      [categoryId],
    );
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
