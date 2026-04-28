import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DB } from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Audit from "./audit";

let db: DB;
let audit: typeof Audit;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-audit-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  process.env.RW_DATA_KEY = "a".repeat(64);
  const appDb = await import("./app-db");
  audit = await import("./audit");
  db = appDb.getAppDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM audit_log").run();
  db.prepare("DELETE FROM users").run();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('user-1', 'u1', 'h', 'user', ?)",
  ).run(new Date().toISOString());
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function lastDetail(): unknown {
  const row = db
    .prepare("SELECT detail_json FROM audit_log ORDER BY id DESC LIMIT 1")
    .get() as { detail_json: string | null } | undefined;
  return row?.detail_json ? JSON.parse(row.detail_json) : null;
}

describe("audit allowlist sanitizer", () => {
  it("drops fields not on the allowlist (password, apiKey, token, raw secrets)", () => {
    audit.writeAudit({
      userId: "user-1",
      action: "login",
      detail: {
        password: "p@ssw0rd",
        apiKey: "sk-secret",
        token: "tok-1",
        cookie: "c=v",
        manuscriptId: "m-1",
      },
    });
    expect(lastDetail()).toEqual({ manuscriptId: "m-1" });
  });

  it("drops nested objects, functions, and unsupported value types", () => {
    audit.writeAudit({
      userId: "user-1",
      action: "change_settings",
      detail: {
        manuscriptId: "m-2",
        scope: { nested: "object" },
        role: () => "fn",
        bytes: BigInt(123) as unknown,
        fields: ["a", "b"],
      },
    });
    expect(lastDetail()).toEqual({ manuscriptId: "m-2", fields: ["a", "b"] });
  });

  it("drops arrays of non-string values", () => {
    audit.writeAudit({
      userId: "user-1",
      action: "upload",
      detail: { manuscriptId: "m-3", fields: [1, 2, 3] },
    });
    expect(lastDetail()).toEqual({ manuscriptId: "m-3" });
  });

  it("writes detail_json=null when nothing survives the sanitizer", () => {
    audit.writeAudit({
      userId: "user-1",
      action: "login",
      detail: { password: "x", token: "y" },
    });
    const row = db.prepare("SELECT detail_json FROM audit_log ORDER BY id DESC LIMIT 1").get() as {
      detail_json: string | null;
    };
    expect(row.detail_json).toBeNull();
  });

  it("rejects array detail at the top level", () => {
    audit.writeAudit({
      userId: "user-1",
      action: "login",
      detail: ["bad", "shape"],
    });
    expect(lastDetail()).toBeNull();
  });

  it("preserves null-userId rows for unauth events", () => {
    audit.writeAudit({
      userId: null,
      action: "login_failed",
      detail: { manuscriptId: "ignored-but-present" },
      ip: "127.0.0.1",
    });
    const row = db
      .prepare("SELECT user_id, ip FROM audit_log ORDER BY id DESC LIMIT 1")
      .get() as { user_id: string | null; ip: string | null };
    expect(row.user_id).toBeNull();
    expect(row.ip).toBe("127.0.0.1");
  });
});
