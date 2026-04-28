import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { canAccessManuscript } from "@/lib/auth/scope";
import { getRequestIp } from "@/lib/auth/validate";
import { writeAudit } from "@/lib/db/audit";
import { getManuscript, setManuscriptArchived, setManuscriptProject } from "@/lib/db/manuscripts";
import { getProject, type ProjectRow } from "@/lib/db/projects";
import { isWorkspaceMember } from "@/lib/db/workspaces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({
  projectId: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = getManuscript(id);
  if (!row || !canAccessManuscript(auth.user, row)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "字段不合法" }, { status: 400 });

  if (parsed.data.projectId !== undefined) {
    if (parsed.data.projectId === null) {
      setManuscriptProject(id, null);
    } else {
      const project = getProject(parsed.data.projectId);
      if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
      // Project scope must match manuscript scope.
      if ((project.workspace_id ?? null) !== (row.workspace_id ?? null)) {
        return NextResponse.json({ error: "project scope mismatch" }, { status: 400 });
      }
      if (!canUseProject(auth.user.id, project)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      setManuscriptProject(id, project.id);
    }
  }
  if (parsed.data.archived !== undefined) {
    setManuscriptArchived(id, parsed.data.archived);
  }
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: {
      manuscriptId: id,
      kind: "organize",
      projectId: parsed.data.projectId === null ? null : parsed.data.projectId ?? undefined,
      archived: parsed.data.archived,
    },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}

function canUseProject(userId: string, project: ProjectRow): boolean {
  if (project.workspace_id) {
    return isWorkspaceMember(project.workspace_id, userId) !== null;
  }
  return project.owner_id === userId;
}
