import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import initSqlJs from "sql.js";

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;
const require = createRequire(import.meta.url);
let sqlWasmDir: string | null = null;

export type SqlDatabase = initSqlJs.Database;
export type SqlValue = initSqlJs.SqlValue;

export async function getSqlJs() {
  sqlPromise ??= initSqlJs({
    locateFile: (file) => path.join(getSqlWasmDir(), file),
  });
  return sqlPromise;
}

function getSqlWasmDir(): string {
  sqlWasmDir ??= path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
  return sqlWasmDir;
}

export async function openSqliteFile(dbPath: string): Promise<SqlDatabase> {
  const SQL = await getSqlJs();
  const bytes = await fs.readFile(dbPath);
  return new SQL.Database(bytes);
}

export async function createEmptySqlite(): Promise<SqlDatabase> {
  const SQL = await getSqlJs();
  return new SQL.Database();
}

export async function saveSqliteFile(db: SqlDatabase, dbPath: string): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, Buffer.from(db.export()));
}

export function getRows<T extends object>(
  db: SqlDatabase,
  sql: string,
  params?: initSqlJs.BindParams,
): T[] {
  const stmt = db.prepare(sql);
  try {
    if (params) {
      stmt.bind(params);
    }

    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    return rows;
  } finally {
    stmt.free();
  }
}

export function getOne<T extends object>(
  db: SqlDatabase,
  sql: string,
  params?: initSqlJs.BindParams,
): T | null {
  return getRows<T>(db, sql, params)[0] ?? null;
}

export function runMany(
  db: SqlDatabase,
  sql: string,
  rows: initSqlJs.BindParams[],
): void {
  const stmt = db.prepare(sql);
  try {
    for (const row of rows) {
      stmt.run(row);
    }
  } finally {
    stmt.free();
  }
}
