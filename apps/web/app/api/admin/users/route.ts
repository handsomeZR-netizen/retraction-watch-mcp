import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { countManuscriptsByUser } from "@/lib/db/manuscripts";
import { countUsersForAdmin, listUsersForAdmin } from "@/lib/db/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const search = url.searchParams.get("q");
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const users = listUsersForAdmin({ search, limit, offset }).map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    disabled: u.disabled === 1,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    avatarSeed: u.avatar_seed ?? u.username,
    manuscripts: countManuscriptsByUser(u.id),
  }));
  return NextResponse.json({
    users,
    total: countUsersForAdmin(search),
    limit,
    offset,
  });
}
