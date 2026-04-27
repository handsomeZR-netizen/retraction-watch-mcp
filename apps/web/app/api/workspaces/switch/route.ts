import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { isWorkspaceMember, setUserActiveWorkspace } from "@/lib/db/workspaces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({ workspaceId: z.string().nullable() });

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "字段不合法" }, { status: 400 });
  if (parsed.data.workspaceId) {
    const role = isWorkspaceMember(parsed.data.workspaceId, auth.user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  setUserActiveWorkspace(auth.user.id, parsed.data.workspaceId);
  return NextResponse.json({ ok: true });
}
