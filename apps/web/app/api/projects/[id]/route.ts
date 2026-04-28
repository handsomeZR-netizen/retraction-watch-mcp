import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { activeScope } from "@/lib/auth/scope";
import { isWorkspaceMember } from "@/lib/db/workspaces";
import { deleteProject, getProject, renameProject, setProjectColor } from "@/lib/db/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function canAccessProject(
  user: { id: string },
  project: { owner_id: string; workspace_id: string | null },
): boolean {
  if (project.workspace_id) {
    return isWorkspaceMember(project.workspace_id, user.id) !== null;
  }
  return project.owner_id === user.id;
}

const PatchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  color: z.string().max(16).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const project = getProject(id);
  if (!project || !canAccessProject(auth.user, project)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "字段不合法" }, { status: 400 });
  if (parsed.data.name !== undefined) renameProject(id, parsed.data.name);
  if (parsed.data.color !== undefined) setProjectColor(id, parsed.data.color);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const project = getProject(id);
  if (!project || !canAccessProject(auth.user, project)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Workspace project: only owner/admin in workspace can delete; personal: owner only.
  const scope = activeScope(auth.user);
  if (project.workspace_id) {
    const role = isWorkspaceMember(project.workspace_id, auth.user.id);
    if (role !== "owner" && role !== "admin" && project.owner_id !== auth.user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (project.owner_id !== auth.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  void scope;
  deleteProject(id);
  return NextResponse.json({ ok: true });
}
