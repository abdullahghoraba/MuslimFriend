import { Injectable, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { DatabaseService } from '../db/database.service';
import { Hadith, HadithBookmark, HadithPosition } from './hadith.models';

@Injectable({ providedIn: 'root' })
export class HadithBookmarksService {
  private readonly db = inject(DatabaseService);
  readonly bookmarks = signal<HadithBookmark[]>([]);
  readonly lastRead = signal<HadithPosition | null>(null);
  async load(): Promise<void> {
    this.bookmarks.set(await this.db.query<HadithBookmark>('SELECT * FROM hadith_bookmark ORDER BY updated_at DESC'));
    const { value } = await Preferences.get({ key: 'hadith-last-read' });
    try {
      const p = value ? JSON.parse(value) as HadithPosition : null;
      this.lastRead.set(p && /^[a-z]+$/.test(p.collection) && /^\d+(\.\d+)?$/.test(p.number) && Number.isInteger(p.book) ? p : null);
    } catch { this.lastRead.set(null); }
  }
  saved(h: HadithPosition): HadithBookmark | undefined { return this.bookmarks().find((b) => b.collection === h.collection && b.number === h.number); }
  async save(h: Hadith, note = ''): Promise<void> {
    await this.db.run(
      'INSERT OR REPLACE INTO hadith_bookmark (collection, number, book, note, updated_at, arabic, translation, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [h.collection, h.number, h.book, note.slice(0, 4000), Date.now(), h.arabic.slice(0, 20000), h.translation.slice(0, 20000), (h.authenticitySource ?? '').slice(0, 1000)],
    );
    await this.load();
  }
  async remove(h: HadithPosition): Promise<void> {
    await this.db.run('DELETE FROM hadith_bookmark WHERE collection = ? AND number = ?', [h.collection, h.number]);
    await this.load();
  }
  async remember(h: HadithPosition): Promise<void> {
    const position = { collection: h.collection, number: h.number, book: h.book };
    await Preferences.set({ key: 'hadith-last-read', value: JSON.stringify(position) }); this.lastRead.set(position);
  }
}
