import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DatabaseService, SqlDb } from '../db/database.service';
import { ContentDataset, CUSTOM_CATEGORY_ID, CustomDhikrInput } from '../models';
import { createFakeDb, StatementRecordingDb } from '../../testing/fake-sql-db';
import { AthkarRepository, clampRepeat } from './athkar.repository';

function dataset(version = 1): ContentDataset {
  return {
    contentVersion: version,
    quranAttribution: 'Tanzil',
    categories: [{ id: 'morning', icon: 'sunny', nameAr: 'الصباح', nameEn: 'Morning' }],
    items: ['first', 'second', 'third'].map((id, index) => ({
      id,
      categoryId: 'morning',
      textAr: 'سُبْحَانَ اللَّهِ ' + id,
      transliteration: 'Subhan Allah',
      meaningEn: 'Glory be to Allah',
      repeatCount: index + 1,
      virtueAr: '',
      virtueEn: '',
      sourceRef: 'Test source',
      grade: '',
      reviewed: false,
      isQuran: false,
    })),
  };
}
const customInput: CustomDhikrInput = {
  textAr: '  الْحَمْدُ لِلَّهِ  ',
  meaningEn: '  Praise be to Allah  ',
  repeatCount: 3,
  includeInOverlay: false,
};

describe('AthkarRepository', () => {
  let db: SqlDb;
  let repository: AthkarRepository;
  beforeEach(async () => {
    db = await createFakeDb();
    expect(
      db,
      'These behavior tests require real SQLite; see sql.js load diagnostic',
    ).not.toBeInstanceOf(StatementRecordingDb);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DatabaseService, useValue: db },
      ],
    });
    repository = TestBed.inject(AthkarRepository);
    repository.useDb(db);
  });

  async function init(): Promise<void> {
    const pending = repository.init();
    TestBed.inject(HttpTestingController).expectOne('assets/data/athkar.json').flush(dataset());
    await pending;
  }

  it('creates, updates, reorders and reloads collections after builtins', async () => {
    await init();
    const first = await repository.addCollection('  الرقية الشرعية  ', 'heart-outline');
    const second = await repository.addCollection('Evening', 'moon-outline', false);
    expect(first.id).toMatch(/^col-[a-z0-9-]+$/);
    expect(repository.categories().map((c) => c.id)).toEqual(['morning', first.id, second.id]);
    expect(repository.category(first.id)).toMatchObject({
      nameAr: 'الرقية الشرعية',
      nameEn: 'الرقية الشرعية',
      isUser: true,
      showOnHome: true,
    });
    await repository.updateCollection(first.id, {
      name: 'Updated',
      icon: 'star-outline',
      showOnHome: false,
    });
    await repository.reorderCollections([second.id, first.id]);
    await init();
    expect(repository.categories().map((c) => c.id)).toEqual(['morning', second.id, first.id]);
    expect(repository.category(first.id)).toMatchObject({
      nameAr: 'Updated',
      icon: 'star-outline',
      showOnHome: false,
    });
    await expect(repository.addCollection(' ', 'book-outline')).rejects.toThrow();
  });

  it('adds collection athkar to the reader and overlay pool and moves them to the end on deletion', async () => {
    const c = await repository.addCollection('Collection', 'book-outline');
    const existing = await repository.addCustom(customInput);
    const first = await repository.addCustom({ ...customInput, includeInOverlay: true }, c.id);
    const second = await repository.addCustom(customInput, c.id);
    await db.run("INSERT INTO dhikr_daily VALUES ('2026-10-20', ?, 'app', 1)", [first.id]);
    expect((await repository.byCategory(c.id)).map((d) => d.id)).toEqual([first.id, second.id]);
    expect((await repository.overlayPool()).map((d) => d.id)).toContain(first.id);
    await repository.deleteCollection(c.id, 'move');
    expect(repository.category(c.id)).toBeUndefined();
    expect((await repository.byCategory('custom')).map((d) => d.id)).toEqual([
      existing.id,
      first.id,
      second.id,
    ]);
    expect(await db.query('SELECT * FROM dhikr_daily WHERE dhikr_id = ?', [first.id])).toHaveLength(
      1,
    );
  });

  it('deletes collection athkar and daily progress without affecting other lists', async () => {
    const c = await repository.addCollection('Collection', 'book-outline');
    const item = await repository.addCustom(customInput, c.id);
    const keep = await repository.addCustom(customInput);
    await db.run("INSERT INTO dhikr_daily VALUES ('2026-10-20', ?, 'app', 1)", [item.id]);
    await repository.deleteCollection(c.id, 'delete');
    expect(await repository.byId(item.id)).toBeUndefined();
    expect(await db.query('SELECT * FROM dhikr_daily')).toEqual([]);
    expect(await repository.byId(keep.id)).toEqual(keep);
    await repository.deleteCollection('custom', 'delete');
    expect(await repository.byId(keep.id)).toEqual(keep);
  });

  it('persists Home visibility separately for builtins and collections', async () => {
    await init();
    const c = await repository.addCollection('Collection', 'book-outline', false);
    expect(repository.homeCategories().map((c) => c.id)).toEqual(['morning']);
    await repository.setHomeVisible('morning', false);
    await repository.setHomeVisible(c.id, true);
    await init();
    expect(repository.homeHidden().has('morning')).toBe(true);
    expect(repository.homeCategories().map((c) => c.id)).toEqual([c.id]);
    await repository.setHomeVisible('morning', true);
    expect(repository.homeCategories().map((c) => c.id)).toEqual(['morning', c.id]);
  });

  it('hides and restores list and overlay items, preserving hidden state on content update', async () => {
    await repository.seed(dataset());
    await repository.setHidden('first', true);
    expect((await repository.byCategory('morning')).map(d => d.id)).toEqual(['second', 'third']);
    expect((await repository.overlayPool()).some(d => d.id === 'first')).toBe(false);
    expect((await repository.hiddenIn('morning')).map(d => d.id)).toEqual(['first']);
    expect(await repository.byCategory('morning', true)).toHaveLength(3);
    await repository.seed(dataset(2));
    expect((await repository.byId('first'))?.hidden).toBe(true);
    await repository.setHidden('first', false);
    expect(await repository.hiddenIn('morning')).toEqual([]);
    expect(await repository.byCategory('morning')).toHaveLength(3);
    expect((await repository.overlayPool()).some(d => d.id === 'first')).toBe(true);
  });

  it('appends independent built-in and custom copies to target lists with exact text', async () => {
    const content = dataset();
    content.items[0].isQuran = true;
    content.items[0].textAr = '  بِسْمِ  ٱللَّهِ\nالرَّحْمَٰنِ  ';
    await repository.seed(content);
    const target = await repository.addCollection('الرقية الشرعية', 'book-outline');
    const existing = await repository.addCustom(customInput, target.id);
    const copy = await repository.saveCopy('first', target.id);
    expect(copy).toMatchObject({ textAr: content.items[0].textAr, meaningEn: content.items[0].meaningEn,
      repeatCount: content.items[0].repeatCount, isCustom: true, includeInOverlay: true, hidden: false });
    expect((await repository.byCategory(target.id)).map(d => d.id)).toEqual([existing.id, copy.id]);
    const customCopy = await repository.saveCopy(existing.id, CUSTOM_CATEGORY_ID);
    await repository.updateCustom(customCopy.id, { ...customInput, textAr: 'معدل' });
    expect((await repository.byId(existing.id))?.textAr).toBe(customInput.textAr.trim());
    await repository.deleteCustom(copy.id);
    expect(await repository.byId('first')).toBeDefined();
  });

  it('seeds every item and does no writes for the same content version', async () => {
    const content = dataset();
    await repository.seed(content);
    for (const item of content.items) expect(await repository.byId(item.id)).toMatchObject(item);
    expect(await repository.byCategory('morning')).toHaveLength(3);
    expect(await db.query('SELECT value FROM meta WHERE key = ?', ['contentVersion'])).toEqual([
      { value: '1' },
    ]);
    const batch = vi.spyOn(db, 'batch');
    const run = vi.spyOn(db, 'run');
    await repository.seed(content);
    expect(batch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('preserves user order and overlay choices while refreshing bundled text', async () => {
    await repository.seed(dataset());
    await repository.reorder(['third', 'first', 'second']);
    await repository.setIncludeInOverlay('first', false);
    const updated = dataset(2);
    updated.items[0].textAr = 'نَصٌّ مُحَدَّثٌ';
    await repository.seed(updated);
    expect((await repository.byCategory('morning')).map((i) => i.id)).toEqual([
      'third',
      'first',
      'second',
    ]);
    expect(await repository.byId('first')).toMatchObject({
      textAr: updated.items[0].textAr,
      sortOrder: 1,
      includeInOverlay: false,
    });
    expect((await repository.overlayPool()).map((i) => i.id)).toEqual(['third', 'second']);
  });

  it('deletes removed bundled items and retains custom items across reseeding', async () => {
    await repository.seed(dataset());
    const custom = await repository.addCustom(customInput);
    const updated = dataset(2);
    updated.items = updated.items.slice(1);
    await repository.seed(updated);
    expect(await repository.byId('first')).toBeUndefined();
    expect(await repository.byId('second')).toBeDefined();
    expect(await repository.byId(custom.id)).toEqual(custom);
  });

  it('adds, updates and deletes custom items and their daily progress', async () => {
    const custom = await repository.addCustom({ ...customInput, repeatCount: 0 });
    expect(custom).toMatchObject({
      categoryId: CUSTOM_CATEGORY_ID,
      isCustom: true,
      textAr: customInput.textAr.trim(),
      meaningEn: customInput.meaningEn.trim(),
      repeatCount: 1,
      includeInOverlay: false,
      sortOrder: 0,
    });
    const next = await repository.addCustom(customInput);
    expect(next.sortOrder).toBe(1);
    await repository.updateCustom(custom.id, {
      ...customInput,
      textAr: '  ذِكْرٌ  ',
      repeatCount: 20000,
      includeInOverlay: true,
    });
    expect(await repository.byId(custom.id)).toMatchObject({
      textAr: 'ذِكْرٌ',
      repeatCount: 10000,
      includeInOverlay: true,
    });
    await repository.updateCustom(custom.id, { ...customInput, repeatCount: 2.6 });
    expect((await repository.byId(custom.id))?.repeatCount).toBe(3);
    await db.run('INSERT INTO dhikr_daily (date, dhikr_id, source, count) VALUES (?, ?, ?, ?)', [
      '2026-01-01',
      custom.id,
      'app',
      2,
    ]);
    await repository.deleteCustom(custom.id);
    expect(await repository.byId(custom.id)).toBeUndefined();
    expect(await db.query('SELECT * FROM dhikr_daily WHERE dhikr_id = ?', [custom.id])).toEqual([]);
    expect(await repository.byId(next.id)).toEqual(next);
  });

  it('does not edit or delete bundled content through custom operations', async () => {
    await repository.seed(dataset());
    const original = await repository.byId('first');
    await repository.updateCustom('first', customInput);
    await repository.deleteCustom('first');
    expect(await repository.byId('first')).toEqual(original);
  });

  it('byCategory filters categories and respects persisted sort_order', async () => {
    await repository.seed(dataset());
    await repository.addCustom(customInput);
    await repository.reorder(['second', 'third', 'first']);
    expect((await repository.byCategory('morning')).map((i) => [i.id, i.sortOrder])).toEqual([
      ['second', 0],
      ['third', 1],
      ['first', 2],
    ]);
    expect(await repository.byCategory('missing')).toEqual([]);
  });

  it('rolls back a failing batch without retaining earlier writes', async () => {
    await expect(
      db.batch([
        { sql: 'INSERT INTO meta (key, value) VALUES (?, ?)', params: ['rollback', 'first'] },
        { sql: 'INSERT INTO meta (key, value) VALUES (?, ?)', params: ['rollback', 'duplicate'] },
      ]),
    ).rejects.toThrow();
    expect(await db.query('SELECT * FROM meta')).toEqual([]);
    const result = await db.run('INSERT INTO tasbih_counter (name) VALUES (?)', ['counter']);
    expect(result).toEqual({ changes: 1, lastId: 1 });
  });
});

describe('clampRepeat', () => {
  it.each([
    [0, 1],
    [20000, 10000],
    [2.6, 3],
  ])('clamps %s to %s', (input, expected) => {
    expect(clampRepeat(input)).toBe(expected);
  });
});
