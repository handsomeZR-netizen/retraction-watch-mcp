import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { activeScope } from "@/lib/auth/scope";
import { listManuscriptsForScope } from "@/lib/db/manuscripts";
import { listProjectsForScope } from "@/lib/db/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One-shot endpoint that bundles every payload AppSidebar needs on first
// render: active manuscripts, archived manuscripts, and projects. Saves two
// extra HK round-trips (~440 ms each on this deployment) compared to the
// previous parallel fetch of three separate endpoints.
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const scope = activeScope(auth.user);

  const toItem = (row: ReturnType<typeof listManuscriptsForScope>[number]) => ({
    id: row.id,
    fileName: row.file_name,
    fileType: row.file_type,
    bytes: row.bytes,
    uploadedAt: row.uploaded_at,
    status: row.status,
    verdict: row.verdict,
    title: row.metadata_title,
    totals: row.totals_json ? (JSON.parse(row.totals_json) as Record<string, number>) : null,
    error: row.error,
    projectId: row.project_id,
    archived: row.archived === 1,
  });

  const items = listManuscriptsForScope(scope, { limit: 80, offset: 0, archived: false }).map(toItem);
  const archivedItems = listManuscriptsForScope(scope, { limit: 30, offset: 0, archived: true }).map(toItem);
  const projects = listProjectsForScope(scope);

  return NextResponse.json({
    user: { role: auth.user.role },
    items,
    archivedItems,
    projects,
  });
}
