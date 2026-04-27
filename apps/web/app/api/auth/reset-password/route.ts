import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/db/audit";
import { consumeEmailToken } from "@/lib/db/email-tokens";
import { hashPassword, isStrongEnough } from "@/lib/auth/password";
import { setUserPassword } from "@/lib/db/users";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "字段不合法" }, { status: 400 });
  const strength = isStrongEnough(parsed.data.newPassword);
  if (!strength.ok) return NextResponse.json({ error: strength.reason }, { status: 400 });
  const row = consumeEmailToken(parsed.data.token, "reset");
  if (!row) return NextResponse.json({ error: "链接无效或已过期" }, { status: 400 });
  const hash = await hashPassword(parsed.data.newPassword);
  setUserPassword(row.user_id, hash);
  writeAudit({
    userId: row.user_id,
    action: "change_settings",
    detail: { kind: "password.reset" },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
