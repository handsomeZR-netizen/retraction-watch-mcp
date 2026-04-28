import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { rateLimit } from "@/lib/auth/rate-limit";
import {
  canAccessManuscript,
  canManageManuscript,
} from "@/lib/auth/scope";
import { getRequestIp } from "@/lib/auth/validate";
import { writeAudit } from "@/lib/db/audit";
import {
  countActiveSharesForManuscript,
  createShare,
  listSharesForManuscript,
} from "@/lib/db/manuscript-shares";
import { getManuscript } from "@/lib/db/manuscripts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cap concurrent active tokens per manuscript so a member can't accidentally
// mint dozens of dangling external links.
const MAX_ACTIVE_SHARES_PER_MANUSCRIPT = 20;

const PostSchema = z.object({
  ttlHours: z.number().int().min(1).max(24 * 30).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = getManuscript(id);
  if (!row || !canAccessManuscript(auth.user, row)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const shares = listSharesForManuscript(id).map((s) => ({
    token: s.token,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    revokedAt: s.revoked_at,
    viewCount: s.view_count,
    lastViewedAt: s.last_viewed_at,
    active: s.revoked_at === null && Date.parse(s.expires_at) >= Date.now(),
  }));
  return NextResponse.json({ shares });
}

export async function POST(
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
  // Stricter than canAccessManuscript: only the uploader or workspace
  // owner/admin can mint external links. Random workspace members cannot.
  if (!canManageManuscript(auth.user, row)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Per-user rate limit on POST: 10/min — covers fat-finger plus button mash.
  const limited = rateLimit(`share-mint:${auth.user.id}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429 },
    );
  }
  if (row.status !== "done") {
    return NextResponse.json(
      { error: "only completed manuscripts can be shared" },
      { status: 400 },
    );
  }
  if (countActiveSharesForManuscript(id) >= MAX_ACTIVE_SHARES_PER_MANUSCRIPT) {
    return NextResponse.json(
      { error: `已达活跃链接上限 ${MAX_ACTIVE_SHARES_PER_MANUSCRIPT}，请先撤销旧链接` },
      { status: 409 },
    );
  }
  let body: unknown = {};
  if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
    }
  }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "字段不合法" }, { status: 400 });
  }
  const share = createShare({
    manuscriptId: id,
    createdBy: auth.user.id,
    ttlHours: parsed.data.ttlHours,
  });
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { manuscriptId: id, kind: "share.create" },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({
    token: share.token,
    expiresAt: share.expires_at,
  });
}
