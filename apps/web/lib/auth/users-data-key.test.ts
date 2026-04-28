import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DB } from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: DB;
let tmpDir: string;
let originalDbDir: string | undefined;
let users: typeof import("../db/users");

beforeAll(async () => {
  originalDbDir = process.env.RW_APP_DB_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-auth-users-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  const appDb = await import("../db/app-db");
  users = await import("../db/users");
  db = appDb.getAppDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM email_tokens").run();
  db.prepare("DELETE FROM users").run();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at)
     VALUES ('user-1', 'authuser', 'hash', 'user', ?)`,
  ).run(new Date().toISOString());
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (originalDbDir === undefined) {
    delete process.env.RW_APP_DB_DIR;
  } else {
    process.env.RW_APP_DB_DIR = originalDbDir;
  }
});

describe("production secret handling", () => {
  it("does not encrypt with the development fallback secret in production", () => {
    const saved = snapshotEnv([
      "NODE_ENV",
      "RW_DATA_KEY",
      "RW_DATA_KEY_FILE",
      "RW_SESSION_SECRET",
      "RW_SESSION_SECRET_FILE",
    ]);
    try {
      setEnvValue("NODE_ENV", "production");
      delete process.env.RW_DATA_KEY;
      delete process.env.RW_DATA_KEY_FILE;
      delete process.env.RW_SESSION_SECRET;
      delete process.env.RW_SESSION_SECRET_FILE;

      expect(() =>
        users.setUserLlmSettings("user-1", { enabled: true, apiKey: "secret" }),
      ).toThrow(/requires RW_DATA_KEY or RW_SESSION_SECRET/);
    } finally {
      restoreEnv(saved);
    }
  });
});

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function setEnvValue(key: string, value: string): void {
  process.env[key] = value;
}
