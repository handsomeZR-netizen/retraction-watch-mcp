import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/db/audit";
import { findUserByUsername, touchLastLogin } from "@/lib/db/users";
import { verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { loginAs } from "@/lib/auth/session";
import { getRequestIp, validateUsername } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = getRequestIp(req.headers);
  const ua = req.headers.get("user-agent") ?? null;
  const ipLimit = rateLimit(`login-ip:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "登录尝试过于频繁，请 1 分钟后再试" },
      { status: 429 },
    );
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const u = validateUsername(body.username);
  if (!u.ok || typeof body.password !== "string") {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }
  const userLimit = rateLimit(`login-user:${u.value}`, { limit: 5, windowMs: 60_000 });
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: "该账号登录尝试过多，请稍后再试" },
      { status: 429 },
    );
  }

  const user = findUserByUsername(u.value!);
  if (!user || user.disabled) {
    writeAudit({ action: "login_failed", detail: { username: u.value }, ip, userAgent: ua });
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }
  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) {
    writeAudit({ userId: user.id, action: "login_failed", ip, userAgent: ua });
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  touchLastLogin(user.id);
  await loginAs(user);
  writeAudit({ userId: user.id, action: "login", ip, userAgent: ua });
  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    },
  });
}
