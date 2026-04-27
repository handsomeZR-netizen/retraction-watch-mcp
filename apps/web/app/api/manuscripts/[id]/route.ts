import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import { deleteManuscript, getManuscript } from "@/lib/db/manuscripts";
import { getRequestIp } from "@/lib/auth/validate";
import { getDataDir } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = getManuscript(id);
  if (!row || row.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  deleteManuscript(id, auth.user.id);
  await fs.rm(path.join(getDataDir(), id), { recursive: true, force: true });
  writeAudit({
    userId: auth.user.id,
    action: "delete_manuscript",
    detail: { id },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
