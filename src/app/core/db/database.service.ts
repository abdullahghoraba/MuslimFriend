import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { MIGRATIONS } from './migrations';

const DB_NAME = 'muslimfriend';

/** Minimal SQL surface the repositories depend on, so they can be unit-tested with a fake. */
export interface SqlDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastId?: number }>;
  /** Runs several statements atomically. */
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class DatabaseService implements SqlDb {
  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private db?: SQLiteDBConnection;
  private ready?: Promise<void>;

  /** Opens the database and applies pending migrations. Safe to call repeatedly. */
  init(): Promise<void> {
    this.ready ??= this.open();
    return this.ready;
  }

  private async open(): Promise<void> {
    if (Capacitor.getPlatform() === 'web') {
      // Browser dev mode only: jeep-sqlite keeps the DB in IndexedDB.
      const { defineCustomElements } = await import('jeep-sqlite/loader');
      await defineCustomElements(window);
      if (!document.querySelector('jeep-sqlite')) {
        document.body.appendChild(document.createElement('jeep-sqlite'));
      }
      await customElements.whenDefined('jeep-sqlite');
      await this.sqlite.initWebStore();
    }

    const consistent = (await this.sqlite.checkConnectionsConsistency()).result;
    const exists = (await this.sqlite.isConnection(DB_NAME, false)).result;
    this.db = consistent && exists
      ? await this.sqlite.retrieveConnection(DB_NAME, false)
      : await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
    await this.db.open();
    await this.migrate();
  }

  private async migrate(): Promise<void> {
    const db = this.db!;
    await db.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);', false);
    const rows = (await db.query('SELECT version FROM schema_version LIMIT 1;')).values ?? [];
    let current = rows.length ? Number(rows[0].version) : 0;
    if (!rows.length) await db.run('INSERT INTO schema_version (version) VALUES (0);', [], false);

    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      await db.executeSet(
        [
          ...migration.statements.map((statement) => ({ statement, values: [] })),
          { statement: 'UPDATE schema_version SET version = ?;', values: [migration.version] },
        ],
        true,
      );
      current = migration.version;
    }
    await this.persistWeb();
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.init();
    return ((await this.db!.query(sql, params)).values ?? []) as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastId?: number }> {
    await this.init();
    const res = await this.db!.run(sql, params, true);
    await this.persistWeb();
    return { changes: res.changes?.changes ?? 0, lastId: res.changes?.lastId };
  }

  async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    if (!statements.length) return;
    await this.init();
    await this.db!.executeSet(
      statements.map((s) => ({ statement: s.sql, values: s.params ?? [] })),
      true,
    );
    await this.persistWeb();
  }

  /** jeep-sqlite only writes to IndexedDB when asked; native writes are immediate. */
  private async persistWeb(): Promise<void> {
    if (Capacitor.getPlatform() === 'web') await this.sqlite.saveToStore(DB_NAME);
  }
}
