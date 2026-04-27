import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { countManuscriptsByUser } from "@/lib/db/manuscripts";
import { listAllUsers } from "@/lib/db/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const users = listAllUsers().map((u) => ({
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
  return NextResponse.json({ users });
}
