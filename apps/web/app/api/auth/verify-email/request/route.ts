import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import { createEmailToken } from "@/lib/db/email-tokens";
import { findUserById, setUserEmail } from "@/lib/db/users";
import { appBaseUrl, sendMail } from "@/lib/email/mailer";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({ email: z.string().email().max(254) });

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const ip = getRequestIp(req.headers);
  const limit = rateLimit(`verify-email:${auth.user.id}`, { limit: 3, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "邮箱格式不合法" }, { status: 400 });
  const user = findUserById(auth.user.id);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  const email = parsed.data.email.trim().toLowerCase();
  setUserEmail(user.id, email, false);
  const tok = createEmailToken({
    userId: user.id,
    email,
    kind: "verify",
    expiresInHours: 24,
  });
  const link = `${appBaseUrl(req)}/verify/${tok.token}`;
  const result = await sendMail({
    to: email,
    subject: "[RW Screen] 验证你的邮箱",
    text: `请点击下方链接验证邮箱（24 小时内有效）：\n\n${link}\n\n如非本人操作请忽略此邮件。`,
  });
  writeAudit({
    userId: user.id,
    action: "change_settings",
    detail: { kind: "email.verify_request", delivered: result.delivered },
    ip,
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true, delivered: result.delivered, devLink: result.delivered ? null : link });
}
