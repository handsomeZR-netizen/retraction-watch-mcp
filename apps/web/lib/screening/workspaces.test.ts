import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DB } from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";
import type * as Manuscripts from "@/lib/db/manuscripts";
import type * as Workspaces from "@/lib/db/workspaces";

const authState = vi.hoisted(() => ({
  user: null as CurrentUser | null,
}));

vi.mock("@/lib/auth/guard", () => ({
  requireUser: async () => {
    if (!authState.user) throw new Error("test user not set");
    return { user: authState.user };
  },
}));

let db: DB;
let tmpDir: string;
let manuscripts: typeof Manuscripts;
let workspaces: typeof Workspaces;
let workspaceRoutes: typeof import("@/app/api/workspaces/route");
let workspaceDetailRoutes: typeof import("@/app/api/workspaces/[id]/route");

const userA: CurrentUser = { id: "user-a", username: "ua", displayName: null, role: "user" };
const userB: CurrentUser = { id: "user-b", username: "ub", displayName: null, role: "user" };

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-workspaces-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  process.env.RW_DATA_KEY = "a".repeat(64);

  const appDb = await import("@/lib/db/app-db");
  manuscripts = await import("@/lib/db/manuscripts");
  workspaces = await import("@/lib/db/workspaces");
  workspaceRoutes = await import("@/app/api/workspaces/route");
  workspaceDetailRoutes = await import("@/app/api/workspaces/[id]/route");
  db = appDb.getAppDb();
});

beforeEach(() => {
  authState.user = userA;
  db.prepare("DELETE FROM manuscript_shares").run();
  db.prepare("DELETE FROM manuscripts").run();
  db.prepare("DELETE FROM workspace_invites").run();
  db.prepare("DELETE FROM workspace_members").run();
  db.prepare("DELETE FROM workspaces").run();
  db.prepare("DELETE FROM audit_log").run();
  db.prepare("DELETE FROM users").run();
  const now = new Date().toISOString();
  for (const user of [userA, userB]) {
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, 'h', ?, ?)",
    ).run(user.id, user.username, user.role, now);
  }
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function request(pathname: string, init?: RequestInit): Request {
  return new Request(`http://test.local${pathname}`, init);
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function setWorkspaceCreatedAt(id: string, createdAt: string): void {
  db.prepare("UPDATE workspaces SET created_at = ? WHERE id = ?").run(createdAt, id);
}

function insertManuscriptAt(
  id: string,
  userId: string,
  workspaceId: string | null,
  uploadedAt: string,
): void {
  manuscripts.insertManuscript({
    id,
    userId,
    workspaceId,
    fileName: `${id}.pdf`,
    fileType: "pdf",
    bytes: 100,
    sha256: id,
  });
  db.prepare("UPDATE manuscripts SET uploaded_at = ? WHERE id = ?").run(uploadedAt, id);
}

describe("workspace authorization and pagination", () => {
  it("does not let user A read, rename, or delete user B's workspace", async () => {
    const own = workspaces.createWorkspace({ name: "Own Lab", ownerId: userA.id });
    const other = workspaces.createWorkspace({ name: "Other Lab", ownerId: userB.id });

    const listRes = await workspaceRoutes.GET(request("/api/workspaces"));
    expect(listRes.status).toBe(200);
    const list = await readJson<{ workspaces: Array<{ id: string }> }>(listRes);
    expect(list.workspaces.map((w) => w.id)).toEqual([own.id]);

    const params = { params: Promise.resolve({ id: other.id }) };
    const getRes = await workspaceDetailRoutes.GET(request(`/api/workspaces/${other.id}`), params);
    expect(getRes.status).toBe(403);

    const patchRes = await workspaceDetailRoutes.PATCH(
      request(`/api/workspaces/${other.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Stolen" }),
      }),
      params,
    );
    expect(patchRes.status).toBe(403);
    expect(workspaces.getWorkspace(other.id)?.name).toBe("Other Lab");

    const deleteRes = await workspaceDetailRoutes.DELETE(
      request(`/api/workspaces/${other.id}`, { method: "DELETE" }),
      params,
    );
    expect(deleteRes.status).toBe(403);
    expect(workspaces.getWorkspace(other.id)).not.toBeNull();
  });

  it("rejects blank workspace names", async () => {
    const res = await workspaceRoutes.POST(
      request("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("paginates the workspace list after applying user membership", async () => {
    const created = ["Lab 1", "Lab 2", "Lab 3", "Lab 4"].map((name, index) => {
      const ws = workspaces.createWorkspace({ name, ownerId: userA.id });
      setWorkspaceCreatedAt(ws.id, `2026-04-0${index + 1}T00:00:00.000Z`);
      return ws;
    });
    workspaces.createWorkspace({ name: "Other User Lab", ownerId: userB.id });

    const res = await workspaceRoutes.GET(request("/api/workspaces?limit=2&offset=1"));
    expect(res.status).toBe(200);
    const page = await readJson<{
      workspaces: Array<{ id: string; name: string }>;
      total: number;
      limit: number;
      offset: number;
    }>(res);

    expect(page.total).toBe(4);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(1);
    expect(page.workspaces.map((w) => w.id)).toEqual([created[1].id, created[2].id]);
  });
});

describe("manuscript tenant filters and pagination", () => {
  it("paginates manuscripts inside a workspace without leaking another workspace", () => {
    const workspaceA = workspaces.createWorkspace({ name: "Workspace A", ownerId: userA.id });
    const workspaceB = workspaces.createWorkspace({ name: "Workspace B", ownerId: userB.id });

    insertManuscriptAt("a-1", userA.id, workspaceA.id, "2026-04-01T00:00:00.000Z");
    insertManuscriptAt("a-2", userA.id, workspaceA.id, "2026-04-02T00:00:00.000Z");
    insertManuscriptAt("a-3", userA.id, workspaceA.id, "2026-04-03T00:00:00.000Z");
    insertManuscriptAt("b-1", userB.id, workspaceB.id, "2026-04-04T00:00:00.000Z");

    const page = manuscripts.listManuscriptsForScope(
      { userId: userA.id, workspaceId: workspaceA.id },
      { limit: 2, offset: 1 },
    );

    expect(page.map((row) => row.id)).toEqual(["a-2", "a-1"]);
    expect(
      manuscripts.countManuscriptsForScope({ userId: userA.id, workspaceId: workspaceA.id }),
    ).toBe(3);
  });

  it("keeps personal manuscript queries scoped to the owner and workspace_id IS NULL", () => {
    insertManuscriptAt("personal-a", userA.id, null, "2026-04-01T00:00:00.000Z");
    insertManuscriptAt("personal-b", userB.id, null, "2026-04-02T00:00:00.000Z");

    const page = manuscripts.listManuscriptsForScope(
      { userId: userA.id, workspaceId: null },
      { limit: 10 },
    );

    expect(page.map((row) => row.id)).toEqual(["personal-a"]);
  });
});
