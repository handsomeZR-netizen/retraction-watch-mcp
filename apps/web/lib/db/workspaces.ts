import { nanoid } from "nanoid";
import { getAppDb } from "./app-db";

export type WorkspaceRole = "owner" | "admin" | "member";

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

export interface WorkspaceMemberRow {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
}

export interface WorkspaceInviteRow {
  token: string;
  workspace_id: string;
  invited_by: string;
  role: WorkspaceRole;
  created_at: string;
  expires_at: string | null;
  used_by: string | null;
  used_at: string | null;
}

function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = nanoid(6);
  return `${base || "ws"}-${suffix}`.toLowerCase();
}

export function createWorkspace(input: {
  name: string;
  ownerId: string;
}): WorkspaceRow {
  const id = nanoid();
  const slug = makeSlug(input.name);
  const now = new Date().toISOString();
  const db = getAppDb();
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO workspaces (id, name, slug, owner_id, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, input.name.trim().slice(0, 64), slug, input.ownerId, now);
    db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    ).run(id, input.ownerId, now);
  });
  tx();
  return getWorkspace(id)!;
}

export function getWorkspace(id: string): WorkspaceRow | null {
  return (
    (getAppDb()
      .prepare("SELECT * FROM workspaces WHERE id = ?")
      .get(id) as WorkspaceRow | undefined) ?? null
  );
}

export function listUserWorkspaces(userId: string): Array<WorkspaceRow & { role: WorkspaceRole }> {
  return getAppDb()
    .prepare(
      `SELECT w.*, m.role AS role
         FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = ?
        ORDER BY w.created_at ASC`,
    )
    .all(userId) as Array<WorkspaceRow & { role: WorkspaceRole }>;
}

export function isWorkspaceMember(workspaceId: string, userId: string): WorkspaceRole | null {
  const row = getAppDb()
    .prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, userId) as { role: WorkspaceRole } | undefined;
  return row?.role ?? null;
}

export function listWorkspaceMembers(workspaceId: string): Array<{
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
  username: string;
  display_name: string | null;
  avatar_seed: string | null;
}> {
  return getAppDb()
    .prepare(
      `SELECT m.user_id, m.role, m.joined_at, u.username, u.display_name, u.avatar_seed
         FROM workspace_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ?
        ORDER BY (m.role = 'owner') DESC, (m.role = 'admin') DESC, m.joined_at ASC`,
    )
    .all(workspaceId) as never;
}

export function setUserActiveWorkspace(userId: string, workspaceId: string | null): void {
  getAppDb()
    .prepare("UPDATE users SET active_workspace_id = ? WHERE id = ?")
    .run(workspaceId, userId);
}

export function addMember(input: {
  workspaceId: string;
  userId: string;
  role?: WorkspaceRole;
}): void {
  getAppDb()
    .prepare(
      `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.workspaceId, input.userId, input.role ?? "member", new Date().toISOString());
}

export function removeMember(workspaceId: string, userId: string): void {
  const db = getAppDb();
  const tx = db.transaction(() => {
    db.prepare(
      "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    ).run(workspaceId, userId);
    // Clear any assignee references this user has on manuscripts in this
    // workspace — sqlite has no FK on assignee_user_id so we maintain
    // referential integrity by hand here.
    db.prepare(
      "UPDATE manuscripts SET assignee_user_id = NULL WHERE workspace_id = ? AND assignee_user_id = ?",
    ).run(workspaceId, userId);
  });
  tx();
}

export function setMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): void {
  getAppDb()
    .prepare(
      "UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?",
    )
    .run(role, workspaceId, userId);
}

export function createInvite(input: {
  workspaceId: string;
  invitedBy: string;
  role?: WorkspaceRole;
  expiresInHours?: number;
}): WorkspaceInviteRow {
  const token = nanoid(32);
  const now = new Date();
  const expires = input.expiresInHours
    ? new Date(now.getTime() + input.expiresInHours * 3600_000).toISOString()
    : null;
  getAppDb()
    .prepare(
      `INSERT INTO workspace_invites (token, workspace_id, invited_by, role, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(token, input.workspaceId, input.invitedBy, input.role ?? "member", now.toISOString(), expires);
  return getInvite(token)!;
}

export function getInvite(token: string): WorkspaceInviteRow | null {
  return (
    (getAppDb()
      .prepare("SELECT * FROM workspace_invites WHERE token = ?")
      .get(token) as WorkspaceInviteRow | undefined) ?? null
  );
}

export function consumeInvite(token: string, userId: string): WorkspaceInviteRow | null {
  const db = getAppDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    // Atomic CAS: only consume tokens that are still un-used and unexpired.
    // RETURNING gives us the row only if the UPDATE actually fired, so two
    // concurrent requests racing on the same invite cannot both succeed.
    const claimed = db
      .prepare(
        `UPDATE workspace_invites
            SET used_by = ?, used_at = ?
          WHERE token = ?
            AND used_at IS NULL
            AND (expires_at IS NULL OR expires_at >= ?)
       RETURNING *`,
      )
      .get(userId, now, token, now) as WorkspaceInviteRow | undefined;
    if (!claimed) return null;
    db.prepare(
      `INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?)`,
    ).run(claimed.workspace_id, userId, claimed.role, now);
    return claimed;
  });
  return tx();
}

export function listWorkspaceInvites(workspaceId: string): WorkspaceInviteRow[] {
  return getAppDb()
    .prepare(
      "SELECT * FROM workspace_invites WHERE workspace_id = ? ORDER BY created_at DESC",
    )
    .all(workspaceId) as WorkspaceInviteRow[];
}

export function revokeInvite(token: string): void {
  getAppDb().prepare("DELETE FROM workspace_invites WHERE token = ?").run(token);
}

export function deleteWorkspace(id: string): void {
  const db = getAppDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    // Active share tokens for manuscripts in this workspace must be revoked
    // before we sever the workspace link — otherwise an external viewer with
    // a token can keep accessing a manuscript whose context just disappeared.
    db.prepare(
      `UPDATE manuscript_shares
          SET revoked_at = ?
        WHERE manuscript_id IN (
                SELECT id FROM manuscripts WHERE workspace_id = ?
              )
          AND revoked_at IS NULL`,
    ).run(now, id);
    // Manuscripts have no FK on workspace_id; revert them to the uploader's personal scope.
    db.prepare("UPDATE manuscripts SET workspace_id = NULL WHERE workspace_id = ?").run(id);
    // Personal-scope manuscripts cannot have assignees, so clear those too.
    db.prepare(
      "UPDATE manuscripts SET assignee_user_id = NULL WHERE workspace_id IS NULL AND assignee_user_id IS NOT NULL",
    ).run();
    db.prepare("UPDATE users SET active_workspace_id = NULL WHERE active_workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  });
  tx();
}

export function renameWorkspace(id: string, name: string): void {
  getAppDb()
    .prepare("UPDATE workspaces SET name = ? WHERE id = ?")
    .run(name.trim().slice(0, 64), id);
}
