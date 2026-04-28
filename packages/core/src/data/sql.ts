import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

export type SqlValue = string | number | bigint | Buffer | null;
export type SqlBindParams = SqlValue[] | Record<string, SqlValue>;

export class SqlDatabase {
  constructor(private readonly handle: Database.Database) {}

  exec(sql: string): void {
    this.handle.exec(sql);
  }

  close(): void {
    this.handle.close();
  }

  raw(): Database.Database {
    return this.handle;
  }
}

export async function openSqliteFile(dbPath: string): Promise<SqlDatabase> {
  const handle = new Database(dbPath, { readonly: true, fileMustExist: true });
  handle.pragma("foreign_keys = ON");
  return new SqlDatabase(handle);
}

export async function createEmptySqlite(): Promise<SqlDatabase> {
  const handle = new Database(":memory:");
  handle.pragma("foreign_keys = ON");
  return new SqlDatabase(handle);
}

export async function saveSqliteFile(
  db: SqlDatabase,
  dbPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.rm(dbPath, { force: true });
  await db.raw().backup(dbPath);
}

export function getRows<T extends object>(
  db: SqlDatabase,
  sql: string,
  params?: SqlBindParams,
): T[] {
  const stmt = db.raw().prepare(sql);
  const rows = params === undefined ? stmt.all() : stmt.all(...toPositional(params));
  return rows as T[];
}

export function getOne<T extends object>(
  db: SqlDatabase,
  sql: string,
  params?: SqlBindParams,
): T | null {
  const stmt = db.raw().prepare(sql);
  const row = params === undefined ? stmt.get() : stmt.get(...toPositional(params));
  return (row ?? null) as T | null;
}

export function runMany(
  db: SqlDatabase,
  sql: string,
  rows: SqlBindParams[],
): void {
  const stmt = db.raw().prepare(sql);
  for (const row of rows) {
    stmt.run(...toPositional(row));
  }
}

export function runInTransaction<T>(db: SqlDatabase, fn: () => T): T {
  const wrapped = db.raw().transaction(fn);
  return wrapped();
}

function toPositional(params: SqlBindParams): SqlValue[] {
  if (Array.isArray(params)) {
    return params.map(coerce);
  }
  return Object.values(params).map(coerce);
}

function coerce(value: unknown): SqlValue {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    Buffer.isBuffer(value) ||
    value === null
  ) {
    return value as SqlValue;
  }
  return String(value);
}
