import { nanoid } from "nanoid";
import { getAppDb } from "./app-db";

export interface ManuscriptShareRow {
  token: string;
  manuscript_id: string;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
}

/**
 * Create a revocable read-only share token for a manuscript. Default TTL is
 * 7 days; the maximum TTL is capped at 30 days regardless of caller input.
 */
export function createShare(input: {
  manuscriptId: string;
  createdBy: string;
  ttlHours?: number;
}): ManuscriptShareRow {
  // 32-char URL-safe token; nanoid default alphabet includes _ and - which are URL-safe.
  const token = nanoid(40);
  const ttl = Math.min(Math.max(1, Math.floor(input.ttlHours ?? 24 * 7)), 24 * 30);
  const now = new Date();
  const expires = new Date(now.getTime() + ttl * 3600_000);
  getAppDb()
    .prepare(
      `INSERT INTO manuscript_shares
         (token, manuscript_id, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(token, input.manuscriptId, input.createdBy, now.toISOString(), expires.toISOString());
  return {
    token,
    manuscript_id: input.manuscriptId,
    created_by: input.createdBy,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    revoked_at: null,
    last_viewed_at: null,
    view_count: 0,
  };
}

export function listSharesForManuscript(manuscriptId: string): ManuscriptShareRow[] {
  return getAppDb()
    .prepare(
      `SELECT * FROM manuscript_shares
        WHERE manuscript_id = ?
        ORDER BY created_at DESC
        LIMIT 50`,
    )
    .all(manuscriptId) as ManuscriptShareRow[];
}

export function revokeShare(token: string): boolean {
  const info = getAppDb()
    .prepare(
      "UPDATE manuscript_shares SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL",
    )
    .run(new Date().toISOString(), token);
  return info.changes > 0;
}

/**
 * Resolve an active share token. Returns null when the token does not exist,
 * has been revoked, or has expired. Bumps view_count + last_viewed_at as a
 * side effect so the owner can audit usage.
 */
export function resolveActiveShare(token: string): ManuscriptShareRow | null {
  const now = new Date().toISOString();
  const row = getAppDb()
    .prepare(
      `UPDATE manuscript_shares
          SET view_count = view_count + 1,
              last_viewed_at = ?
        WHERE token = ?
          AND revoked_at IS NULL
          AND expires_at >= ?
       RETURNING *`,
    )
    .get(now, token, now) as ManuscriptShareRow | undefined;
  return row ?? null;
}
