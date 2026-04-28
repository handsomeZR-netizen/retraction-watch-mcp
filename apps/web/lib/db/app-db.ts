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
  // Wrap each migration step in its own transaction so a partial failure
  // rolls back instead of leaving the schema half-applied with an advanced
  // user_version. better-sqlite3's db.transaction returns a callable that
  // executes synchronously inside BEGIN/COMMIT (or ROLLBACK on throw).
  const inTx = (fn: (db: DB) => void) => db.transaction(() => fn(db))();
  if (current < 1) inTx(applyV1);
  if (current < 2) inTx(applyV2);
  if (current < 3) inTx(applyV3);
  if (current < 4) inTx(applyV4);
  if (current < 5) inTx(applyV5);
  if (current < 6) inTx(applyV6);
  if (current < 7) inTx(applyV7);
  if (current < 8) inTx(applyV8);
  if (current < 9) inTx(applyV9);
  if (current < 10) inTx(applyV10);
  if (current < 11) inTx(applyV11);
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

function applyV3(db: DB): void {
  const userCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!userCols.includes("email")) db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  if (!userCols.includes("email_verified"))
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
  if (!userCols.includes("active_workspace_id"))
    db.exec("ALTER TABLE users ADD COLUMN active_workspace_id TEXT");

  const manuscriptCols = (db.prepare("PRAGMA table_info(manuscripts)").all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!manuscriptCols.includes("workspace_id"))
    db.exec("ALTER TABLE manuscripts ADD COLUMN workspace_id TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT UNIQUE NOT NULL,
      owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role         TEXT NOT NULL DEFAULT 'member',
      joined_at    TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

    CREATE TABLE IF NOT EXISTS workspace_invites (
      token        TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      invited_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role         TEXT NOT NULL DEFAULT 'member',
      created_at   TEXT NOT NULL,
      expires_at   TEXT,
      used_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
      used_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS oauth_identities (
      provider     TEXT NOT NULL,
      provider_id  TEXT NOT NULL,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email        TEXT,
      username     TEXT,
      avatar_url   TEXT,
      linked_at    TEXT NOT NULL,
      PRIMARY KEY (provider, provider_id)
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_identities(user_id);

    CREATE TABLE IF NOT EXISTS email_tokens (
      token        TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL,
      email        TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      expires_at   TEXT NOT NULL,
      used_at      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_manuscripts_workspace_time ON manuscripts(workspace_id, uploaded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    PRAGMA user_version = 3;
  `);
}

function applyV4(db: DB): void {
  const manuscriptCols = (db.prepare("PRAGMA table_info(manuscripts)").all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!manuscriptCols.includes("sha256")) db.exec("ALTER TABLE manuscripts ADD COLUMN sha256 TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS screening_logs (
      id                TEXT PRIMARY KEY,
      user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
      workspace_id      TEXT,
      scope             TEXT NOT NULL,
      file_name         TEXT NOT NULL,
      file_type         TEXT NOT NULL,
      bytes             INTEGER NOT NULL,
      sha256            TEXT,
      title             TEXT,
      authors_json      TEXT NOT NULL,
      affiliations_json TEXT,
      emails_json       TEXT,
      verdict           TEXT NOT NULL,
      refs_total        INTEGER NOT NULL DEFAULT 0,
      refs_confirmed    INTEGER NOT NULL DEFAULT 0,
      refs_likely       INTEGER NOT NULL DEFAULT 0,
      refs_possible     INTEGER NOT NULL DEFAULT 0,
      authors_confirmed INTEGER NOT NULL DEFAULT 0,
      authors_likely    INTEGER NOT NULL DEFAULT 0,
      authors_possible  INTEGER NOT NULL DEFAULT 0,
      hit_summary_json  TEXT,
      llm_calls         INTEGER NOT NULL DEFAULT 0,
      policy_version    TEXT,
      created_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_screening_logs_user_time ON screening_logs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_screening_logs_verdict ON screening_logs(verdict, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_screening_logs_workspace ON screening_logs(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_screening_logs_sha256 ON screening_logs(sha256);
    CREATE INDEX IF NOT EXISTS idx_manuscripts_sha256 ON manuscripts(sha256);

    PRAGMA user_version = 4;
  `);
}

function applyV5(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(manuscripts)").all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!cols.includes("project_id")) db.exec("ALTER TABLE manuscripts ADD COLUMN project_id TEXT");
  if (!cols.includes("archived"))
    db.exec("ALTER TABLE manuscripts ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      color        TEXT,
      owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id TEXT,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_manuscripts_project ON manuscripts(project_id);
    CREATE INDEX IF NOT EXISTS idx_manuscripts_archived ON manuscripts(archived, uploaded_at DESC);
    PRAGMA user_version = 5;
  `);
}

function applyV6(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(manuscripts)").all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!cols.includes("parse_job_id")) db.exec("ALTER TABLE manuscripts ADD COLUMN parse_job_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_manuscripts_parse_job ON manuscripts(parse_job_id)");
  db.exec("PRAGMA user_version = 6");
}

function applyV7(db: DB): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_screening_logs_created_id
      ON screening_logs(created_at DESC, id DESC);
    PRAGMA user_version = 7;
  `);
}

function applyV11(db: DB): void {
  // FTS5 virtual table for screening_logs full-text search. The previous
  // LIKE %query% across file_name + title + authors_json scanned every row
  // (1.5s+ at 1000 rows). FTS5 with unicode61 + diacritic folding keeps
  // search under 50ms on the same data and gives prefix matching for free.
  //
  // The contentless table mirrors id (rowid surrogate) + the three searchable
  // columns. A pair of triggers keeps it in sync with screening_logs writes.
  // On migration we backfill from existing rows in one INSERT. The unicode61
  // tokenizer handles CJK/Latin/RTL well enough for our small-team scale.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS screening_logs_fts USING fts5(
      log_id UNINDEXED,
      file_name,
      title,
      authors_json,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    -- Backfill from any existing rows. INSERT OR IGNORE in case the FTS
    -- table already had rows from a previous half-applied migration.
    INSERT OR IGNORE INTO screening_logs_fts (log_id, file_name, title, authors_json)
      SELECT id, COALESCE(file_name, ''), COALESCE(title, ''), COALESCE(authors_json, '')
        FROM screening_logs;

    CREATE TRIGGER IF NOT EXISTS screening_logs_fts_ai
    AFTER INSERT ON screening_logs BEGIN
      INSERT INTO screening_logs_fts (log_id, file_name, title, authors_json)
        VALUES (new.id, COALESCE(new.file_name, ''), COALESCE(new.title, ''), COALESCE(new.authors_json, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS screening_logs_fts_ad
    AFTER DELETE ON screening_logs BEGIN
      DELETE FROM screening_logs_fts WHERE log_id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS screening_logs_fts_au
    AFTER UPDATE ON screening_logs BEGIN
      DELETE FROM screening_logs_fts WHERE log_id = old.id;
      INSERT INTO screening_logs_fts (log_id, file_name, title, authors_json)
        VALUES (new.id, COALESCE(new.file_name, ''), COALESCE(new.title, ''), COALESCE(new.authors_json, ''));
    END;

    PRAGMA user_version = 11;
  `);
}

function applyV10(db: DB): void {
  // Two small-team workflow features:
  //   1. assignee_user_id: per-manuscript reviewer assignment (workspace
  //      scope only; references users(id) but ON DELETE SET NULL).
  //   2. manuscript_shares: revocable read-only share tokens with TTL so a
  //      reviewer outside the workspace can see a single result page
  //      without an account.
  const cols = (db.prepare("PRAGMA table_info(manuscripts)").all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!cols.includes("assignee_user_id")) {
    db.exec("ALTER TABLE manuscripts ADD COLUMN assignee_user_id TEXT");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_manuscripts_assignee
      ON manuscripts(assignee_user_id);

    CREATE TABLE IF NOT EXISTS manuscript_shares (
      token         TEXT PRIMARY KEY,
      manuscript_id TEXT NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
      created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at    TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      revoked_at    TEXT,
      last_viewed_at TEXT,
      view_count    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_shares_manuscript ON manuscript_shares(manuscript_id);
    CREATE INDEX IF NOT EXISTS idx_shares_expiry ON manuscript_shares(expires_at);

    PRAGMA user_version = 10;
  `);
}

function applyV9(db: DB): void {
  // Free-form per-manuscript notes for small-team review workflow:
  // "已发邮件给作者询问 X" / "等同事张三复核" / etc.
  // Visible to anyone who can canAccessManuscript; capped at 4000 chars.
  const cols = (db.prepare("PRAGMA table_info(manuscripts)").all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!cols.includes("notes")) {
    db.exec("ALTER TABLE manuscripts ADD COLUMN notes TEXT");
  }
  if (!cols.includes("notes_updated_at")) {
    db.exec("ALTER TABLE manuscripts ADD COLUMN notes_updated_at TEXT");
  }
  if (!cols.includes("notes_updated_by")) {
    db.exec("ALTER TABLE manuscripts ADD COLUMN notes_updated_by TEXT");
  }
  db.exec("PRAGMA user_version = 9");
}

function applyV8(db: DB): void {
  // Add ip_hash column to audit_log so we can store a privacy-preserving
  // hash of the client IP instead of the raw value. The legacy ip column
  // is kept for backward compatibility but is no longer written by new
  // code; cleanup will eventually prune those rows.
  const cols = (db.prepare("PRAGMA table_info(audit_log)").all() as { name: string }[]).map(
    (r) => r.name,
  );
  if (!cols.includes("ip_hash")) {
    db.exec("ALTER TABLE audit_log ADD COLUMN ip_hash TEXT");
  }
  db.exec("PRAGMA user_version = 8");
}
