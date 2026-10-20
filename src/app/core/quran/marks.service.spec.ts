import { TestBed } from '@angular/core/testing';
import { DatabaseService, SqlDb } from '../db/database.service';
import { createFakeDb, StatementRecordingDb } from '../../testing/fake-sql-db';
import { MarksService } from './marks.service';
describe('MarksService', () => {
  let service: MarksService;
  let db: SqlDb;
  const ref = { sura: 2, aya: 5 };
  beforeEach(async () => {
    db = await createFakeDb();
    expect(db).not.toBeInstanceOf(StatementRecordingDb);
    TestBed.configureTestingModule({ providers: [{ provide: DatabaseService, useValue: db }] });
    service = TestBed.inject(MarksService);
    service.useDb(db);
    await service.load();
  });
  it('creates, edits, moves and deletes bookmarks in updated order', async () => {
    const a = await service.addBookmark('First', 'blue', ref, 2);
    const b = await service.addBookmark('Second', 'gold', ref, 2);
    expect(service.bookmarks().map((b) => b.id)).toEqual([b.id, a.id]);
    await service.updateBookmark(a.id, { name: 'Renamed', color: 'red' });
    expect(service.bookmarks()[0]).toMatchObject({ id: a.id, name: 'Renamed', color: 'red' });
    await service.moveBookmark(b.id, { sura: 3, aya: 1 }, 50);
    expect(service.bookmarks()[0]).toMatchObject({ id: b.id, sura: 3, aya: 1, page: 50 });
    await service.load();
    expect(service.bookmarks()[0].id).toBe(b.id);
    await service.deleteBookmark(b.id);
    expect(service.bookmarks()).toHaveLength(1);
    await service.load();
    expect(service.bookmarks()[0].id).toBe(a.id);
  });
  it('toggles stars and updates the ayah index immediately', async () => {
    expect(service.isStarred(ref)).toBe(false);
    expect(await service.toggleStar(ref)).toBe(true);
    expect(service.isStarred(ref)).toBe(true);
    expect(service.markIndex().get('2:5')).toHaveLength(1);
    await service.load();
    expect(service.isStarred(ref)).toBe(true);
    expect(await service.toggleStar(ref)).toBe(false);
    expect(service.markIndex().has('2:5')).toBe(false);
    expect(await db.query('SELECT * FROM quran_mark')).toEqual([]);
  });
  it('upserts highlights, trims and sorts distinct tags and removes highlights', async () => {
    await service.setHighlight(ref, 'green', ' patience ');
    const createdAt = service.marks()[0].createdAt;
    await service.setHighlight(ref, 'purple', 'hope');
    await service.setHighlight({ sura: 2, aya: 6 }, 'blue', 'hope');
    await service.setHighlight({ sura: 2, aya: 7 }, 'red', 'action');
    expect(service.tags()).toEqual(['action', 'hope']);
    expect(service.marks()[0].createdAt).toBe(createdAt);
    await service.load();
    expect(service.marks().find((m) => m.aya === 5)).toMatchObject({
      color: 'purple',
      tag: 'hope',
    });
    await service.setHighlight(ref, null);
    expect(service.marks()).toHaveLength(2);
  });
  it('stores notes alongside other mark kinds and removes blank or null notes only', async () => {
    await service.toggleStar(ref);
    await service.setHighlight(ref, 'gold');
    await service.setNote(ref, ' تأمل ');
    expect(service.markIndex().get('2:5')).toHaveLength(3);
    await service.load();
    expect(service.marks().find((m) => m.kind === 'note')?.note).toBe('تأمل');
    await service.setNote(ref, '  ');
    expect(service.markIndex().get('2:5')).toHaveLength(2);
    await service.setNote(ref, 'again');
    await service.setNote(ref, null);
    expect(service.isStarred(ref)).toBe(true);
  });
  it('serializes overlapping star toggles', async () => {
    expect(await Promise.all([service.toggleStar(ref), service.toggleStar(ref)])).toEqual([
      true,
      false,
    ]);
    expect(service.isStarred(ref)).toBe(false);
    expect(await db.query('SELECT * FROM quran_mark')).toEqual([]);
  });
  it('does not publish failed database writes', async () => {
    service.useDb({
      query: db.query,
      batch: db.batch,
      run: async () => {
        throw new Error('disk');
      },
    });
    await expect(service.toggleStar(ref)).rejects.toThrow('disk');
    expect(service.marks()).toEqual([]);
  });
});
