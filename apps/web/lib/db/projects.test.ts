import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DB } from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Manuscripts from "./manuscripts";
import type * as Projects from "./projects";
import type * as Workspaces from "./workspaces";

let db: DB;
let projects: typeof Projects;
let workspaces: typeof Workspaces;
let manuscripts: typeof Manuscripts;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-projects-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  process.env.RW_DATA_KEY = "a".repeat(64);
  const appDb = await import("./app-db");
  projects = await import("./projects");
  workspaces = await import("./workspaces");
  manuscripts = await import("./manuscripts");
  db = appDb.getAppDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM manuscripts").run();
  db.prepare("DELETE FROM projects").run();
  db.prepare("DELETE FROM workspace_members").run();
  db.prepare("DELETE FROM workspaces").run();
  db.prepare("DELETE FROM users").run();
  const now = new Date().toISOString();
  for (const id of ["user-a", "user-b"]) {
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, 'h', 'user', ?)",
    ).run(id, id, now);
  }
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("projects scope", () => {
  it("personal project belongs to its owner only", () => {
    const p = projects.createProject({
      name: "Solo",
      ownerId: "user-a",
      workspaceId: null,
    });
    expect(p.workspace_id).toBeNull();
    expect(p.owner_id).toBe("user-a");

    const aList = projects.listProjectsForScope({ userId: "user-a", workspaceId: null });
    const bList = projects.listProjectsForScope({ userId: "user-b", workspaceId: null });
    expect(aList.map((r) => r.id)).toEqual([p.id]);
    expect(bList.map((r) => r.id)).toEqual([]);
  });

  it("workspace project lists for any member, not for non-members", () => {
    const ws = workspaces.createWorkspace({ name: "Lab", ownerId: "user-a" });
    workspaces.addMember({ workspaceId: ws.id, userId: "user-b", role: "member" });
    const proj = projects.createProject({
      name: "WSProj",
      ownerId: "user-a",
      workspaceId: ws.id,
    });

    const aList = projects.listProjectsForScope({ userId: "user-a", workspaceId: ws.id });
    expect(aList.map((r) => r.id)).toEqual([proj.id]);

    const bList = projects.listProjectsForScope({ userId: "user-b", workspaceId: ws.id });
    expect(bList.map((r) => r.id)).toEqual([proj.id]);

    // Non-members querying with the same workspaceId is something the route layer guards.
    // At the DB layer, the personal-scope query for user-b should not surface this WS project.
    const personalForB = projects.listProjectsForScope({
      userId: "user-b",
      workspaceId: null,
    });
    expect(personalForB.map((r) => r.id)).toEqual([]);
  });

  it("counts only non-archived manuscripts per project", () => {
    const proj = projects.createProject({
      name: "Counted",
      ownerId: "user-a",
      workspaceId: null,
    });
    manuscripts.insertManuscript({
      id: "m-keep",
      userId: "user-a",
      workspaceId: null,
      fileName: "k.pdf",
      fileType: "pdf",
      bytes: 1,
      sha256: null,
    });
    manuscripts.insertManuscript({
      id: "m-arch",
      userId: "user-a",
      workspaceId: null,
      fileName: "a.pdf",
      fileType: "pdf",
      bytes: 1,
      sha256: null,
    });
    manuscripts.setManuscriptProject("m-keep", proj.id);
    manuscripts.setManuscriptProject("m-arch", proj.id);
    manuscripts.setManuscriptArchived("m-arch", true);

    const list = projects.listProjectsForScope({ userId: "user-a", workspaceId: null });
    expect(list).toHaveLength(1);
    expect(list[0]?.count).toBe(1);
  });

  it("deleteProject orphans assigned manuscripts (project_id → NULL)", () => {
    const proj = projects.createProject({
      name: "Doomed",
      ownerId: "user-a",
      workspaceId: null,
    });
    manuscripts.insertManuscript({
      id: "m1",
      userId: "user-a",
      workspaceId: null,
      fileName: "m.pdf",
      fileType: "pdf",
      bytes: 1,
      sha256: null,
    });
    manuscripts.setManuscriptProject("m1", proj.id);

    projects.deleteProject(proj.id);

    expect(projects.getProject(proj.id)).toBeNull();
    const row = manuscripts.getManuscript("m1");
    expect(row?.project_id).toBeNull();
  });
});
