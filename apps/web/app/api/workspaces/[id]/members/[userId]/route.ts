import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import {
  getWorkspace,
  isWorkspaceMember,
  removeMember,
} from "@/lib/db/workspaces";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id, userId } = await params;
  const ws = getWorkspace(id);
  if (!ws) return NextResponse.json({ error: "not found" }, { status: 404 });
  const role = isWorkspaceMember(id, auth.user.id);
  const isSelf = userId === auth.user.id;
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isSelf && role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (userId === ws.owner_id) {
    return NextResponse.json({ error: "不能移除 owner" }, { status: 400 });
  }
  removeMember(id, userId);
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { kind: "workspace.member_remove", workspaceId: id, target: userId },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
