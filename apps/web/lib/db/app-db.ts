import fs from "node:fs";
import path from "node:path";
import Database, { type Database as DB } from "better-sqlite3";
import { getConfigDir } from "@/lib/config";

let dbInstance: DB | null = null;

export function getAppDb(): DB {
  if (dbInstance) return dbInstance;
  const dir = process.env.RW_APP_DB_DIR ?? getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "app.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  dbInstance = db;
  return db;
}

function migrate(db: DB): void {
  const current = (db.pragma("user_version", { simple: true }) as number) ?? 0;
  if (current < 1) applyV1(db);
  if (current < 2) applyV2(db);
}

function applyV1(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      username        TEXT UNIQUE NOT NULL,
      password_hash   TEXT NOT NULL,
      display_name    TEXT,
      role            TEXT NOT NULL DEFAULT 'user',
      created_at      TEXT NOT NULL,
      last_login_at   TEXT,
      disabled        INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS manuscripts (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_name       TEXT NOT NULL,
      file_type       TEXT NOT NULL,
      bytes           INTEGER NOT NULL,
      uploaded_at     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'parsing',
      verdict         TEXT,
      totals_json     TEXT,
      metadata_title  TEXT,
      result_path     TEXT,
      policy_version  TEXT,
      generated_at    TEXT,
      error           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_manuscripts_user_time ON manuscripts(user_id, uploaded_at DESC);

    CREATE TABLE IF NOT EXISTS audit_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
      action          TEXT NOT NULL,
      detail_json     TEXT,
      ip              TEXT,
      user_agent      TEXT,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_log(user_id, created_at DESC);
    PRAGMA user_version = 1;
  `);
}

function applyV2(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!cols.includes("avatar_seed")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_seed TEXT");
  }
  if (!cols.includes("llm_settings_json")) {
    db.exec("ALTER TABLE users ADD COLUMN llm_settings_json TEXT");
  }
  db.exec("PRAGMA user_version = 2");
}
