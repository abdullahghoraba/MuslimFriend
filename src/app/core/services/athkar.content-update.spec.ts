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

describe('content update with a new default order (version 7)', () => {
  const OLD = ['ayat-al-kursi', 'ikhlas', 'falaq', 'nas', 'asbahna-wa-asbaha-al-mulk', 'bika-asbahna', 'sayyid-al-istighfar', 'ushhiduka',
    'ma-asbaha-bi', 'afini-fi-badani', 'hasbiyallah', 'al-afiyah', 'alim-al-ghayb', 'bismillah-la-yadurr', 'raditu', 'ya-hayyu-ya-qayyum',
    'fathahu-wa-nasrahu', 'fitrat-al-islam', 'shirk-khafi', 'al-hamm-wal-hazan', 'jalal-wajhik', 'abu-ad-darda', 'subhanallahi-wa-bihamdih-100',
    'tahlil-10', 'adada-khalqih', 'ilman-nafian', 'astaghfirullah-100', 'salawat-10'].map((id) => 'morning-' + id);
  const NEW = ['ayat-al-kursi', 'ikhlas', 'falaq', 'nas', 'asbahna-wa-asbaha-al-mulk', 'sayyid-al-istighfar', 'raditu', 'ushhiduka',
    'ma-asbaha-bi', 'hasbiyallah', 'bismillah-la-yadurr', 'bika-asbahna', 'fitrat-al-islam', 'adada-khalqih', 'afini-fi-badani',
    'al-afiyah', 'ya-hayyu-ya-qayyum', 'fathahu-wa-nasrahu', 'alim-al-ghayb', 'salawat-10', 'shirk-khafi', 'al-hamm-wal-hazan',
    'astaghfirullah-100', 'jalal-wajhik', 'tahlil-10', 'abu-ad-darda', 'subhanallahi-wa-bihamdih-100', 'ilman-nafian'].map((id) => 'morning-' + id);
  let repo: AthkarRepository;
  const order = async () => (await repo.byCategory('morning')).map((d) => d.id);

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    repo = TestBed.inject(AthkarRepository);
    repo.useDb(await createFakeDb());
    await repo.seed(dataset(6, OLD));
  });

  it('moves a list still in the old default order to the new one', async () => {
    await repo.seed(dataset(7, NEW));
    expect(await order()).toEqual(NEW);
  });

  it('keeps a list the reader arranged', async () => {
    const mine = [OLD[2], OLD[0], OLD[1], ...OLD.slice(3)];
    await repo.reorder(mine);
    await repo.seed(dataset(7, NEW));
    expect(await order()).toEqual(mine);
  });
});
