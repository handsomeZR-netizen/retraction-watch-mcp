import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { getAppDb } from "@/lib/db/app-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AuditRow {
  id: number;
  user_id: string | null;
  action: string;
  detail_json: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  username: string | null;
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? 200)));
  const rows = getAppDb()
    .prepare(
      `SELECT a.*, u.username AS username
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.id DESC
        LIMIT ?`,
    )
    .all(limit) as AuditRow[];
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      action: r.action,
      detail: r.detail_json ? JSON.parse(r.detail_json) : null,
      ip: r.ip,
      userAgent: r.user_agent,
      createdAt: r.created_at,
    })),
  });
}
