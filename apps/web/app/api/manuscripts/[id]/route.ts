import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { canDeleteManuscript } from "@/lib/auth/scope";
import { writeAudit } from "@/lib/db/audit";
import { deleteManuscript, getManuscript } from "@/lib/db/manuscripts";
import { getRequestIp } from "@/lib/auth/validate";
import { getDataDir } from "@/lib/config";
import { assertWithinDir } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MANUSCRIPT_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  // UUID guard: a poisoned route param could otherwise let path-traversal
  // segments slip into the rm-rf below, even with assertWithinDir below.
  if (!MANUSCRIPT_ID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const row = getManuscript(id);
  if (!row || !canDeleteManuscript(auth.user, row)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // FS first, then DB. If the rm fails we still have the DB row to retry; if
  // the DB delete fails after the files are gone, the next cleanup pass will
  // see an errored row pointing at nothing and tidy it up. This avoids the
  // window where the DB is gone but stale files remain.
  const dataDir = getDataDir();
  const target = assertWithinDir(path.join(dataDir, id), dataDir);
  await fs.rm(target, { recursive: true, force: true });
  deleteManuscript(id);
  writeAudit({
    userId: auth.user.id,
    action: "delete_manuscript",
    detail: { manuscriptId: id },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
