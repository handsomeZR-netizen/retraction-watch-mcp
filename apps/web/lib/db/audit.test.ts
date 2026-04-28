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

  it("preserves null-userId rows and stores a hashed ip (never the raw value)", () => {
    audit.writeAudit({
      userId: null,
      action: "login_failed",
      detail: { manuscriptId: "ignored-but-present" },
      ip: "127.0.0.1",
    });
    const row = db
      .prepare("SELECT user_id, ip, ip_hash FROM audit_log ORDER BY id DESC LIMIT 1")
      .get() as { user_id: string | null; ip: string | null; ip_hash: string | null };
    expect(row.user_id).toBeNull();
    // Raw ip column is no longer written by new code (privacy)
    expect(row.ip).toBeNull();
    // ip_hash is a non-empty hex string, not the original IP
    expect(row.ip_hash).toMatch(/^[0-9a-f]{8,32}$/);
    expect(row.ip_hash).not.toBe("127.0.0.1");
  });

  it("hashes the same ip to the same value across two writes", () => {
    audit.writeAudit({ userId: "user-1", action: "login", ip: "10.0.0.1" });
    audit.writeAudit({ userId: "user-1", action: "login", ip: "10.0.0.1" });
    const rows = db
      .prepare("SELECT ip_hash FROM audit_log ORDER BY id DESC LIMIT 2")
      .all() as { ip_hash: string }[];
    expect(rows[0].ip_hash).toBe(rows[1].ip_hash);
  });

  it("pruneAuditLog preserves rows because audit logs are append-only", () => {
    audit.writeAudit({ userId: "user-1", action: "login" });
    db.prepare(
      "UPDATE audit_log SET created_at = ? WHERE id = (SELECT MAX(id) FROM audit_log)",
    ).run("2020-01-01T00:00:00.000Z");
    audit.writeAudit({ userId: "user-1", action: "login" });
    const removed = audit.pruneAuditLog(30);
    expect(removed).toBe(0);
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number };
    expect(remaining.n).toBe(2);
  });
});
