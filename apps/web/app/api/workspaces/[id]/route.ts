import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import {
  deleteWorkspace,
  getWorkspace,
  isWorkspaceMember,
  listWorkspaceMembers,
  renameWorkspace,
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
  const ws = getWorkspace(id);
  if (!ws) return NextResponse.json({ error: "not found" }, { status: 404 });
  const role = isWorkspaceMember(id, auth.user.id);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({
    workspace: { ...ws, role },
    members: listWorkspaceMembers(id),
  });
}

export async function PATCH(
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
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = z.object({ name: z.string().min(1).max(64) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "字段不合法" }, { status: 400 });
  renameWorkspace(id, parsed.data.name);
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { kind: "workspace.rename", workspaceId: id, name: parsed.data.name },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const ws = getWorkspace(id);
  if (!ws) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (ws.owner_id !== auth.user.id) {
    return NextResponse.json({ error: "只有 owner 能删除" }, { status: 403 });
  }
  deleteWorkspace(id);
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { kind: "workspace.delete", workspaceId: id },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
