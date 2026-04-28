import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DB } from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Tokens from "./email-tokens";

let db: DB;
let tokens: typeof Tokens;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-tokens-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  process.env.RW_DATA_KEY = "a".repeat(64);
  const appDb = await import("./app-db");
  tokens = await import("./email-tokens");
  db = appDb.getAppDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM email_tokens").run();
  db.prepare("DELETE FROM users").run();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('user-1', 'u1', 'h', 'user', ?)",
  ).run(new Date().toISOString());
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("email-tokens consume atomicity", () => {
  it("returns the row on first consume and null on the second", () => {
    const created = tokens.createEmailToken({
      userId: "user-1",
      email: "x@example.com",
      kind: "verify",
    });
    const first = tokens.consumeEmailToken(created.token, "verify");
    expect(first).not.toBeNull();
    expect(first?.email).toBe("x@example.com");

    const second = tokens.consumeEmailToken(created.token, "verify");
    expect(second).toBeNull();
  });

  it("rejects an expired token", () => {
    const created = tokens.createEmailToken({
      userId: "user-1",
      email: "y@example.com",
      kind: "reset",
    });
    db.prepare("UPDATE email_tokens SET expires_at = ? WHERE token = ?").run(
      new Date(Date.now() - 60_000).toISOString(),
      created.token,
    );
    expect(tokens.consumeEmailToken(created.token, "reset")).toBeNull();
  });

  it("rejects when kind does not match", () => {
    const created = tokens.createEmailToken({
      userId: "user-1",
      email: "z@example.com",
      kind: "verify",
    });
    expect(tokens.consumeEmailToken(created.token, "reset")).toBeNull();
    expect(tokens.consumeEmailToken(created.token, "verify")).not.toBeNull();
  });

  it("returns null for unknown tokens", () => {
    expect(tokens.consumeEmailToken("nonexistent", "verify")).toBeNull();
  });
});
