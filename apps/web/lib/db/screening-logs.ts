import type { ManuscriptScreenResult } from "@rw/core";
import { getAppDb } from "./app-db";

export interface ScreeningLogRow {
  id: string;
  user_id: string | null;
  workspace_id: string | null;
  scope: "personal" | "workspace";
  file_name: string;
  file_type: string;
  bytes: number;
  sha256: string | null;
  title: string | null;
  authors_json: string;
  affiliations_json: string | null;
  emails_json: string | null;
  verdict: "PASS" | "REVIEW" | "FAIL";
  refs_total: number;
  refs_confirmed: number;
  refs_likely: number;
  refs_possible: number;
  authors_confirmed: number;
  authors_likely: number;
  authors_possible: number;
  hit_summary_json: string | null;
  llm_calls: number;
  policy_version: string | null;
  created_at: string;
}

interface WriteInput {
  result: ManuscriptScreenResult;
  userId: string | null;
  workspaceId: string | null;
  bytes: number;
  sha256: string | null;
}

interface HitSummary {
  kind: "reference" | "author";
  verdict: string;
  title?: string | null;
  name?: string | null;
  rwRecordId?: string | null;
  reason?: string | null;
}

export function writeScreeningLog(input: WriteInput): void {
  const { result, userId, workspaceId, bytes, sha256 } = input;
  const scope: "personal" | "workspace" = workspaceId ? "workspace" : "personal";

  const affiliations = Array.from(
    new Set(
      result.metadata.authors
        .map((a) => a.affiliation?.trim())
        .filter((s): s is string => Boolean(s)),
    ),
  );
  const emails = Array.from(
    new Set(
      result.metadata.authors
        .map((a) => a.email?.trim().toLowerCase())
        .filter((s): s is string => Boolean(s)),
    ),
  );

  const hitSummary: HitSummary[] = [];
  for (const ref of result.screenedReferences) {
    if (ref.result.verdict === "no_match") continue;
    hitSummary.push({
      kind: "reference",
      verdict: ref.result.verdict,
      title: ref.reference.title ?? ref.reference.raw.slice(0, 200),
      rwRecordId: ref.result.bestCandidate?.record.recordId ?? null,
      reason: ref.result.bestCandidate?.record.reason ?? null,
    });
  }
  for (const a of result.screenedAuthors) {
    if (a.verdict === "no_match") continue;
    hitSummary.push({
      kind: "author",
      verdict: a.verdict,
      name: a.author.name,
      rwRecordId: a.matchedRecord?.recordId ?? null,
      reason: a.matchedRecord?.reason ?? null,
    });
  }

  getAppDb()
    .prepare(
      `INSERT INTO screening_logs (
        id, user_id, workspace_id, scope,
        file_name, file_type, bytes, sha256,
        title, authors_json, affiliations_json, emails_json,
        verdict,
        refs_total, refs_confirmed, refs_likely, refs_possible,
        authors_confirmed, authors_likely, authors_possible,
        hit_summary_json, llm_calls, policy_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      result.manuscriptId,
      userId,
      workspaceId,
      scope,
      result.fileName,
      result.fileType,
      bytes,
      sha256,
      result.metadata.title,
      JSON.stringify(result.metadata.authors),
      affiliations.length > 0 ? JSON.stringify(affiliations) : null,
      emails.length > 0 ? JSON.stringify(emails) : null,
      result.verdict,
      result.totals.references,
      result.totals.confirmed,
      result.totals.likely,
      result.totals.possible,
      result.totals.authorsConfirmed ?? 0,
      result.totals.authorsLikely ?? 0,
      result.totals.authorsPossible ?? 0,
      hitSummary.length > 0 ? JSON.stringify(hitSummary) : null,
      result.network.deepseekCalls,
      result.policyVersion,
      new Date().toISOString(),
    );
}

export interface LogFilters {
  userId?: string | null;
  workspaceId?: string | null;
  scopeUserId?: string;        // restrict to this user's logs (personal scope view)
  verdict?: Array<"PASS" | "REVIEW" | "FAIL">;
  since?: string;
  until?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

function buildWhere(filters: LogFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.userId !== undefined) {
    if (filters.userId === null) {
      clauses.push("user_id IS NULL");
    } else {
      clauses.push("user_id = ?");
      params.push(filters.userId);
    }
  }
  if (filters.scopeUserId) {
    clauses.push("user_id = ?");
    params.push(filters.scopeUserId);
  }
  if (filters.workspaceId !== undefined) {
    if (filters.workspaceId === null) {
      clauses.push("workspace_id IS NULL");
    } else {
      clauses.push("workspace_id = ?");
      params.push(filters.workspaceId);
    }
  }
  if (filters.verdict && filters.verdict.length > 0) {
    clauses.push(`verdict IN (${filters.verdict.map(() => "?").join(",")})`);
    params.push(...filters.verdict);
  }
  if (filters.since) {
    clauses.push("created_at >= ?");
    params.push(filters.since);
  }
  if (filters.until) {
    clauses.push("created_at <= ?");
    params.push(filters.until);
  }
  if (filters.search) {
    clauses.push("(file_name LIKE ? OR title LIKE ? OR authors_json LIKE ?)");
    const q = `%${filters.search}%`;
    params.push(q, q, q);
  }
  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function listScreeningLogs(filters: LogFilters): ScreeningLogRow[] {
  const { sql, params } = buildWhere(filters);
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  return getAppDb()
    .prepare(
      `SELECT * FROM screening_logs ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as ScreeningLogRow[];
}

export function countScreeningLogs(filters: LogFilters): number {
  const { sql, params } = buildWhere(filters);
  const r = getAppDb()
    .prepare(`SELECT COUNT(*) AS n FROM screening_logs ${sql}`)
    .get(...params) as { n: number };
  return r.n;
}

export function getScreeningLogStats(filters: LogFilters): {
  total: number;
  pass: number;
  review: number;
  fail: number;
  last30d: number;
} {
  const { sql, params } = buildWhere(filters);
  const total = (getAppDb()
    .prepare(`SELECT COUNT(*) AS n FROM screening_logs ${sql}`)
    .get(...params) as { n: number }).n;
  const buckets = getAppDb()
    .prepare(
      `SELECT verdict, COUNT(*) AS n FROM screening_logs ${sql} GROUP BY verdict`,
    )
    .all(...params) as Array<{ verdict: string; n: number }>;
  const stats = { pass: 0, review: 0, fail: 0 };
  for (const b of buckets) {
    if (b.verdict === "PASS") stats.pass = b.n;
    else if (b.verdict === "REVIEW") stats.review = b.n;
    else if (b.verdict === "FAIL") stats.fail = b.n;
  }
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const sinceWhere = sql ? `${sql} AND created_at >= ?` : "WHERE created_at >= ?";
  const last30d = (getAppDb()
    .prepare(`SELECT COUNT(*) AS n FROM screening_logs ${sinceWhere}`)
    .get(...params, since) as { n: number }).n;
  return { total, ...stats, last30d };
}

export function* iterateScreeningLogs(
  filters: LogFilters,
  pageSize = 500,
): Generator<ScreeningLogRow> {
  let offset = 0;
  for (;;) {
    const rows = listScreeningLogs({ ...filters, limit: pageSize, offset });
    if (rows.length === 0) return;
    for (const row of rows) yield row;
    if (rows.length < pageSize) return;
    offset += pageSize;
  }
}
