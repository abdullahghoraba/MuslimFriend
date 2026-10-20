import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { DatabaseService, SqlDb } from '../db/database.service';
import { AyahRef } from './quran-utils';

export type MarkColor = 'green' | 'blue' | 'gold' | 'red' | 'purple';
export const MARK_COLORS: { id: MarkColor; hex: string }[] = [
  { id: 'green', hex: '#388c64' },
  { id: 'blue', hex: '#527fd0' },
  { id: 'gold', hex: '#a68128' },
  { id: 'red', hex: '#ca6262' },
  { id: 'purple', hex: '#a46ac1' },
];
export interface QuranBookmark {
  id: number;
  name: string;
  color: MarkColor;
  sura: number;
  aya: number;
  page: number;
  updatedAt: number;
}
export interface AyahMark {
  sura: number;
  aya: number;
  kind: 'star' | 'highlight' | 'note';
  color?: MarkColor;
  tag?: string;
  note?: string;
  createdAt: number;
}
@Injectable({ providedIn: 'root' })
export class MarksService {
  private db: SqlDb = inject(DatabaseService);
  private readonly bookmarkState = signal<QuranBookmark[]>([]);
  private readonly markState = signal<AyahMark[]>([]);
  readonly bookmarks: Signal<QuranBookmark[]> = this.bookmarkState.asReadonly();
  readonly marks: Signal<AyahMark[]> = this.markState.asReadonly();
  readonly markIndex: Signal<Map<string, AyahMark[]>> = computed(() => {
    const index = new Map<string, AyahMark[]>();
    for (const mark of this.marks()) {
      const key = mark.sura + ':' + mark.aya;
      index.set(key, [...(index.get(key) ?? []), mark]);
    }
    return index;
  });
  private pending: Promise<unknown> = Promise.resolve();
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.then(work);
    this.pending = next.catch(() => {});
    return next;
  }
  addBookmark(name: string, color: MarkColor, ref: AyahRef, page: number): Promise<QuranBookmark> {
    return this.serial(() => this.addBookmarkNow(name, color, ref, page));
  }
  moveBookmark(id: number, ref: AyahRef, page: number): Promise<void> {
    return this.serial(() => this.moveBookmarkNow(id, ref, page));
  }
  updateBookmark(id: number, patch: { name?: string; color?: MarkColor }): Promise<void> {
    return this.serial(() => this.updateBookmarkNow(id, patch));
  }
  deleteBookmark(id: number): Promise<void> {
    return this.serial(() => this.deleteBookmarkNow(id));
  }
  toggleStar(ref: AyahRef): Promise<boolean> {
    return this.serial(() => this.toggleStarNow(ref));
  }
  setHighlight(ref: AyahRef, color: MarkColor | null, tag?: string): Promise<void> {
    return this.serial(() => this.setHighlightNow(ref, color, tag));
  }
  setNote(ref: AyahRef, note: string | null): Promise<void> {
    return this.serial(() => this.setNoteNow(ref, note));
  }
  useDb(db: SqlDb): void {
    this.db = db;
  }
  async load(): Promise<void> {
    await this.pending;
    const [bookmarks, marks] = await Promise.all([
      this.db.query<QuranBookmark>(
        'SELECT id, name, color, sura, aya, page, updated_at AS updatedAt FROM quran_bookmark ORDER BY updated_at DESC, id DESC',
      ),
      this.db.query<AyahMark>(
        'SELECT sura, aya, kind, color, tag, note, created_at AS createdAt FROM quran_mark ORDER BY sura, aya, kind',
      ),
    ]);
    this.bookmarkState.set(bookmarks);
    this.markState.set(
      marks.map((m) => ({
        ...m,
        color: m.color ?? undefined,
        tag: m.tag ?? undefined,
        note: m.note ?? undefined,
      })),
    );
  }
  private stamp(): number {
    return Math.max(Date.now(), ...this.bookmarks().map((b) => b.updatedAt + 1));
  }
  private async addBookmarkNow(
    name: string,
    color: MarkColor,
    ref: AyahRef,
    page: number,
  ): Promise<QuranBookmark> {
    const updatedAt = this.stamp();
    const result = await this.db.run(
      'INSERT INTO quran_bookmark (name, color, sura, aya, page, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [name, color, ref.sura, ref.aya, page, updatedAt],
    );
    const bookmark: QuranBookmark = { id: result.lastId!, name, color, ...ref, page, updatedAt };
    this.bookmarkState.update((list) => [bookmark, ...list]);
    return bookmark;
  }
  private async moveBookmarkNow(id: number, ref: AyahRef, page: number): Promise<void> {
    const updatedAt = this.stamp();
    await this.db.run(
      'UPDATE quran_bookmark SET sura = ?, aya = ?, page = ?, updated_at = ? WHERE id = ?',
      [ref.sura, ref.aya, page, updatedAt, id],
    );
    this.changeBookmark(id, { ...ref, page, updatedAt });
  }
  private async updateBookmarkNow(
    id: number,
    patch: { name?: string; color?: MarkColor },
  ): Promise<void> {
    const old = this.bookmarks().find((b) => b.id === id);
    if (!old) return;
    const updatedAt = this.stamp();
    const name = patch.name ?? old.name;
    const color = patch.color ?? old.color;
    await this.db.run(
      'UPDATE quran_bookmark SET name = ?, color = ?, updated_at = ? WHERE id = ?',
      [name, color, updatedAt, id],
    );
    this.changeBookmark(id, { name, color, updatedAt });
  }
  private changeBookmark(id: number, patch: Partial<QuranBookmark>): void {
    this.bookmarkState.update((list) =>
      list
        .map((b) => (b.id === id ? { ...b, ...patch } : b))
        .sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id),
    );
  }
  private async deleteBookmarkNow(id: number): Promise<void> {
    await this.db.run('DELETE FROM quran_bookmark WHERE id = ?', [id]);
    this.bookmarkState.update((list) => list.filter((b) => b.id !== id));
  }
  isStarred(ref: AyahRef): boolean {
    return (
      this.markIndex()
        .get(ref.sura + ':' + ref.aya)
        ?.some((m) => m.kind === 'star') ?? false
    );
  }
  private async toggleStarNow(ref: AyahRef): Promise<boolean> {
    const next = !this.isStarred(ref);
    await this.put(ref, 'star', next ? {} : null);
    return next;
  }
  private async setHighlightNow(
    ref: AyahRef,
    color: MarkColor | null,
    tag?: string,
  ): Promise<void> {
    await this.put(ref, 'highlight', color ? { color, tag: tag?.trim() || undefined } : null);
  }
  private async setNoteNow(ref: AyahRef, note: string | null): Promise<void> {
    await this.put(ref, 'note', note?.trim() ? { note: note.trim() } : null);
  }
  tags(): string[] {
    return [
      ...new Set(
        this.marks()
          .filter((m) => m.kind === 'highlight' && m.tag)
          .map((m) => m.tag!),
      ),
    ].sort();
  }
  private async put(
    ref: AyahRef,
    kind: AyahMark['kind'],
    patch: Partial<AyahMark> | null,
  ): Promise<void> {
    const matches = (m: AyahMark) => m.sura === ref.sura && m.aya === ref.aya && m.kind === kind;
    if (!patch) {
      await this.db.run('DELETE FROM quran_mark WHERE sura = ? AND aya = ? AND kind = ?', [
        ref.sura,
        ref.aya,
        kind,
      ]);
      this.markState.update((list) => list.filter((m) => !matches(m)));
      return;
    }
    const mark: AyahMark = {
      ...ref,
      kind,
      createdAt: this.marks().find(matches)?.createdAt ?? Date.now(),
      ...patch,
    };
    await this.db.run(
      'INSERT INTO quran_mark (sura, aya, kind, color, tag, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sura, aya, kind) DO UPDATE SET color = excluded.color, tag = excluded.tag, note = excluded.note',
      [
        ref.sura,
        ref.aya,
        kind,
        mark.color ?? null,
        mark.tag ?? null,
        mark.note ?? null,
        mark.createdAt,
      ],
    );
    this.markState.update((list) => [...list.filter((m) => !matches(m)), mark]);
  }
}
