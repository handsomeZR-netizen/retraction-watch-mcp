import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { hashPassword, isStrongEnough, verifyPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/db/audit";
import { findUserById, setUserPassword } from "@/lib/db/users";
import { destroySession } from "@/lib/auth/session";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string") {
    return NextResponse.json({ error: "字段缺失" }, { status: 400 });
  }
  const strength = isStrongEnough(body.newPassword);
  if (!strength.ok) return NextResponse.json({ error: strength.reason }, { status: 400 });

  const user = findUserById(auth.user.id);
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  const ok = await verifyPassword(body.currentPassword, user.password_hash);
  if (!ok) return NextResponse.json({ error: "当前密码不正确" }, { status: 401 });

  const newHash = await hashPassword(body.newPassword);
  setUserPassword(user.id, newHash);
  writeAudit({
    userId: user.id,
    action: "change_settings",
    detail: { kind: "password" },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  await destroySession();
  return NextResponse.json({ ok: true, signedOut: true });
}
