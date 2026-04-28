import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { parseStreamResponse } from "@/lib/parse-stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const manuscriptId = url.searchParams.get("manuscriptId");
  if (!manuscriptId) {
    return NextResponse.json({ error: "manuscriptId required" }, { status: 400 });
  }
  return parseStreamResponse(manuscriptId, auth.user);
}
