import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/db/audit";
import { createEmailToken } from "@/lib/db/email-tokens";
import { findUserByEmail } from "@/lib/db/users";
import { appBaseUrl, sendMail } from "@/lib/email/mailer";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({ email: z.string().email().max(254) });

// Minimum total time for the response so existing-user vs unknown-user paths
// have indistinguishable latency. Longer than the bcrypt-style timing leak;
// short enough that real users notice no UX impact.
const MIN_RESPONSE_MS = 600;

export async function POST(req: Request) {
  const startedAt = Date.now();
  const ip = getRequestIp(req.headers);
  const limit = rateLimit(`forgot:${ip}`, { limit: 5, windowMs: 60_000 });
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
  const email = parsed.data.email.trim().toLowerCase();
  const user = findUserByEmail(email);
  // Always respond OK to avoid email enumeration; only enqueue mail send when
  // user actually exists. The actual SMTP send happens *after* we equalize
  // the response latency so existing-user vs unknown-user paths take the same
  // wall-clock time.
  let mailWork: Promise<void> | null = null;
  if (user) {
    const tok = createEmailToken({
      userId: user.id,
      email,
      kind: "reset",
      expiresInHours: 1,
    });
    const link = `${appBaseUrl(req)}/reset/${tok.token}`;
    mailWork = (async () => {
      const result = await sendMail({
        to: email,
        subject: "[RW Screen] 重置密码",
        text: `点击下方链接重置密码（1 小时内有效）：\n\n${link}\n\n如非本人操作请忽略。`,
      }).catch(() => ({ delivered: false }));
      writeAudit({
        userId: user.id,
        action: "change_settings",
        detail: { kind: "password.reset_request", delivered: result.delivered },
        ip,
        userAgent: req.headers.get("user-agent"),
      });
    })();
  }

  // Equalize timing between known and unknown emails.
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_RESPONSE_MS) {
    await new Promise((r) => setTimeout(r, MIN_RESPONSE_MS - elapsed));
  }
  // Fire-and-forget the mail send: don't make user wait on SMTP.
  if (mailWork) void mailWork;
  return NextResponse.json({ ok: true });
}
