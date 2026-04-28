import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { activeScope } from "@/lib/auth/scope";
import {
  countManuscriptsForScope,
  listManuscriptsForScope,
} from "@/lib/db/manuscripts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { user } = auth;
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const archivedParam = url.searchParams.get("archived");
  const projectParam = url.searchParams.get("project");
  const opts: {
    limit: number;
    offset: number;
    archived?: boolean;
    projectId?: string | null;
  } = { limit, offset };
  if (archivedParam === "true" || archivedParam === "1") opts.archived = true;
  else if (archivedParam === "false" || archivedParam === "0") opts.archived = false;
  if (projectParam === "none") opts.projectId = null;
  else if (projectParam) opts.projectId = projectParam;

  const scope = activeScope(user);
  const items = listManuscriptsForScope(scope, opts).map((row) => ({
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
  }));
  return NextResponse.json({
    items,
    total: countManuscriptsForScope(scope, {
      archived: opts.archived,
      projectId: opts.projectId,
    }),
    limit,
    offset,
    scope,
  });
}
