import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import {
  findUserById,
  setAvatarSeed,
  setDisplayName,
} from "@/lib/db/users";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const user = findUserById(auth.user.id);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    avatarSeed: user.avatar_seed ?? user.username,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  let body: { displayName?: unknown; avatarSeed?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  if (typeof body.displayName === "string") {
    const value = body.displayName.trim().slice(0, 64);
    setDisplayName(auth.user.id, value || null);
  }
  if (typeof body.avatarSeed === "string") {
    const value = body.avatarSeed.trim().slice(0, 64);
    setAvatarSeed(auth.user.id, value || null);
  }
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { kind: "profile" },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
