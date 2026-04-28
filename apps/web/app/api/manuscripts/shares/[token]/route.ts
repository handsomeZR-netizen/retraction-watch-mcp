import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { canAccessManuscript, canManageManuscript } from "@/lib/auth/scope";
import { getRequestIp } from "@/lib/auth/validate";
import { writeAudit } from "@/lib/db/audit";
import {
  listSharesForManuscript,
  revokeShare,
} from "@/lib/db/manuscript-shares";
import { getManuscript } from "@/lib/db/manuscripts";
import { getAppDb } from "@/lib/db/app-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { token } = await params;
  // Resolve owning manuscript so we can re-check scope before revoking.
  const share = getAppDb()
    .prepare("SELECT manuscript_id FROM manuscript_shares WHERE token = ?")
    .get(token) as { manuscript_id: string } | undefined;
  if (!share) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = getManuscript(share.manuscript_id);
  if (!row || !canAccessManuscript(auth.user, row)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Stricter than canAccess: revoking is a management action, only uploader
  // or workspace owner/admin.
  if (!canManageManuscript(auth.user, row)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ok = revokeShare(token);
  // Returning the updated list saves the UI a second roundtrip.
  const shares = listSharesForManuscript(row.id).map((s) => ({
    token: s.token,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    revokedAt: s.revoked_at,
    viewCount: s.view_count,
    lastViewedAt: s.last_viewed_at,
    active: s.revoked_at === null && Date.parse(s.expires_at) >= Date.now(),
  }));
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { manuscriptId: row.id, kind: "share.revoke" },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok, shares });
}
