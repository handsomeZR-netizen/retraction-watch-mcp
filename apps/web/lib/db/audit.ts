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
    getAppDb()
      .prepare(
        `INSERT INTO audit_log (user_id, action, detail_json, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.userId ?? null,
        input.action,
        detail ? JSON.stringify(detail) : null,
        input.ip ?? null,
        input.userAgent ?? null,
        new Date().toISOString(),
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[audit] failed to persist:", err);
  }
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
