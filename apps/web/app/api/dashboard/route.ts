import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { activeScope } from "@/lib/auth/scope";
import { loadConfig } from "@/lib/config";
import { getAppDb } from "@/lib/db/app-db";
import { findUserById } from "@/lib/db/users";
import { getWorkspace, listWorkspaceMembers } from "@/lib/db/workspaces";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RecentRow {
  id: string;
  file_name: string;
  file_type: string;
  uploaded_at: string;
  status: "parsing" | "done" | "error";
  verdict: "PASS" | "REVIEW" | "FAIL" | null;
  metadata_title: string | null;
  totals_json: string | null;
}

interface VerdictBucket {
  verdict: "PASS" | "REVIEW" | "FAIL" | null;
  n: number;
}

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const user = findUserById(auth.user.id);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  const scope = activeScope(auth.user);
  const db = getAppDb();

  const where = scope.workspaceId
    ? "workspace_id = ?"
    : "user_id = ? AND workspace_id IS NULL";
  const param = scope.workspaceId ?? scope.userId;

  const total = (db
    .prepare(`SELECT COUNT(*) AS n FROM manuscripts WHERE ${where}`)
    .get(param) as { n: number }).n;

  const buckets = db
    .prepare(`SELECT verdict, COUNT(*) AS n FROM manuscripts WHERE ${where} GROUP BY verdict`)
    .all(param) as VerdictBucket[];

  const stats = { total, pass: 0, review: 0, fail: 0, parsing: 0, error: 0 };
  for (const b of buckets) {
    if (b.verdict === "PASS") stats.pass = b.n;
    else if (b.verdict === "REVIEW") stats.review = b.n;
    else if (b.verdict === "FAIL") stats.fail = b.n;
  }

  const statusBuckets = db
    .prepare(`SELECT status, COUNT(*) AS n FROM manuscripts WHERE ${where} GROUP BY status`)
    .all(param) as Array<{ status: string; n: number }>;
  for (const s of statusBuckets) {
    if (s.status === "parsing") stats.parsing = s.n;
    else if (s.status === "error") stats.error = s.n;
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const last7d = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM manuscripts WHERE ${where} AND uploaded_at >= ?`,
    )
    .get(param, sevenDaysAgo) as { n: number }).n;

  const recentRows = db
    .prepare(
      `SELECT id, file_name, file_type, uploaded_at, status, verdict, metadata_title, totals_json
       FROM manuscripts WHERE ${where}
       ORDER BY uploaded_at DESC LIMIT 5`,
    )
    .all(param) as RecentRow[];

  const recent = recentRows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    fileType: r.file_type,
    uploadedAt: r.uploaded_at,
    status: r.status,
    verdict: r.verdict,
    title: r.metadata_title,
    totals: r.totals_json
      ? (JSON.parse(r.totals_json) as Record<string, number>)
      : null,
  }));

  const config = await loadConfig();
  let source: { rowCount: number; generatedOn: string | null } | null = null;
  try {
    const repo = await getRepository();
    const snap = repo.getSourceSnapshot();
    source = {
      rowCount: snap?.rowCount ?? 0,
      generatedOn: snap?.generatedOn ?? null,
    };
  } catch {
    source = null;
  }

  let workspace: {
    id: string;
    name: string;
    slug: string;
    memberCount: number;
  } | null = null;
  if (scope.workspaceId) {
    const ws = getWorkspace(scope.workspaceId);
    if (ws) {
      workspace = {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        memberCount: listWorkspaceMembers(ws.id).length,
      };
    }
  }

  return NextResponse.json({
    user: {
      id: user.id,
      displayName: user.display_name,
      username: user.username,
      role: user.role,
      avatarSeed: user.avatar_seed ?? user.username,
    },
    scope: { workspaceId: scope.workspaceId },
    workspace,
    stats: { ...stats, last7d },
    recent,
    llm: {
      enabled: config.llm.enabled && config.llm.apiKey.length > 0,
      model: config.llm.model,
    },
    source,
  });
}
