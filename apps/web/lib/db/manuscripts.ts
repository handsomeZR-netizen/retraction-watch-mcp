import { getAppDb } from "./app-db";

export interface ManuscriptRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  file_name: string;
  file_type: string;
  bytes: number;
  sha256: string | null;
  uploaded_at: string;
  status: "parsing" | "done" | "error";
  verdict: "PASS" | "REVIEW" | "FAIL" | null;
  totals_json: string | null;
  metadata_title: string | null;
  result_path: string | null;
  policy_version: string | null;
  generated_at: string | null;
  error: string | null;
  project_id: string | null;
  archived: number;
  parse_job_id: string | null;
}

export function setManuscriptProject(id: string, projectId: string | null): void {
  getAppDb()
    .prepare("UPDATE manuscripts SET project_id = ? WHERE id = ?")
    .run(projectId, id);
}

export function setManuscriptArchived(id: string, archived: boolean): void {
  getAppDb()
    .prepare("UPDATE manuscripts SET archived = ? WHERE id = ?")
    .run(archived ? 1 : 0, id);
}

export function insertManuscript(row: {
  id: string;
  userId: string;
  workspaceId: string | null;
  fileName: string;
  fileType: string;
  bytes: number;
  sha256?: string | null;
}): void {
  getAppDb()
    .prepare(
      `INSERT INTO manuscripts (id, user_id, workspace_id, file_name, file_type, bytes, sha256, uploaded_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'parsing')`,
    )
    .run(
      row.id,
      row.userId,
      row.workspaceId,
      row.fileName,
      row.fileType,
      row.bytes,
      row.sha256 ?? null,
      new Date().toISOString(),
    );
}

export function createManuscriptOrFindDuplicate(row: {
  id: string;
  userId: string;
  workspaceId: string | null;
  fileName: string;
  fileType: string;
  bytes: number;
  sha256?: string | null;
}): { manuscriptId: string; deduped: boolean; existing: ManuscriptRow | null } {
  const db = getAppDb();
  const tx = db.transaction(() => {
    const existing = row.sha256
      ? findDoneManuscriptBySha256(
          { userId: row.userId, workspaceId: row.workspaceId },
          row.sha256,
        )
      : null;
    if (existing) {
      return { manuscriptId: existing.id, deduped: true, existing };
    }
    insertManuscript(row);
    return { manuscriptId: row.id, deduped: false, existing: null };
  });
  return tx();
}

export function findDoneManuscriptBySha256(
  scope: { userId: string; workspaceId: string | null },
  sha256: string,
): ManuscriptRow | null {
  const where = scope.workspaceId
    ? "workspace_id = ?"
    : "user_id = ? AND workspace_id IS NULL";
  const param = scope.workspaceId ?? scope.userId;
  const row = getAppDb()
    .prepare(
      `SELECT * FROM manuscripts
       WHERE sha256 = ? AND status = 'done' AND ${where}
       ORDER BY uploaded_at DESC LIMIT 1`,
    )
    .get(sha256, param) as ManuscriptRow | undefined;
  return row ?? null;
}

export function markManuscriptDone(input: {
  id: string;
  parseJobId: string;
  verdict: "PASS" | "REVIEW" | "FAIL";
  totals: unknown;
  metadataTitle: string | null;
  policyVersion: string;
  resultPath: string;
  generatedAt: string;
}): boolean {
  const info = getAppDb()
    .prepare(
      `UPDATE manuscripts SET status='done', parse_job_id=NULL, verdict=?, totals_json=?, metadata_title=?,
        policy_version=?, result_path=?, generated_at=?, error=NULL
       WHERE id=? AND parse_job_id=?`,
    )
    .run(
      input.verdict,
      JSON.stringify(input.totals),
      input.metadataTitle,
      input.policyVersion,
      input.resultPath,
      input.generatedAt,
      input.id,
      input.parseJobId,
    );
  return info.changes > 0;
}

export function markManuscriptError(id: string, parseJobId: string, message: string): boolean {
  const info = getAppDb()
    .prepare("UPDATE manuscripts SET status='error', parse_job_id=NULL, error=? WHERE id=? AND parse_job_id=?")
    .run(message, id, parseJobId);
  return info.changes > 0;
}

export function acquireParseLease(id: string, parseJobId: string): boolean {
  const info = getAppDb()
    .prepare(
      `UPDATE manuscripts
       SET parse_job_id = ?, status = 'parsing', error = NULL
       WHERE id = ? AND (parse_job_id IS NULL OR status != 'parsing')`,
    )
    .run(parseJobId, id);
  return info.changes > 0;
}

export function getManuscript(id: string): ManuscriptRow | null {
  const row = getAppDb()
    .prepare("SELECT * FROM manuscripts WHERE id = ?")
    .get(id) as ManuscriptRow | undefined;
  return row ?? null;
}

interface ListOptions {
  limit?: number;
  offset?: number;
  archived?: boolean;
  projectId?: string | null;  // null → "no project"; undefined → all
}

function buildScopeWhere(
  scope: { userId: string; workspaceId: string | null },
  options: ListOptions,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope.workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(scope.workspaceId);
  } else {
    clauses.push("user_id = ?");
    clauses.push("workspace_id IS NULL");
    params.push(scope.userId);
  }
  if (options.archived !== undefined) {
    clauses.push("archived = ?");
    params.push(options.archived ? 1 : 0);
  }
  if (options.projectId !== undefined) {
    if (options.projectId === null) {
      clauses.push("project_id IS NULL");
    } else {
      clauses.push("project_id = ?");
      params.push(options.projectId);
    }
  }
  return { sql: clauses.join(" AND "), params };
}

export function listManuscriptsForScope(
  scope: { userId: string; workspaceId: string | null },
  options: ListOptions = {},
): ManuscriptRow[] {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const { sql, params } = buildScopeWhere(scope, options);
  return getAppDb()
    .prepare(
      `SELECT * FROM manuscripts WHERE ${sql} ORDER BY uploaded_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as ManuscriptRow[];
}

export function countManuscriptsForScope(
  scope: { userId: string; workspaceId: string | null },
  options: Omit<ListOptions, "limit" | "offset"> = {},
): number {
  const { sql, params } = buildScopeWhere(scope, options);
  const r = getAppDb()
    .prepare(`SELECT COUNT(*) AS n FROM manuscripts WHERE ${sql}`)
    .get(...params) as { n: number };
  return r.n;
}

export function listManuscriptsByUser(
  userId: string,
  options: { limit?: number; offset?: number; archived?: boolean } = {},
): ManuscriptRow[] {
  return listManuscriptsForScope(
    { userId, workspaceId: null },
    { ...options, archived: options.archived ?? false },
  );
}

export function countManuscriptsByUser(userId: string): number {
  return countManuscriptsForScope({ userId, workspaceId: null });
}

export function deleteManuscript(id: string): boolean {
  const info = getAppDb().prepare("DELETE FROM manuscripts WHERE id = ?").run(id);
  return info.changes > 0;
}

export function listErroredManuscriptsOlderThan(cutoffIso: string): ManuscriptRow[] {
  return getAppDb()
    .prepare("SELECT * FROM manuscripts WHERE status = 'error' AND uploaded_at < ?")
    .all(cutoffIso) as ManuscriptRow[];
}
