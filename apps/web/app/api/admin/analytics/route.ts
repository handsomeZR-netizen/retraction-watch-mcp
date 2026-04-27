import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import {
  countScreeningLogs,
  getScreeningLogStats,
  listScreeningLogs,
  type LogFilters,
} from "@/lib/db/screening-logs";
import { findUserById } from "@/lib/db/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseFilters(url: URL): LogFilters {
  const filters: LogFilters = {};
  const verdictRaw = url.searchParams.getAll("verdict");
  const verdictAllowed = new Set(["PASS", "REVIEW", "FAIL"]);
  const verdict = verdictRaw.filter((v) => verdictAllowed.has(v)) as Array<"PASS" | "REVIEW" | "FAIL">;
  if (verdict.length > 0) filters.verdict = verdict;
  const from = url.searchParams.get("from");
  if (from) filters.since = from;
  const to = url.searchParams.get("to");
  if (to) filters.until = to;
  const search = url.searchParams.get("search");
  if (search) filters.search = search;
  const userId = url.searchParams.get("userId");
  if (userId) filters.userId = userId;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  filters.limit = limit;
  filters.offset = offset;
  return filters;
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const filters = parseFilters(url);
  const items = listScreeningLogs(filters).map((row) => ({
    id: row.id,
    userId: row.user_id,
    userLabel: row.user_id ? (findUserById(row.user_id)?.username ?? row.user_id) : null,
    workspaceId: row.workspace_id,
    scope: row.scope,
    fileName: row.file_name,
    fileType: row.file_type,
    title: row.title,
    bytes: row.bytes,
    verdict: row.verdict,
    refsTotal: row.refs_total,
    refsHit: row.refs_confirmed + row.refs_likely + row.refs_possible,
    authorsHit: row.authors_confirmed + row.authors_likely + row.authors_possible,
    affiliations: row.affiliations_json
      ? (JSON.parse(row.affiliations_json) as string[])
      : [],
    createdAt: row.created_at,
  }));
  const total = countScreeningLogs(filters);
  const stats = getScreeningLogStats({
    verdict: filters.verdict,
    since: filters.since,
    until: filters.until,
    search: filters.search,
    userId: filters.userId,
  });
  return NextResponse.json({ items, total, stats, limit: filters.limit, offset: filters.offset });
}
