import { createHash } from "node:crypto";
import { getAppDb } from "./app-db";

export type AuditAction =
  | "login"
  | "logout"
  | "register"
  | "upload"
  | "delete_manuscript"
  | "change_settings"
  | "login_failed";

const DETAIL_FIELD_ALLOWLIST = new Set([
  "id",
  "kind",
  "target",
  "targetId",
  "targetUserId",
  "userId",
  "workspaceId",
  "manuscriptId",
  "projectId",
  "provider",
  "scope",
  "role",
  "deduped",
  "fileType",
  "bytes",
  "fields",
  "delivered",
  "disabled",
  "archived",
]);

export function writeAudit(input: {
  userId?: string | null;
  action: AuditAction;
  detail?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): void {
  try {
    const detail = sanitizeAuditDetail(input.detail);
    const ipHash = input.ip ? hashIp(input.ip) : null;
    getAppDb()
      .prepare(
        `INSERT INTO audit_log (user_id, action, detail_json, ip, ip_hash, user_agent, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(
        input.userId ?? null,
        input.action,
        detail ? JSON.stringify(detail) : null,
        ipHash,
        input.userAgent ?? null,
        new Date().toISOString(),
      );
  } catch (err) {
    console.warn("[audit] failed to persist:", err);
  }
}

/**
 * Hash a client IP for audit logs. Salted with RW_DATA_KEY (or session secret
 * fallback) so the hash is irreversible across deployments while still letting
 * us correlate same-IP events within one deployment.
 */
function hashIp(ip: string): string {
  const salt =
    process.env.RW_DATA_KEY ?? process.env.RW_SESSION_SECRET ?? "rw-screen-dev";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

export function pruneAuditLog(olderThanDays: number): number {
  const cutoff = new Date(
    Date.now() - olderThanDays * 86_400_000,
  ).toISOString();
  const info = getAppDb()
    .prepare("DELETE FROM audit_log WHERE created_at < ?")
    .run(cutoff);
  return info.changes;
}

function sanitizeAuditDetail(detail: unknown): Record<string, unknown> | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (!DETAIL_FIELD_ALLOWLIST.has(key) || !isSafeAuditValue(value)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function isSafeAuditValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
