import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/db/audit";
import { countUsers, createUser, findUserByUsername } from "@/lib/db/users";
import { hashPassword, isStrongEnough } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { loginAs } from "@/lib/auth/session";
import { getRequestIp, validateUsername } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = getRequestIp(req.headers);
  const ua = req.headers.get("user-agent") ?? null;
  const limit = rateLimit(`register:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let body: { username?: unknown; password?: unknown; displayName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const usernameCheck = validateUsername(body.username);
  if (!usernameCheck.ok) {
    return NextResponse.json({ error: usernameCheck.reason }, { status: 400 });
  }
  if (typeof body.password !== "string") {
    return NextResponse.json({ error: "密码必填" }, { status: 400 });
  }
  const strength = isStrongEnough(body.password);
  if (!strength.ok) {
    return NextResponse.json({ error: strength.reason }, { status: 400 });
  }

  const existing = findUserByUsername(usernameCheck.value!);
  if (existing) {
    return NextResponse.json({ error: "该用户名已注册" }, { status: 409 });
  }

  const hash = await hashPassword(body.password);
  const role = countUsers() === 0 ? "admin" : "user";
  const user = createUser({
    username: usernameCheck.value!,
    passwordHash: hash,
    displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    role,
  });
  await loginAs(user);
  writeAudit({ userId: user.id, action: "register", detail: { role }, ip, userAgent: ua });
  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    },
  });
}
