import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { activeScope } from "@/lib/auth/scope";
import { createProject, listProjectsForScope } from "@/lib/db/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const scope = activeScope(auth.user);
  return NextResponse.json({ projects: listProjectsForScope(scope) });
}

const Schema = z.object({
  name: z.string().min(1).max(64),
  color: z.string().max(16).nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "字段不合法" }, { status: 400 });
  const scope = activeScope(auth.user);
  const project = createProject({
    name: parsed.data.name,
    color: parsed.data.color ?? null,
    ownerId: auth.user.id,
    workspaceId: scope.workspaceId,
  });
  return NextResponse.json({ project });
}
