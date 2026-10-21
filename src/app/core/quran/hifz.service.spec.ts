import { TestBed } from '@angular/core/testing';
import { DatabaseService, SqlDb } from '../db/database.service';
import { createFakeDb, StatementRecordingDb } from '../../testing/fake-sql-db';
import { QuranService } from './quran.service';
import { HifzPlanInput, HifzService } from './hifz.service';
import { addDays, dateKey } from '../util/date';
describe('HifzService', () => {
  let service: HifzService;
  let db: SqlDb;
  const input: HifzPlanInput = {
    name: ' حفظ ',
    color: 'green',
    from: { sura: 1, aya: 2 },
    to: { sura: 2, aya: 3 },
    dailyNew: 3,
    followUp: true,
  };
  beforeEach(async () => {
    db = await createFakeDb();
    expect(db).not.toBeInstanceOf(StatementRecordingDb);
    TestBed.configureTestingModule({
      providers: [
        { provide: DatabaseService, useValue: db },
        {
          provide: QuranService,
          useValue: { load: async () => {}, meta: { suras: [{ ayas: 3 }, { ayas: 4 }] } },
        },
      ],
    });
    service = TestBed.inject(HifzService);
    await service.load();
  });
  it('persists CRUD and archive state; deletes child rows and logs', async () => {
    const p = await service.create(input);
    expect(p.name).toBe('حفظ');
    await service.update(p.id, { name: 'New', color: 'blue' });
    await service.markRange(p.id, [input.from], 'memorized');
    await service.load();
    expect(service.list()[0]).toMatchObject({ name: 'New', color: 'blue' });
    await service.archive(p.id);
    expect(service.list()).toEqual([]);
    expect(service.list(true)).toHaveLength(1);
    expect(service.memorizedIndex().size).toBe(0);
    await service.archive(p.id, false);
    await service.delete(p.id);
    expect(service.list(true)).toEqual([]);
    expect(await db.query('SELECT * FROM hifz_ayah')).toEqual([]);
    expect(await db.query('SELECT * FROM hifz_log')).toEqual([]);
  });
  it('tracks learning and memorized ranges independently across plans', async () => {
    const p = await service.create(input);
    const other = await service.create({ ...input, color: 'red' });
    expect(service.today(p.id)).toMatchObject({
      total: 5,
      memorized: 0,
      newPortion: [
        { sura: 1, aya: 2 },
        { sura: 1, aya: 3 },
        { sura: 2, aya: 1 },
      ],
    });
    await service.markRange(p.id, [input.from], 'learning');
    expect(service.today(p.id).newPortion[0]).toEqual({ sura: 1, aya: 3 });
    await service.markRange(other.id, [input.from], 'memorized');
    await service.markRange(p.id, [input.from, input.from], 'memorized');
    expect(service.progress(p.id)).toEqual({ memorized: 1, total: 5, percent: 20 });
    expect(service.memorizedIndex().get('1:2')).toMatchObject({
      planId: p.id,
      status: 'memorized',
      color: 'green',
    });
    const [row] = await db.query('SELECT * FROM hifz_ayah WHERE plan_id=?', [p.id]);
    expect(row).toMatchObject({
      step: 0,
      reviews: 0,
      memorized_on: dateKey(),
      next_review: dateKey(addDays(new Date(), 1)),
    });
    await service.markRange(p.id, [input.from], 'memorized');
    expect(service.activity(p.id).at(-1)?.new).toBe(1);
    await service.markRange(p.id, [input.from], null);
    expect(service.progress(p.id).memorized).toBe(0);
    expect(service.progress(other.id).memorized).toBe(1);
  });
  it('persists good and hard reviews, caps steps and records activity', async () => {
    const p = await service.create(input);
    await service.markRange(p.id, [input.from], 'memorized');
    await service.review(p.id, [input.from, input.from], 'good');
    expect((await db.query('SELECT * FROM hifz_ayah'))[0]).toMatchObject({
      step: 1,
      reviews: 1,
      last_review: dateKey(),
      next_review: dateKey(addDays(new Date(), 3)),
    });
    for (let i = 0; i < 7; i++) await service.review(p.id, [input.from], 'good');
    expect((await db.query('SELECT * FROM hifz_ayah'))[0]).toMatchObject({ step: 5, reviews: 8 });
    await service.review(p.id, [input.from], 'hard');
    await service.load();
    expect((await db.query('SELECT * FROM hifz_ayah'))[0]).toMatchObject({
      step: 0,
      reviews: 9,
      next_review: dateKey(addDays(new Date(), 1)),
    });
    expect(service.activity(p.id)).toHaveLength(30);
    expect(service.activity(p.id).at(-1)).toMatchObject({ new: 1, review: 9 });
    expect(service.streak(p.id)).toBe(1);
    await db.run('UPDATE hifz_ayah SET next_review=?', [dateKey()]);
    await service.load();
    expect(service.today(p.id).due).toEqual([input.from]);
  });
  it('rejects invalid ranges, unknown plans and nonmemorized reviews without partial writes', async () => {
    await expect(service.create({ ...input, to: { sura: 1, aya: 1 } })).rejects.toThrow();
    const p = await service.create(input);
    await expect(
      service.markRange(p.id, [input.from, { sura: 2, aya: 4 }], 'memorized'),
    ).rejects.toThrow();
    await expect(service.review(p.id, [input.from], 'good')).rejects.toThrow();
    await expect(service.markRange(999, [input.from], null)).rejects.toThrow();
    expect(await db.query('SELECT * FROM hifz_ayah')).toEqual([]);
  });
  it('serializes concurrent mutations and trims tracked rows when narrowing a plan', async () => {
    const p = await service.create(input);
    await Promise.all([
      service.markRange(p.id, [input.from], 'memorized'),
      service.review(p.id, [input.from], 'good'),
    ]);
    expect(service.activity(p.id).at(-1)).toMatchObject({ new: 1, review: 1 });
    await service.update(p.id, { from: { sura: 2, aya: 1 } });
    expect(service.memorizedIndex().size).toBe(0);
    expect(service.progress(p.id).total).toBe(3);
  });
  it('does not publish a failed atomic mutation', async () => {
    const p = await service.create(input);
    service.useDb({
      ...db,
      batch: async () => {
        throw new Error('disk');
      },
    });
    await expect(service.markRange(p.id, [input.from], 'memorized')).rejects.toThrow('disk');
    expect(service.progress(p.id).memorized).toBe(0);
    expect(service.activity(p.id).at(-1)?.new).toBe(0);
  });
});
