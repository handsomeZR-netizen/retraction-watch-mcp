import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DB } from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: DB;
let tmpDir: string;
let originalDbDir: string | undefined;
let tokens: typeof import("../db/email-tokens");

beforeAll(async () => {
  originalDbDir = process.env.RW_APP_DB_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-auth-tokens-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  const appDb = await import("../db/app-db");
  tokens = await import("../db/email-tokens");
  db = appDb.getAppDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM email_tokens").run();
  db.prepare("DELETE FROM users").run();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, email, email_verified)
     VALUES ('user-1', 'authuser', 'hash', 'user', ?, 'auth@example.com', 0)`,
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

describe("email token replay and expiry", () => {
  it("rejects expired email verification tokens", () => {
    const created = tokens.createEmailToken({
      userId: "user-1",
      email: "auth@example.com",
      kind: "verify",
    });
    db.prepare("UPDATE email_tokens SET expires_at = ? WHERE token = ?").run(
      new Date(Date.now() - 60_000).toISOString(),
      created.token,
    );

    expect(tokens.consumeEmailToken(created.token, "verify")).toBeNull();
  });

  it("prevents password reset token replay", () => {
    const created = tokens.createEmailToken({
      userId: "user-1",
      email: "auth@example.com",
      kind: "reset",
    });

    expect(tokens.consumeEmailToken(created.token, "reset")).not.toBeNull();
    expect(tokens.consumeEmailToken(created.token, "reset")).toBeNull();
  });

  it("prevents email verification magic link double-spend", () => {
    const created = tokens.createEmailToken({
      userId: "user-1",
      email: "auth@example.com",
      kind: "verify",
    });

    expect(tokens.consumeEmailToken(created.token, "verify")).not.toBeNull();
    expect(tokens.consumeEmailToken(created.token, "verify")).toBeNull();
  });
});
