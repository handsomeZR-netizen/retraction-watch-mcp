import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import {
  createInvite,
  isWorkspaceMember,
  listWorkspaceInvites,
} from "@/lib/db/workspaces";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const role = isWorkspaceMember(id, auth.user.id);
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ invites: listWorkspaceInvites(id) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const role = isWorkspaceMember(id, auth.user.id);
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const inv = createInvite({
    workspaceId: id,
    invitedBy: auth.user.id,
    role: "member",
    expiresInHours: 7 * 24,
  });
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { kind: "workspace.invite_create", workspaceId: id, token: inv.token.slice(0, 8) + "..." },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ invite: inv });
}
