import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { rateLimit } from "@/lib/auth/rate-limit";
import { startParseJob } from "@/lib/parse-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const limited = rateLimit(`parse-start:${auth.user.id}`, {
    limit: 30,
    windowMs: 60 * 60_000,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const manuscriptId =
    body && typeof body === "object" && "manuscriptId" in body
      ? (body as { manuscriptId?: unknown }).manuscriptId
      : null;
  if (typeof manuscriptId !== "string" || !manuscriptId.trim()) {
    return NextResponse.json({ error: "manuscriptId required" }, { status: 400 });
  }

  const started = startParseJob({ manuscriptId: manuscriptId.trim(), user: auth.user });
  if (!started.ok) {
    return NextResponse.json({ error: started.error }, { status: started.status });
  }
  return NextResponse.json({ ok: true, parseJobId: started.parseJobId });
}
