import { getAppDb } from "./app-db";

export type AuditAction =
  | "login"
  | "logout"
  | "register"
  | "upload"
  | "delete_manuscript"
  | "change_settings"
  | "login_failed";

export function writeAudit(input: {
  userId?: string | null;
  action: AuditAction;
  detail?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): void {
  getAppDb()
    .prepare(
      `INSERT INTO audit_log (user_id, action, detail_json, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId ?? null,
      input.action,
      input.detail ? JSON.stringify(input.detail) : null,
      input.ip ?? null,
      input.userAgent ?? null,
      new Date().toISOString(),
    );
}
