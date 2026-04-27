import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getScreeningLogStats } from "@/lib/db/screening-logs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const stats = getScreeningLogStats({ scopeUserId: auth.user.id });
  return NextResponse.json(stats);
}
