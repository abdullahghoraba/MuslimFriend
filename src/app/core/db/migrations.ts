export interface Migration {
  version: number;
  statements: string[];
}

/** Append-only. Never edit a migration that has shipped; add a new one instead. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS athkar (
        id TEXT PRIMARY KEY NOT NULL,
        category_id TEXT NOT NULL,
        text_ar TEXT NOT NULL,
        transliteration TEXT NOT NULL DEFAULT '',
        meaning_en TEXT NOT NULL DEFAULT '',
        repeat_count INTEGER NOT NULL DEFAULT 1,
        virtue_ar TEXT NOT NULL DEFAULT '',
        virtue_en TEXT NOT NULL DEFAULT '',
        source_ref TEXT NOT NULL DEFAULT '',
        grade TEXT NOT NULL DEFAULT '',
        reviewed INTEGER NOT NULL DEFAULT 0,
        is_quran INTEGER NOT NULL DEFAULT 0,
        quran_ref TEXT,
        is_custom INTEGER NOT NULL DEFAULT 0,
        include_in_overlay INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0
      );`,
      `CREATE INDEX IF NOT EXISTS idx_athkar_category ON athkar (category_id, sort_order);`,
      // Daily per-dhikr counts. source = 'app' | 'overlay'.
      `CREATE TABLE IF NOT EXISTS dhikr_daily (
        date TEXT NOT NULL,
        dhikr_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'app',
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, dhikr_id, source)
      );`,
      // A row exists once every dhikr in the category reached its repeat count that day.
      `CREATE TABLE IF NOT EXISTS category_daily (
        date TEXT NOT NULL,
        category_id TEXT NOT NULL,
        completed_at INTEGER NOT NULL,
        PRIMARY KEY (date, category_id)
      );`,
      `CREATE TABLE IF NOT EXISTS tasbih_counter (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        target INTEGER NOT NULL DEFAULT 33,
        count INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0
      );`,
      `CREATE TABLE IF NOT EXISTS tasbih_daily (
        date TEXT NOT NULL,
        counter_id INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, counter_id)
      );`,
      `CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );`,
    ],
  },
  { version: 2, statements: [
    `CREATE TABLE IF NOT EXISTS quran_bookmark (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, color TEXT, sura INTEGER, aya INTEGER, page INTEGER, updated_at INTEGER);`,
    `CREATE TABLE IF NOT EXISTS quran_mark (sura INTEGER, aya INTEGER, kind TEXT CHECK(kind IN ('star','highlight','note')), color TEXT, tag TEXT, note TEXT, created_at INTEGER, PRIMARY KEY (sura, aya, kind));`,
    `CREATE TABLE IF NOT EXISTS khatmah (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, start_page INTEGER, target_days INTEGER, started_on TEXT, current_page INTEGER, completed_at INTEGER NULL, created_at INTEGER);`,
    `CREATE TABLE IF NOT EXISTS quran_reading_log (date TEXT, page INTEGER, PRIMARY KEY(date, page));`,
  ] },
  { version: 3, statements: [
    `CREATE TABLE IF NOT EXISTS user_category (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'layers-outline', show_on_home INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);`,
    `CREATE TABLE IF NOT EXISTS home_hidden (category_id TEXT PRIMARY KEY);`,
  ] },
  { version: 4, statements: [
    `ALTER TABLE athkar ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`,
  ] },
  { version: 5, statements: [
    `ALTER TABLE athkar ADD COLUMN repeat_override INTEGER NULL;`,
  ] },
  {
    version: 6,
    statements: [
      `CREATE TABLE IF NOT EXISTS hifz_plan (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL, from_sura INTEGER, from_aya INTEGER, to_sura INTEGER, to_aya INTEGER, daily_new INTEGER NOT NULL DEFAULT 5, follow_up INTEGER NOT NULL DEFAULT 1, created_at INTEGER, archived INTEGER NOT NULL DEFAULT 0);`,
      `CREATE TABLE IF NOT EXISTS hifz_ayah (plan_id INTEGER, sura INTEGER, aya INTEGER, status TEXT CHECK(status IN ('learning','memorized')), memorized_on TEXT NULL, last_review TEXT NULL, next_review TEXT NULL, reviews INTEGER NOT NULL DEFAULT 0, step INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(plan_id, sura, aya));`,
      `CREATE TABLE IF NOT EXISTS hifz_log (date TEXT, plan_id INTEGER, kind TEXT CHECK(kind IN ('new','review')), ayat INTEGER, PRIMARY KEY(date, plan_id, kind));`,
    ],
  },
  // Saved hadith keep their text, so the list can be read and searched without downloading the book.
  { version: 7, statements: [
    `CREATE TABLE IF NOT EXISTS hadith_bookmark (collection TEXT NOT NULL, number TEXT NOT NULL, book INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, arabic TEXT NOT NULL DEFAULT '', translation TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', PRIMARY KEY(collection, number));`,
  ] },
];
