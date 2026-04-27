import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/db/audit";
import { destroySession, getCurrentUser } from "@/lib/auth/session";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  await destroySession();
  if (me) {
    writeAudit({
      userId: me.id,
      action: "logout",
      ip: getRequestIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
  }
  return NextResponse.json({ ok: true });
}
