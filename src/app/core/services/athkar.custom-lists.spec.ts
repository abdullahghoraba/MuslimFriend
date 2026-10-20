import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ContentDataset } from '../models';
import { createFakeDb } from '../../testing/fake-sql-db';
import { AthkarRepository } from './athkar.repository';

const dataset = (version: number): ContentDataset => ({
  contentVersion: version,
  quranAttribution: 'Tanzil',
  categories: [
    { id: 'morning', icon: 'sunny-outline', nameAr: 'الصباح', nameEn: 'Morning' },
    { id: 'evening', icon: 'moon-outline', nameAr: 'المساء', nameEn: 'Evening' },
  ],
  items: ['m1', 'm2', 'e1'].map((id) => ({
    id, categoryId: id.startsWith('m') ? 'morning' : 'evening', textAr: `نَص ${id}`, transliteration: '', meaningEn: '',
    repeatCount: 1, virtueAr: '', virtueEn: '', sourceRef: 'ref', grade: '', reviewed: false, isQuran: false,
  })),
});

const input = (text: string) => ({ textAr: text, meaningEn: '', repeatCount: 3, includeInOverlay: true });

describe('custom athkar inside built-in lists', () => {
  let repo: AthkarRepository;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    repo = TestBed.inject(AthkarRepository);
    repo.useDb(await createFakeDb());
    await repo.seed(dataset(1));
  });

  it('appends a new dhikr at the end of the morning list', async () => {
    const added = await repo.addCustom(input('ذكري'), 'morning');
    const ids = (await repo.byCategory('morning')).map((d) => d.id);
    expect(ids).toEqual(['m1', 'm2', added.id]);
    expect(added.isCustom).toBe(true);
  });

  it('keeps it and its position through a content update', async () => {
    const added = await repo.addCustom(input('ذكري'), 'morning');
    await repo.reorder([added.id, 'm1', 'm2']);
    await repo.seed(dataset(2));
    expect((await repo.byCategory('morning')).map((d) => d.id)).toEqual([added.id, 'm1', 'm2']);
  });

  it('moves a custom dhikr to another list (appended at the end)', async () => {
    const added = await repo.addCustom(input('ذكري'), 'morning');
    await repo.updateCustom(added.id, input('ذكري معدل'), 'evening');
    const evening = await repo.byCategory('evening');
    expect(evening.map((d) => d.id)).toEqual(['e1', added.id]);
    expect(evening[1].textAr).toBe('ذكري معدل');
    expect((await repo.byCategory('morning')).some((d) => d.id === added.id)).toBe(false);
  });

  it('lists every custom dhikr and never edits or deletes built-ins', async () => {
    await repo.addCustom(input('أ'), 'morning');
    await repo.addCustom(input('ب'));
    expect((await repo.listCustom()).length).toBe(2);
    await repo.updateCustom('m1', input('تغيير'));
    await repo.deleteCustom('m1');
    const m1 = await repo.byId('m1');
    expect(m1?.textAr).toBe('نَص m1');
  });
});
