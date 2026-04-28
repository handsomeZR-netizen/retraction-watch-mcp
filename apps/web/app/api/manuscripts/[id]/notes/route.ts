import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { canAccessManuscript } from "@/lib/auth/scope";
import { getRequestIp } from "@/lib/auth/validate";
import { writeAudit } from "@/lib/db/audit";
import { getManuscript, setManuscriptNotes } from "@/lib/db/manuscripts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({
  notes: z.string().max(8000).nullable(),
});

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
  const result = setManuscriptNotes(id, auth.user.id, parsed.data.notes);
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { manuscriptId: id, kind: "notes" },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({
    ok: result.ok,
    truncated: result.truncated,
    updatedAt: new Date().toISOString(),
  });
}
