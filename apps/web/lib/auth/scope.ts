import type { ManuscriptRow } from "@/lib/db/manuscripts";
import { findUserById } from "@/lib/db/users";
import { isWorkspaceMember } from "@/lib/db/workspaces";
import type { CurrentUser } from "@/lib/auth/session";

export function activeScope(user: CurrentUser): { userId: string; workspaceId: string | null } {
  const u = findUserById(user.id);
  if (u?.active_workspace_id) {
    if (isWorkspaceMember(u.active_workspace_id, user.id)) {
      return { userId: user.id, workspaceId: u.active_workspace_id };
    }
  }
  return { userId: user.id, workspaceId: null };
}

export function canAccessManuscript(user: CurrentUser, manuscript: ManuscriptRow): boolean {
  if (manuscript.workspace_id) {
    return isWorkspaceMember(manuscript.workspace_id, user.id) !== null;
  }
  return manuscript.user_id === user.id;
}

export function canDeleteManuscript(user: CurrentUser, manuscript: ManuscriptRow): boolean {
  if (manuscript.workspace_id) {
    const role = isWorkspaceMember(manuscript.workspace_id, user.id);
    if (role === "owner" || role === "admin") return true;
    return manuscript.user_id === user.id;
  }
  return manuscript.user_id === user.id;
}
