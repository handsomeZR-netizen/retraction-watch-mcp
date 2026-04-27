import { getAppDb } from "./app-db";

export interface ManuscriptRow {
  id: string;
  user_id: string;
  file_name: string;
  file_type: string;
  bytes: number;
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
  fileName: string;
  fileType: string;
  bytes: number;
}): void {
  getAppDb()
    .prepare(
      `INSERT INTO manuscripts (id, user_id, file_name, file_type, bytes, uploaded_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'parsing')`,
    )
    .run(row.id, row.userId, row.fileName, row.fileType, row.bytes, new Date().toISOString());
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

export function listManuscriptsByUser(
  userId: string,
  options: { limit?: number; offset?: number } = {},
): ManuscriptRow[] {
  return getAppDb()
    .prepare(
      `SELECT * FROM manuscripts
       WHERE user_id = ?
       ORDER BY uploaded_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, options.limit ?? 50, options.offset ?? 0) as ManuscriptRow[];
}

export function countManuscriptsByUser(userId: string): number {
  const r = getAppDb()
    .prepare("SELECT COUNT(*) AS n FROM manuscripts WHERE user_id = ?")
    .get(userId) as { n: number };
  return r.n;
}

export function deleteManuscript(id: string, userId: string): boolean {
  const info = getAppDb()
    .prepare("DELETE FROM manuscripts WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return info.changes > 0;
}
