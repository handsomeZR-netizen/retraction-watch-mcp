import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import type { Database as DB } from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Audit from "./audit";

const authMock = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({
  requireAdmin: authMock.requireAdmin,
}));

let db: DB;
let audit: typeof Audit;
let tmpDir: string;
let usersRoute: typeof import("../../app/api/admin/users/route");
let userByIdRoute: typeof import("../../app/api/admin/users/[id]/route");
let auditRoute: typeof import("../../app/api/admin/audit/route");
let analyticsRoute: typeof import("../../app/api/admin/analytics/route");
let analyticsExportRoute: typeof import("../../app/api/admin/analytics/export/route");

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-admin-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  process.env.RW_DATA_KEY = "b".repeat(64);

  const appDb = await import("./app-db");
  audit = await import("./audit");
  usersRoute = await import("../../app/api/admin/users/route");
  userByIdRoute = await import("../../app/api/admin/users/[id]/route");
  auditRoute = await import("../../app/api/admin/audit/route");
  analyticsRoute = await import("../../app/api/admin/analytics/route");
  analyticsExportRoute = await import("../../app/api/admin/analytics/export/route");
  db = appDb.getAppDb();
});

beforeEach(() => {
  authMock.requireAdmin.mockReset();
  db.prepare("DELETE FROM audit_log").run();
  db.prepare("DELETE FROM screening_logs").run();
  db.prepare("DELETE FROM manuscripts").run();
  db.prepare("DELETE FROM users").run();
  insertUser({ id: "admin-1", username: "root", role: "admin" });
  insertUser({ id: "user-1", username: "alice", role: "user" });
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function insertUser(input: {
  id: string;
  username: string;
  role: "user" | "admin";
  passwordHash?: string;
  displayName?: string | null;
  email?: string | null;
  llmSettingsJson?: string | null;
}): void {
  db.prepare(
    `INSERT INTO users
       (id, username, password_hash, display_name, role, created_at, email, llm_settings_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.username,
    input.passwordHash ?? `hash-${input.id}`,
    input.displayName ?? null,
    input.role,
    new Date().toISOString(),
    input.email ?? null,
    input.llmSettingsJson ?? null,
  );
}

function asAdmin(id = "admin-1"): void {
  authMock.requireAdmin.mockResolvedValue({
    user: { id, username: "root", displayName: null, role: "admin" },
  });
}

function asForbidden(): void {
  authMock.requireAdmin.mockResolvedValue({
    response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
  });
}

function adminPatch(id: string, body: unknown, headers: Record<string, string> = {}) {
  return userByIdRoute.PATCH(
    new Request(`http://localhost/api/admin/users/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function auditCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number };
  return row.n;
}

describe("admin route authorization", () => {
  it.each([
    ["GET /api/admin/users", () => usersRoute.GET(new Request("http://localhost/api/admin/users"))],
    ["GET /api/admin/audit", () => auditRoute.GET(new Request("http://localhost/api/admin/audit"))],
    [
      "GET /api/admin/analytics",
      () => analyticsRoute.GET(new Request("http://localhost/api/admin/analytics")),
    ],
    [
      "GET /api/admin/analytics/export",
      () =>
        analyticsExportRoute.GET(
          new Request("http://localhost/api/admin/analytics/export"),
        ),
    ],
    ["PATCH /api/admin/users/:id", () => adminPatch("user-1", { disabled: true })],
  ])("%s returns 403 for non-admin users", async (_name, call) => {
    asForbidden();
    const response = await call();
    expect(response.status).toBe(403);
  });
});

describe("admin user mutations", () => {
  it("blocks demoting yourself when you are the last active admin", async () => {
    asAdmin();
    const response = await adminPatch("admin-1", { role: "user" });
    expect(response.status).toBe(400);
    const row = db.prepare("SELECT role FROM users WHERE id = 'admin-1'").get() as {
      role: string;
    };
    expect(row.role).toBe("admin");
    expect(auditCount()).toBe(0);
  });

  it("rejects cross-origin admin mutations before changing data", async () => {
    asAdmin();
    const response = await adminPatch("user-1", { disabled: true }, {
      origin: "http://evil.example",
      "sec-fetch-site": "cross-site",
    });
    expect(response.status).toBe(403);
    const row = db.prepare("SELECT disabled FROM users WHERE id = 'user-1'").get() as {
      disabled: 0 | 1;
    };
    expect(row.disabled).toBe(0);
    expect(auditCount()).toBe(0);
  });

  it("writes exactly one audit row for each privileged admin action", async () => {
    asAdmin();
    const cases: Array<[string, () => Promise<Response>, string]> = [
      [
        "role change",
        () => adminPatch("user-1", { role: "admin" }),
        "admin_role_change",
      ],
      [
        "disable user",
        () => adminPatch("user-1", { disabled: true }),
        "admin_disable_user",
      ],
      [
        "force logout",
        () => adminPatch("user-1", { forceLogout: true }),
        "admin_force_logout",
      ],
      [
        "delete manuscript",
        async () => {
          audit.writeAudit({
            userId: "admin-1",
            action: "delete_manuscript",
            detail: { manuscriptId: "12345678-dead-beef-cafe-123456789abc" },
          });
          return new Response(null, { status: 200 });
        },
        "delete_manuscript",
      ],
    ];

    for (const [label, run, action] of cases) {
      const before = auditCount();
      const response = await run();
      expect(response.status, label).toBe(200);
      expect(auditCount() - before, label).toBe(1);
      const row = db
        .prepare("SELECT action FROM audit_log ORDER BY id DESC LIMIT 1")
        .get() as { action: string };
      expect(row.action, label).toBe(action);
    }
  });
});

describe("admin audit log", () => {
  it("encrypts and decrypts sensitive detail fields with RW_DATA_KEY", () => {
    audit.writeAudit({
      userId: "admin-1",
      action: "admin_role_change",
      detail: {
        kind: "admin.role",
        targetUserId: "user-1",
        sensitive: {
          email: "alice@example.test",
          targetUsername: "alice",
        },
      },
    });

    const raw = db
      .prepare("SELECT detail_json FROM audit_log ORDER BY id DESC LIMIT 1")
      .get() as { detail_json: string };
    expect(raw.detail_json).not.toContain("alice@example.test");
    expect(raw.detail_json).not.toContain('"alice"');

    const [item] = audit.listAuditLog({ limit: 1 });
    expect(item.detail).toMatchObject({
      kind: "admin.role",
      targetUserId: "user-1",
      sensitive: {
        email: "alice@example.test",
        targetUsername: "alice",
      },
    });
  });

  it("does not swallow audit write database errors", () => {
    expect(() =>
      audit.writeAudit({ userId: "missing-user", action: "login" }),
    ).toThrow();
    expect(auditCount()).toBe(0);
  });

  it("keeps audit code append-only", () => {
    const source = fs.readFileSync(new URL("./audit.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bUPDATE\s+audit_log\b/i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\s+audit_log\b/i);
    expect(audit.pruneAuditLog(1)).toBe(0);
  });
});

describe("admin users table data", () => {
  it("paginates and filters without returning password hashes or sensitive fields", async () => {
    asAdmin();
    insertUser({
      id: "user-2",
      username: "target-user",
      displayName: "Target Person",
      role: "user",
      passwordHash: "password-hash-should-not-leak",
      email: "target@example.test",
      llmSettingsJson: JSON.stringify({ apiKey: "llm-secret-should-not-leak" }),
    });
    insertUser({ id: "user-3", username: "other-user", role: "user" });

    const response = await usersRoute.GET(
      new Request("http://localhost/api/admin/users?q=target&limit=1&offset=0"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      users: Array<{ id: string; username: string }>;
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({ id: "user-2", username: "target-user" });
    expect(body.total).toBe(1);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("password_hash");
    expect(serialized).not.toContain("password-hash-should-not-leak");
    expect(serialized).not.toContain("llm_settings_json");
    expect(serialized).not.toContain("llm-secret-should-not-leak");
    expect(serialized).not.toContain("target@example.test");
  });
});
