import { createHash } from "node:crypto";
import fs from "node:fs";
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
 *
 * Resolves the salt from env vars in this order:
 *   1. RW_DATA_KEY (raw)
 *   2. RW_DATA_KEY_FILE (path; for docker secrets)
 *   3. RW_SESSION_SECRET (raw)
 *   4. RW_SESSION_SECRET_FILE (path)
 *   5. "rw-screen-dev" — only allowed when NODE_ENV !== "production".
 */
function hashIp(ip: string): string {
  const salt = resolveAuditSalt();
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

let cachedSalt: string | null = null;

function resolveAuditSalt(): string {
  if (cachedSalt) return cachedSalt;
  const candidates = [
    process.env.RW_DATA_KEY?.trim(),
    readFileEnv("RW_DATA_KEY_FILE"),
    process.env.RW_SESSION_SECRET?.trim(),
    readFileEnv("RW_SESSION_SECRET_FILE"),
  ];
  for (const value of candidates) {
    if (value) {
      cachedSalt = value;
      return value;
    }
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "audit IP hashing requires RW_DATA_KEY or RW_SESSION_SECRET (or *_FILE) in production",
    );
  }
  cachedSalt = "rw-screen-dev";
  return cachedSalt;
}

function readFileEnv(name: string): string | null {
  const file = process.env[name]?.trim();
  if (!file) return null;
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
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
