/// <reference types="node" />
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
// sql.js is installed transitively; its package does not ship TypeScript declarations.
// @ts-ignore -- no additional @types dependency is needed for this test helper.
import initSqlJs from 'sql.js';
import type { SqlDb } from '../core/db/database.service';
import { MIGRATIONS } from '../core/db/migrations';

type Statement = { sql: string; params?: unknown[] };
interface SqlStatement {
  bind(params: unknown[]): void;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}
interface MemoryDatabase {
  run(sql: string, params?: unknown[]): void;
  prepare(sql: string): SqlStatement;
  getRowsModified(): number;
}

/** Diagnostic fallback only: recorded statements do not simulate SQLite results. */
export class StatementRecordingDb implements SqlDb {
  readonly statements: Statement[] = [];
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.statements.push({ sql, params: [...params] });
    return [];
  }
  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    this.statements.push({ sql, params: [...params] });
    return { changes: 0 };
  }
  async batch(statements: Statement[]): Promise<void> {
    await this.run('BEGIN');
    try {
      for (const statement of statements) await this.run(statement.sql, statement.params);
      await this.run('COMMIT');
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }
}

/** New, isolated SQLite database with the application's real schema. */
export async function createFakeDb(): Promise<SqlDb> {
  let sqlite: MemoryDatabase;
  try {
    const require = createRequire(import.meta.url);
    const locateFile = (file: string): string => require.resolve('sql.js/dist/' + file);
    const SQL = await initSqlJs({
      locateFile,
      // Supplying bytes also works when the bundler selects sql.js's browser export.
      wasmBinary: readFileSync(locateFile('sql-wasm.wasm')),
    });
    sqlite = new SQL.Database();
  } catch (error) {
    console.error('sql.js could not load: falling back to StatementRecordingDb. SQLite behavior tests cannot be validated with this fallback.', error);
    const fallback = new StatementRecordingDb();
    await fallback.batch(MIGRATIONS.flatMap(m => m.statements.map(sql => ({ sql }))));
    return fallback;
  }
  const db: SqlDb = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const statement = sqlite.prepare(sql);
      try {
        statement.bind(params);
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        return rows;
      } finally {
        statement.free();
      }
    },
    async run(sql: string, params: unknown[] = []) {
      sqlite.run(sql, params);
      const changes = sqlite.getRowsModified();
      const [row] = await db.query<{ id: number }>('SELECT last_insert_rowid() AS id');
      return { changes, lastId: row.id };
    },
    async batch(statements: Statement[]) {
      sqlite.run('BEGIN');
      try {
        for (const statement of statements) sqlite.run(statement.sql, statement.params ?? []);
        sqlite.run('COMMIT');
      } catch (error) {
        sqlite.run('ROLLBACK');
        throw error;
      }
    },
  };
  await db.batch(MIGRATIONS.flatMap(m => m.statements.map(sql => ({ sql }))));
  return db;
}
