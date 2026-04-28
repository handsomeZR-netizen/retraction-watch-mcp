import { nanoid } from "nanoid";
import { getAppDb } from "./app-db";

export interface ProjectRow {
  id: string;
  name: string;
  color: string | null;
  owner_id: string;
  workspace_id: string | null;
  created_at: string;
}

export interface ProjectWithCount extends ProjectRow {
  count: number;
}

export function createProject(input: {
  name: string;
  color?: string | null;
  ownerId: string;
  workspaceId: string | null;
}): ProjectRow {
  const id = nanoid();
  const now = new Date().toISOString();
  getAppDb()
    .prepare(
      `INSERT INTO projects (id, name, color, owner_id, workspace_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.name.trim().slice(0, 64), input.color ?? null, input.ownerId, input.workspaceId, now);
  return getProject(id)!;
}

export function getProject(id: string): ProjectRow | null {
  return (
    (getAppDb()
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | undefined) ?? null
  );
}

export function listProjectsForScope(scope: {
  userId: string;
  workspaceId: string | null;
}): ProjectWithCount[] {
  const db = getAppDb();
  if (scope.workspaceId) {
    return db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM manuscripts m WHERE m.project_id = p.id AND m.archived = 0) AS count
         FROM projects p
         WHERE p.workspace_id = ?
         ORDER BY p.created_at DESC`,
      )
      .all(scope.workspaceId) as ProjectWithCount[];
  }
  return db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM manuscripts m WHERE m.project_id = p.id AND m.archived = 0) AS count
       FROM projects p
       WHERE p.owner_id = ? AND p.workspace_id IS NULL
       ORDER BY p.created_at DESC`,
    )
    .all(scope.userId) as ProjectWithCount[];
}

export function renameProject(id: string, name: string): void {
  getAppDb()
    .prepare("UPDATE projects SET name = ? WHERE id = ?")
    .run(name.trim().slice(0, 64), id);
}

export function setProjectColor(id: string, color: string | null): void {
  getAppDb().prepare("UPDATE projects SET color = ? WHERE id = ?").run(color, id);
}

export function deleteProject(id: string): void {
  const db = getAppDb();
  const tx = db.transaction(() => {
    db.prepare("UPDATE manuscripts SET project_id = NULL WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  tx();
}
