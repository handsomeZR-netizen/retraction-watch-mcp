import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { listAuditLog } from "@/lib/db/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? 200)));
  const action = url.searchParams.get("action");
  const userId = url.searchParams.get("userId");
  const items = listAuditLog({ limit, action, userId });
  return NextResponse.json({
    items: items.map(({ ipHash, ...item }) => item),
  });
}
