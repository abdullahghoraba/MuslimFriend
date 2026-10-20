import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { DatabaseService, SqlDb } from '../db/database.service';
import { AppSettings } from '../models';
import { AthkarRepository } from './athkar.repository';
import { SettingsService } from './settings.service';

type Row = Record<string, string | number | null>;
export interface BackupFile {
  app: 'muslim-friend' | 'muslim-athkar';
  formatVersion: 1;
  exportedAt: string;
  settings: AppSettings;
  extraPreferences: Record<string, string>;
  data: {
    userCategories?: Row[];
    homeHidden?: Row[];
    customAthkar: Row[];
    userOrder: Row[];
    dhikrDaily: Row[];
    categoryDaily: Row[];
    tasbihCounters: Row[];
    tasbihDaily: Row[];
    quranBookmarks?: Row[];
    quranMarks?: Row[];
    khatmah?: Row[];
    quranReadingLog?: Row[];
  };
}
export class BackupError extends Error {
  constructor(readonly code: 'invalid' | 'version' | 'app') {
    super(code);
    this.name = 'BackupError';
  }
}

type Check = (value: unknown) => boolean;
const str: Check = (v) => typeof v === 'string';
const id: Check = (v) => str(v) && (v as string).length > 0;
const integer: Check = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const nonnegative: Check = (v) => integer(v) && (v as number) >= 0;
const flag: Check = (v) => v === 0 || v === 1;
const date: Check = (v) => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v as string);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const schemas: Record<keyof BackupFile['data'], Record<string, Check>> = {
  userCategories: {
    id,
    name: id,
    icon: id,
    show_on_home: flag,
    sort_order: integer,
    created_at: nonnegative,
  },
  homeHidden: { category_id: id },
  customAthkar: {
    id,
    category_id: id,
    text_ar: str,
    transliteration: str,
    meaning_en: str,
    repeat_count: (v) => integer(v) && (v as number) >= 1 && (v as number) <= 10000,
    virtue_ar: str,
    virtue_en: str,
    source_ref: str,
    grade: str,
    reviewed: flag,
    is_quran: flag,
    quran_ref: (v) => v === null || str(v),
    is_custom: (v) => v === 1,
    include_in_overlay: flag,
    sort_order: integer,
    created_at: nonnegative,
  },
  userOrder: { id, sort_order: integer, include_in_overlay: flag },
  dhikrDaily: {
    date,
    dhikr_id: id,
    source: (v) => v === 'app' || v === 'overlay',
    count: nonnegative,
  },
  categoryDaily: { date, category_id: id, completed_at: nonnegative },
  tasbihCounters: {
    id: (v) => integer(v) && (v as number) > 0,
    name: str,
    target: (v) => nonnegative(v) && (v as number) <= 100000,
    count: nonnegative,
    sort_order: integer,
    created_at: nonnegative,
  },
  tasbihDaily: { date, counter_id: (v) => integer(v) && (v as number) > 0, count: nonnegative },
  quranBookmarks: {
    id: nonnegative,
    name: str,
    color: (v) => ['green', 'blue', 'gold', 'red', 'purple'].includes(v as string),
    sura: (v) => integer(v) && Number(v) >= 1 && Number(v) <= 114,
    aya: (v) => integer(v) && Number(v) >= 1 && Number(v) <= 286,
    page: (v) => integer(v) && Number(v) >= 1 && Number(v) <= 604,
    updated_at: nonnegative,
  },
  quranMarks: {
    sura: (v) => integer(v) && Number(v) >= 1 && Number(v) <= 114,
    aya: (v) => integer(v) && Number(v) >= 1 && Number(v) <= 286,
    kind: (v) => ['star', 'highlight', 'note'].includes(v as string),
    color: (v) => v === null || ['green', 'blue', 'gold', 'red', 'purple'].includes(v as string),
    tag: (v) => v === null || str(v),
    note: (v) => v === null || str(v),
    created_at: nonnegative,
  },
  khatmah: {
    id: nonnegative,
    name: str,
    start_page: (v) => integer(v) && Number(v) >= 1 && Number(v) <= 604,
    target_days: (v) => integer(v) && Number(v) >= 1,
    started_on: date,
    current_page: (v) => integer(v) && Number(v) >= 0 && Number(v) <= 604,
    completed_at: (v) => v === null || nonnegative(v),
    created_at: nonnegative,
  },
  quranReadingLog: { date, page: (v) => integer(v) && Number(v) >= 1 && Number(v) <= 604 },
};
const optionalTables = [
  'userCategories',
  'homeHidden',
  'quranBookmarks',
  'quranMarks',
  'khatmah',
  'quranReadingLog',
];
function fields(value: unknown, schema: Record<string, Check>): boolean {
  return (
    record(value) &&
    Object.keys(value).length === Object.keys(schema).length &&
    Object.entries(schema).every(([key, check]) => Object.hasOwn(value, key) && check(value[key]))
  );
}
function validate(value: unknown): asserts value is BackupFile {
  if (!record(value)) throw new BackupError('invalid');
  // 'muslim-athkar' = backups made before the app was renamed.
  if (value['app'] !== 'muslim-friend' && value['app'] !== 'muslim-athkar') throw new BackupError('app');
  if (value['formatVersion'] !== 1) throw new BackupError('version');
  if (
    !fields(value, {
      app: () => true,
      formatVersion: () => true,
      exportedAt: (v) =>
        str(v) &&
        /^\d{4}-\d{2}-\d{2}T/.test(v as string) &&
        Number.isFinite(Date.parse(v as string)),
      settings: (v) =>
        fields(v, {
          language: (x) => x === 'ar' || x === 'en',
          theme: (x) => ['system', 'light', 'dark'].includes(x as string),
          fontScale: (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0.8 && x <= 2,
          haptics: (x) => typeof x === 'boolean',
          onboardingDone: (x) => typeof x === 'boolean',
        }),
      extraPreferences: (v) =>
        record(v) && Object.entries(v).every(([k, x]) => k !== 'settings' && str(x)),
      data: (v) =>
        record(v) &&
        Object.keys(v).every((key) => Object.hasOwn(schemas, key)) &&
        Object.entries(schemas).every(
          ([key, schema]) =>
            (!Object.hasOwn(v, key) && optionalTables.includes(key)) ||
            (Array.isArray(v[key]) && (v[key] as unknown[]).every((row) => fields(row, schema))),
        ),
    })
  )
    throw new BackupError('invalid');
}

@Injectable({ providedIn: 'root' })
export class BackupService {
  private db: SqlDb = inject(DatabaseService);
  private readonly athkar = inject(AthkarRepository);
  private readonly settings = inject(SettingsService);
  useDb(db: SqlDb): void {
    this.db = db;
  }

  async buildBackup(): Promise<BackupFile> {
    const extraPreferences: Record<string, string> = Object.create(null);
    for (const key of (await Preferences.keys()).keys) {
      if (key === 'settings') continue;
      const { value } = await Preferences.get({ key });
      if (value !== null) extraPreferences[key] = value;
    }
    return {
      app: 'muslim-friend',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...this.settings.settings() },
      extraPreferences,
      data: {
        userCategories: await this.db.query<Row>(
          'SELECT * FROM user_category ORDER BY sort_order, created_at, id',
        ),
        homeHidden: await this.db.query<Row>('SELECT * FROM home_hidden ORDER BY category_id'),
        customAthkar: await this.db.query<Row>(
          'SELECT * FROM athkar WHERE is_custom = 1 ORDER BY id',
        ),
        userOrder: await this.db.query<Row>(
          'SELECT id, sort_order, include_in_overlay FROM athkar WHERE is_custom = 0 ORDER BY id',
        ),
        dhikrDaily: await this.db.query<Row>(
          'SELECT * FROM dhikr_daily ORDER BY date, dhikr_id, source',
        ),
        categoryDaily: await this.db.query<Row>(
          'SELECT * FROM category_daily ORDER BY date, category_id',
        ),
        tasbihCounters: await this.db.query<Row>('SELECT * FROM tasbih_counter ORDER BY id'),
        tasbihDaily: await this.db.query<Row>(
          'SELECT * FROM tasbih_daily ORDER BY date, counter_id',
        ),
        quranBookmarks: await this.db.query<Row>('SELECT * FROM quran_bookmark ORDER BY id'),
        quranMarks: await this.db.query<Row>('SELECT * FROM quran_mark ORDER BY sura, aya, kind'),
        khatmah: await this.db.query<Row>('SELECT * FROM khatmah ORDER BY id'),
        quranReadingLog: await this.db.query<Row>(
          'SELECT * FROM quran_reading_log ORDER BY date, page',
        ),
      },
    };
  }

  async restore(json: unknown): Promise<void> {
    validate(json);
    const statements: { sql: string; params?: unknown[] }[] = [
      { sql: 'DELETE FROM athkar WHERE is_custom = 1' },
      ...[
        'user_category',
        'home_hidden',
        'dhikr_daily',
        'category_daily',
        'tasbih_counter',
        'tasbih_daily',
        'quran_bookmark',
        'quran_mark',
        'khatmah',
        'quran_reading_log',
      ].map((table) => ({ sql: 'DELETE FROM ' + table })),
    ];
    const tables = {
      userCategories: 'user_category',
      homeHidden: 'home_hidden',
      customAthkar: 'athkar',
      dhikrDaily: 'dhikr_daily',
      categoryDaily: 'category_daily',
      tasbihCounters: 'tasbih_counter',
      tasbihDaily: 'tasbih_daily',
      quranBookmarks: 'quran_bookmark',
      quranMarks: 'quran_mark',
      khatmah: 'khatmah',
      quranReadingLog: 'quran_reading_log',
    } as const;
    for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
      const columns = Object.keys(schemas[key]);
      for (const row of json.data[key] ?? [])
        statements.push({
          sql:
            'INSERT INTO ' +
            tables[key] +
            ' (' +
            columns.join(',') +
            ') VALUES (' +
            columns.map(() => '?').join(',') +
            ')',
          params: columns.map((column) => row[column]),
        });
    }
    for (const row of json.data.userOrder)
      statements.push({
        sql: 'UPDATE athkar SET sort_order = ?, include_in_overlay = ? WHERE id = ? AND is_custom = 0',
        params: [row['sort_order'], row['include_in_overlay'], row['id']],
      });
    await this.db.batch(statements);
    await this.athkar.refreshCategories();
    // Preferences are separate storage and cannot participate in the SQLite transaction.
    await this.settings.reset();
    await this.settings.update(json.settings);
    for (const [key, value] of Object.entries(json.extraPreferences))
      await Preferences.set({ key, value });
  }

  async exportToFile(): Promise<void> {
    const data = JSON.stringify(await this.buildBackup(), null, 2);
    const name = 'muslim-friend-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    if (Capacitor.isNativePlatform()) {
      const { uri } = await Filesystem.writeFile({
        path: name,
        data,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({ files: [uri] });
    } else {
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
  }

  async importFromFile(file: File): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      throw new BackupError('invalid');
    }
    await this.restore(json);
  }

  async resetAll(): Promise<void> {
    await this.db.batch(
      [
        'user_category',
        'home_hidden',
        'athkar',
        'dhikr_daily',
        'category_daily',
        'tasbih_counter',
        'tasbih_daily',
        'meta',
      ].map((table) => ({ sql: 'DELETE FROM ' + table })),
    );
    await this.settings.reset();
    location.reload();
  }
}
