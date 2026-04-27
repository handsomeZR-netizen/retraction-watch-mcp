import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import { consumeInvite, getInvite, getWorkspace } from "@/lib/db/workspaces";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const inv = getInvite(token);
  if (!inv) return NextResponse.json({ error: "邀请无效" }, { status: 404 });
  const expired = inv.expires_at && Date.parse(inv.expires_at) < Date.now();
  const ws = getWorkspace(inv.workspace_id);
  return NextResponse.json({
    workspaceId: inv.workspace_id,
    workspaceName: ws?.name ?? null,
    role: inv.role,
    expired,
    used: Boolean(inv.used_at),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { token } = await params;
  const result = consumeInvite(token, auth.user.id);
  if (!result) return NextResponse.json({ error: "邀请无效或已过期" }, { status: 400 });
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { kind: "workspace.invite_accept", workspaceId: result.workspace_id },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true, workspaceId: result.workspace_id });
}
