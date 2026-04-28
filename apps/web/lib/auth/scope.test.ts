import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DB } from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Manuscripts from "@/lib/db/manuscripts";
import type * as Workspaces from "@/lib/db/workspaces";
import type * as Scope from "./scope";

let db: DB;
let scope: typeof Scope;
let workspaces: typeof Workspaces;
let manuscripts: typeof Manuscripts;
let tmpDir: string;

const userA = { id: "user-a", username: "ua", displayName: null, role: "user" as const };
const userB = { id: "user-b", username: "ub", displayName: null, role: "user" as const };
const userC = { id: "user-c", username: "uc", displayName: null, role: "user" as const };

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-scope-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  process.env.RW_DATA_KEY = "a".repeat(64);
  const appDb = await import("@/lib/db/app-db");
  scope = await import("./scope");
  workspaces = await import("@/lib/db/workspaces");
  manuscripts = await import("@/lib/db/manuscripts");
  db = appDb.getAppDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM manuscripts").run();
  db.prepare("DELETE FROM workspace_members").run();
  db.prepare("DELETE FROM workspaces").run();
  db.prepare("DELETE FROM users").run();
  const now = new Date().toISOString();
  for (const u of [userA, userB, userC]) {
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, 'h', ?, ?)",
    ).run(u.id, u.username, u.role, now);
  }
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function insertManuscript(id: string, ownerId: string, workspaceId: string | null): void {
  manuscripts.insertManuscript({
    id,
    userId: ownerId,
    workspaceId,
    fileName: `${id}.pdf`,
    fileType: "pdf",
    bytes: 100,
    sha256: id,
  });
}

describe("activeScope", () => {
  it("returns personal scope when user has no active workspace", () => {
    const result = scope.activeScope(userA);
    expect(result).toEqual({ userId: userA.id, workspaceId: null });
  });

  it("returns workspace scope when user is a member", () => {
    const ws = workspaces.createWorkspace({ name: "Lab", ownerId: userA.id });
    workspaces.setUserActiveWorkspace(userA.id, ws.id);
    const result = scope.activeScope(userA);
    expect(result).toEqual({ userId: userA.id, workspaceId: ws.id });
  });

  it("falls back to personal scope when user was kicked out", () => {
    const ws = workspaces.createWorkspace({ name: "Lab", ownerId: userA.id });
    workspaces.addMember({ workspaceId: ws.id, userId: userB.id });
    workspaces.setUserActiveWorkspace(userB.id, ws.id);
    workspaces.removeMember(ws.id, userB.id);
    const result = scope.activeScope(userB);
    expect(result).toEqual({ userId: userB.id, workspaceId: null });
  });
});

describe("canAccessManuscript", () => {
  it("denies a personal manuscript to a different user", () => {
    insertManuscript("m1", userA.id, null);
    const row = manuscripts.getManuscript("m1")!;
    expect(scope.canAccessManuscript(userA, row)).toBe(true);
    expect(scope.canAccessManuscript(userB, row)).toBe(false);
  });

  it("allows workspace manuscripts only for members", () => {
    const ws = workspaces.createWorkspace({ name: "Lab", ownerId: userA.id });
    workspaces.addMember({ workspaceId: ws.id, userId: userB.id });
    insertManuscript("m2", userA.id, ws.id);
    const row = manuscripts.getManuscript("m2")!;
    expect(scope.canAccessManuscript(userA, row)).toBe(true);
    expect(scope.canAccessManuscript(userB, row)).toBe(true);
    expect(scope.canAccessManuscript(userC, row)).toBe(false);
  });
});

describe("canDeleteManuscript", () => {
  it("personal: only the uploader can delete", () => {
    insertManuscript("m3", userA.id, null);
    const row = manuscripts.getManuscript("m3")!;
    expect(scope.canDeleteManuscript(userA, row)).toBe(true);
    expect(scope.canDeleteManuscript(userB, row)).toBe(false);
  });

  it("workspace: owner/admin can delete others' uploads, member only their own", () => {
    const ws = workspaces.createWorkspace({ name: "Lab", ownerId: userA.id });
    workspaces.addMember({ workspaceId: ws.id, userId: userB.id, role: "admin" });
    workspaces.addMember({ workspaceId: ws.id, userId: userC.id, role: "member" });
    insertManuscript("m4", userC.id, ws.id);
    const row = manuscripts.getManuscript("m4")!;

    expect(scope.canDeleteManuscript(userA, row)).toBe(true);
    expect(scope.canDeleteManuscript(userB, row)).toBe(true);
    expect(scope.canDeleteManuscript(userC, row)).toBe(true);
  });

  it("workspace: a member cannot delete another member's manuscript", () => {
    const ws = workspaces.createWorkspace({ name: "Lab", ownerId: userA.id });
    workspaces.addMember({ workspaceId: ws.id, userId: userB.id, role: "member" });
    workspaces.addMember({ workspaceId: ws.id, userId: userC.id, role: "member" });
    insertManuscript("m5", userC.id, ws.id);
    const row = manuscripts.getManuscript("m5")!;

    expect(scope.canDeleteManuscript(userB, row)).toBe(false);
    expect(scope.canDeleteManuscript(userC, row)).toBe(true);
  });
});
