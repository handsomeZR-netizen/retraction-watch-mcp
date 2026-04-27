import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/db/audit";
import { consumeEmailToken } from "@/lib/db/email-tokens";
import { markEmailVerified, setUserEmail, findUserById } from "@/lib/db/users";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const row = consumeEmailToken(token, "verify");
  if (!row) {
    return NextResponse.json({ error: "链接无效或已过期" }, { status: 400 });
  }
  const user = findUserById(row.user_id);
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  setUserEmail(user.id, row.email, true);
  markEmailVerified(user.id);
  writeAudit({
    userId: user.id,
    action: "change_settings",
    detail: { kind: "email.verified", email: row.email },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true, email: row.email });
}
