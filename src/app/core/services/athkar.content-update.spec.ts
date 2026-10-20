import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ContentDataset, DhikrContent } from '../models';
import { createFakeDb } from '../../testing/fake-sql-db';
import { AthkarRepository } from './athkar.repository';

const item = (id: string): DhikrContent => ({
  id, categoryId: 'morning', textAr: `نَص ${id}`, transliteration: '', meaningEn: '', repeatCount: 1,
  virtueAr: '', virtueEn: '', sourceRef: 'ref', grade: '', reviewed: false, isQuran: false,
});

const dataset = (version: number, ids: string[]): ContentDataset => ({
  contentVersion: version,
  quranAttribution: 'Tanzil',
  categories: [{ id: 'morning', icon: 'sunny-outline', nameAr: 'الصباح', nameEn: 'Morning' }],
  items: ids.map(item),
});

describe('content update that splits one dhikr into several', () => {
  let repo: AthkarRepository;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    repo = TestBed.inject(AthkarRepository);
    repo.useDb(await createFakeDb());
    await repo.seed(dataset(1, ['kursi', 'three-quls', 'asbahna', 'sayyid']));
  });

  const order = async () => (await repo.byCategory('morning')).map((d) => d.id);

  it('puts the new items where the old one was', async () => {
    await repo.seed(dataset(2, ['kursi', 'ikhlas', 'falaq', 'nas', 'asbahna', 'sayyid']));
    expect(await order()).toEqual(['kursi', 'ikhlas', 'falaq', 'nas', 'asbahna', 'sayyid']);
  });

  it("keeps the user's custom order and their own athkar", async () => {
    const mine = await repo.addCustom({ textAr: 'ذكري', meaningEn: '', repeatCount: 1, includeInOverlay: true }, 'morning');
    await repo.reorder(['sayyid', 'kursi', mine.id, 'three-quls', 'asbahna']);
    await repo.seed(dataset(2, ['kursi', 'ikhlas', 'falaq', 'nas', 'asbahna', 'sayyid']));
    expect(await order()).toEqual(['sayyid', 'kursi', 'ikhlas', 'falaq', 'nas', mine.id, 'asbahna']);
  });
});
