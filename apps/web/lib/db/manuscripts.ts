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
  verdict: "PASS" | "REVIEW" | "FAIL";
  totals: unknown;
  metadataTitle: string | null;
  policyVersion: string;
  resultPath: string;
  generatedAt: string;
}): void {
  getAppDb()
    .prepare(
      `UPDATE manuscripts SET status='done', verdict=?, totals_json=?, metadata_title=?,
        policy_version=?, result_path=?, generated_at=?, error=NULL
       WHERE id=?`,
    )
    .run(
      input.verdict,
      JSON.stringify(input.totals),
      input.metadataTitle,
      input.policyVersion,
      input.resultPath,
      input.generatedAt,
      input.id,
    );
}

export function markManuscriptError(id: string, message: string): void {
  getAppDb()
    .prepare("UPDATE manuscripts SET status='error', error=? WHERE id=?")
    .run(message, id);
}

export function getManuscript(id: string): ManuscriptRow | null {
  const row = getAppDb()
    .prepare("SELECT * FROM manuscripts WHERE id = ?")
    .get(id) as ManuscriptRow | undefined;
  return row ?? null;
}

export function listManuscriptsForScope(
  scope: { userId: string; workspaceId: string | null },
  options: { limit?: number; offset?: number } = {},
): ManuscriptRow[] {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  if (scope.workspaceId) {
    return getAppDb()
      .prepare(
        `SELECT * FROM manuscripts
         WHERE workspace_id = ?
         ORDER BY uploaded_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(scope.workspaceId, limit, offset) as ManuscriptRow[];
  }
  return getAppDb()
    .prepare(
      `SELECT * FROM manuscripts
       WHERE user_id = ? AND workspace_id IS NULL
       ORDER BY uploaded_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(scope.userId, limit, offset) as ManuscriptRow[];
}

export function countManuscriptsForScope(scope: {
  userId: string;
  workspaceId: string | null;
}): number {
  if (scope.workspaceId) {
    const r = getAppDb()
      .prepare("SELECT COUNT(*) AS n FROM manuscripts WHERE workspace_id = ?")
      .get(scope.workspaceId) as { n: number };
    return r.n;
  }
  const r = getAppDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM manuscripts WHERE user_id = ? AND workspace_id IS NULL",
    )
    .get(scope.userId) as { n: number };
  return r.n;
}

export function listManuscriptsByUser(
  userId: string,
  options: { limit?: number; offset?: number } = {},
): ManuscriptRow[] {
  return listManuscriptsForScope({ userId, workspaceId: null }, options);
}

export function countManuscriptsByUser(userId: string): number {
  return countManuscriptsForScope({ userId, workspaceId: null });
}

export function deleteManuscript(id: string): boolean {
  const info = getAppDb().prepare("DELETE FROM manuscripts WHERE id = ?").run(id);
  return info.changes > 0;
}
