import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { DatabaseService } from '../db/database.service';
import { createFakeDb, StatementRecordingDb } from '../../testing/fake-sql-db';
import { AthkarRepository } from './athkar.repository';
import { OverlayService } from './overlay.service';
import { ProgressService } from './progress.service';
describe('Collection overlay selection', () => {
  it('includes selected collection athkar and excludes unselected collections', async () => {
    const db = await createFakeDb();
    expect(db).not.toBeInstanceOf(StatementRecordingDb);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: DatabaseService, useValue: db },
        { provide: ProgressService, useValue: {} },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });
    const repository = TestBed.inject(AthkarRepository);
    const selected = await repository.addCollection('Selected', 'book-outline');
    const other = await repository.addCollection('Other', 'moon-outline');
    await repository.addCustom(
      { textAr: 'ذِكر', meaningEn: '', repeatCount: 2, includeInOverlay: true },
      selected.id,
    );
    await repository.addCustom(
      { textAr: 'آخر', meaningEn: '', repeatCount: 1, includeInOverlay: true },
      other.id,
    );
    const service = TestBed.inject(OverlayService);
    await service.update({ categories: [selected.id] });
    expect(await service.syncPool()).toBe(1);
    await service.update({ categories: [] });
    expect(await service.syncPool()).toBe(0);
  });
});
