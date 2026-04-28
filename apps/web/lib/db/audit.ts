// Audit log is append-only by design: no UPDATE or DELETE statements anywhere in
// this module. Retention is the operator's responsibility — archive externally
// (logrotate, scheduled SQLite dump, etc.) rather than deleting rows in place.

import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  decryptString,
  encryptString,
  isEncryptedValue,
} from "@/lib/crypto/data-key";
import { getAppDb } from "./app-db";

export type AuditAction =
  | "login"
  | "logout"
  | "register"
  | "upload"
  | "delete_manuscript"
  | "change_settings"
  | "login_failed"
  | "admin_role_change"
  | "admin_disable_user"
  | "admin_force_logout";

export interface AuditLogItem {
  id: number;
  userId: string | null;
  username: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  ip: string | null;
  ipHash: string | null;
  userAgent: string | null;
  createdAt: string;
}

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
  "previousRole",
  "nextRole",
  "forced",
]);

const SENSITIVE_DETAIL_FIELD_ALLOWLIST = new Set([
  "email",
  "targetUsername",
  "targetDisplayName",
  "reason",
]);

export function writeAudit(input: {
  userId?: string | null;
  action: AuditAction;
  detail?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): void {
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
}

interface AuditRow {
  id: number;
  user_id: string | null;
  action: string;
  detail_json: string | null;
  ip: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  created_at: string;
  username: string | null;
}

export function listAuditLog(options: {
  limit?: number;
  action?: string | null;
  userId?: string | null;
} = {}): AuditLogItem[] {
  const limit = Math.max(1, Math.min(500, options.limit ?? 200));
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.action) {
    where.push("a.action = ?");
    params.push(options.action);
  }
  if (options.userId) {
    where.push("a.user_id = ?");
    params.push(options.userId);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = getAppDb()
    .prepare(
      `SELECT a.*, u.username AS username
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
        ${whereSql}
        ORDER BY a.id DESC
        LIMIT ?`,
    )
    .all(...params, limit) as AuditRow[];
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: r.username,
    action: r.action,
    detail: decodeAuditDetail(r.detail_json),
    ip: r.ip,
    ipHash: r.ip_hash,
    userAgent: r.user_agent,
    createdAt: r.created_at,
  }));
}

export function decodeAuditDetail(detailJson: string | null): Record<string, unknown> | null {
  if (!detailJson) return null;
  const parsed = JSON.parse(detailJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  const sensitive = out.sensitive;
  if (sensitive && typeof sensitive === "object" && !Array.isArray(sensitive)) {
    const decrypted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sensitive)) {
      if (
        SENSITIVE_DETAIL_FIELD_ALLOWLIST.has(key) &&
        typeof value === "string" &&
        isEncryptedValue(value)
      ) {
        decrypted[key] = JSON.parse(decryptString(value)) as unknown;
      }
    }
    if (Object.keys(decrypted).length > 0) out.sensitive = decrypted;
    else delete out.sensitive;
  }
  return out;
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

// Cache keyed by the resolved secret, so a test that swaps RW_SESSION_SECRET /
// RW_DATA_KEY mid-suite gets a fresh salt on the next call instead of a stale
// hash. Production env never changes after startup, so the cache still hits.
let cachedSalt: { key: string; value: string } | null = null;

function resolveAuditSalt(): string {
  const candidates = [
    process.env.RW_DATA_KEY?.trim(),
    readFileEnv("RW_DATA_KEY_FILE"),
    process.env.RW_SESSION_SECRET?.trim(),
    readFileEnv("RW_SESSION_SECRET_FILE"),
  ];
  const resolved = candidates.find((v) => v) ?? null;
  if (resolved) {
    if (cachedSalt?.key !== resolved) cachedSalt = { key: resolved, value: resolved };
    return cachedSalt.value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "audit IP hashing requires RW_DATA_KEY or RW_SESSION_SECRET (or *_FILE) in production",
    );
  }
  if (cachedSalt?.key !== "__dev__") cachedSalt = { key: "__dev__", value: "rw-screen-dev" };
  return cachedSalt.value;
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

function sanitizeAuditDetail(detail: unknown): Record<string, unknown> | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (key === "sensitive") {
      const sensitive = sanitizeSensitiveAuditDetail(value);
      if (sensitive) out.sensitive = sensitive;
      continue;
    }
    if (!DETAIL_FIELD_ALLOWLIST.has(key) || !isSafeAuditValue(value)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeSensitiveAuditDetail(detail: unknown): Record<string, string> | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (!SENSITIVE_DETAIL_FIELD_ALLOWLIST.has(key) || !isSafeAuditValue(value)) continue;
    out[key] = encryptString(JSON.stringify(value));
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
