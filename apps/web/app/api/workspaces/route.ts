import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import { createWorkspace, listUserWorkspaces } from "@/lib/db/workspaces";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({ name: z.string().min(1).max(64) });

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  return NextResponse.json({ workspaces: listUserWorkspaces(auth.user.id) });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "name 不合法" }, { status: 400 });
  const ws = createWorkspace({ name: parsed.data.name, ownerId: auth.user.id });
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { kind: "workspace.create", workspaceId: ws.id },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ workspace: ws });
}
