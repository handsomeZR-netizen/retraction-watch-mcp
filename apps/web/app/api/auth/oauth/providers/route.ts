import { NextResponse } from "next/server";
import { listEnabledProviders } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ providers: listEnabledProviders() });
}
