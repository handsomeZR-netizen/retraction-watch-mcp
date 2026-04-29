import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { activeScope } from "@/lib/auth/scope";
import { writeAudit } from "@/lib/db/audit";
import {
  createManuscriptOrFindDuplicate,
  setManuscriptProject,
} from "@/lib/db/manuscripts";
import { getProject } from "@/lib/db/projects";
import { isWorkspaceMember } from "@/lib/db/workspaces";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getRequestIp } from "@/lib/auth/validate";
import { deleteUpload, saveUpload } from "@/lib/store";
import { validateUploadFile } from "@/lib/manuscripts/upload-validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { user } = auth;
  const limited = rateLimit(`upload:${user.id}`, {
    // 100/h is comfortable for batch reviewers (Cell editor reviewing a
    // workshop submission cluster, lab triaging weekly archives) without
    // letting a runaway script flood the parse queue. The previous 30/h cap
    // tripped during routine bulk-screening flows.
    limit: 100,
    windowMs: 60 * 60_000,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  const validation = await validateUploadFile(file);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: validation.status },
    );
  }
  const projectIdRaw = formData.get("projectId");
  const projectId = typeof projectIdRaw === "string" && projectIdRaw.trim() ? projectIdRaw.trim() : null;
  const manuscriptId = randomUUID();
  const safeName = validation.fileName;
  const fileType = validation.fileType;
  const scope = activeScope(user);
  let projectToAssign: string | null = null;
  if (projectId) {
    const project = getProject(projectId);
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
    if (!canAssignProjectToScope(project, scope, user.id)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    projectToAssign = project.id;
  }

  const record = await saveUpload({
    manuscriptId,
    fileName: safeName,
    fileType,
    body: file.stream(),
  });

  const created = createManuscriptOrFindDuplicate({
    id: manuscriptId,
    userId: user.id,
    workspaceId: scope.workspaceId,
    fileName: safeName,
    fileType,
    bytes: record.bytes,
    sha256: record.sha256,
  });
  if (created.deduped && created.existing) {
    // The freshly-staged file is now an orphan (the existing manuscript wins).
    // Tear it down so we don't leak disk space across repeated dedup hits.
    await deleteUpload(manuscriptId).catch(() => {});
    writeAudit({
      userId: user.id,
      action: "upload",
      detail: {
        manuscriptId: created.existing.id,
        deduped: true,
        fileName: safeName,
        sha256: record.sha256,
        workspaceId: scope.workspaceId,
      },
      ip: getRequestIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({
      ...record,
      manuscriptId: created.existing.id,
      deduped: true,
    });
  }

  if (projectToAssign) {
    setManuscriptProject(manuscriptId, projectToAssign);
  }
  writeAudit({
    userId: user.id,
    action: "upload",
    detail: {
      manuscriptId,
      fileName: safeName,
      fileType,
      bytes: record.bytes,
      sha256: record.sha256,
      workspaceId: scope.workspaceId,
    },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json(record);
}

function canAssignProjectToScope(
  project: { owner_id: string; workspace_id: string | null },
  scope: { workspaceId: string | null },
  userId: string,
): boolean {
  if (scope.workspaceId) {
    return project.workspace_id === scope.workspaceId && isWorkspaceMember(scope.workspaceId, userId) !== null;
  }
  return project.workspace_id === null && project.owner_id === userId;
}
