import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { canAccessManuscript } from "@/lib/auth/scope";
import { getRequestIp } from "@/lib/auth/validate";
import { writeAudit } from "@/lib/db/audit";
import {
  getManuscript,
  setManuscriptAssignee,
} from "@/lib/db/manuscripts";
import { findUserById } from "@/lib/db/users";
import {
  isWorkspaceMember,
  listWorkspaceMembers,
} from "@/lib/db/workspaces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({
  assigneeUserId: z.string().nullable(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = getManuscript(id);
  if (!row || !canAccessManuscript(auth.user, row)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Personal-scope manuscripts have no candidate pool — return empty so the
  // UI can hide the assignee row entirely.
  if (!row.workspace_id) {
    return NextResponse.json({
      assignee: row.assignee_user_id ? findUserSummary(row.assignee_user_id) : null,
      candidates: [],
    });
  }
  const members = listWorkspaceMembers(row.workspace_id).map((m) => ({
    id: m.user_id,
    username: m.username,
    displayName: m.display_name,
    avatarSeed: m.avatar_seed,
    role: m.role,
  }));
  return NextResponse.json({
    assignee: row.assignee_user_id ? findUserSummary(row.assignee_user_id) : null,
    candidates: members,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = getManuscript(id);
  if (!row || !canAccessManuscript(auth.user, row)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "字段不合法" }, { status: 400 });
  }
  const next = parsed.data.assigneeUserId;

  // Personal manuscripts can't have an assignee (there's nobody else with
  // access). Reject explicitly.
  if (!row.workspace_id && next !== null) {
    return NextResponse.json(
      { error: "personal scope cannot have assignee" },
      { status: 400 },
    );
  }
  // Workspace manuscripts: assignee must be a member of that workspace.
  if (next !== null && row.workspace_id) {
    if (isWorkspaceMember(row.workspace_id, next) === null) {
      return NextResponse.json(
        { error: "assignee must be a workspace member" },
        { status: 400 },
      );
    }
  }
  setManuscriptAssignee(id, next);
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: {
      manuscriptId: id,
      kind: "assignee",
      targetUserId: next ?? undefined,
    },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({
    ok: true,
    assignee: next ? findUserSummary(next) : null,
  });
}

function findUserSummary(userId: string) {
  const u = findUserById(userId);
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarSeed: u.avatar_seed,
  };
}
