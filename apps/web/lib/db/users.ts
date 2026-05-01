import { nanoid } from "nanoid";
import {
  decryptString,
  encryptString,
  isEncryptedValue,
} from "@/lib/crypto/data-key";
import { getAppDb } from "./app-db";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  role: "user" | "admin";
  created_at: string;
  last_login_at: string | null;
  disabled: 0 | 1;
  session_version: number;
  avatar_seed: string | null;
  llm_settings_json: string | null;
  email: string | null;
  email_verified: 0 | 1;
  active_workspace_id: string | null;
  enrichment_contact_email: string | null;
}

export function findUserByEmail(email: string): UserRow | null {
  return (
    (getAppDb()
      .prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)")
      .get(email) as UserRow | undefined) ?? null
  );
}

export function setUserEmail(userId: string, email: string | null, verified: boolean): void {
  getAppDb()
    .prepare("UPDATE users SET email = ?, email_verified = ? WHERE id = ?")
    .run(email, verified ? 1 : 0, userId);
}

export function markEmailVerified(userId: string): void {
  getAppDb().prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(userId);
}

export interface UserLlmSettings {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  enableHeaderParse?: boolean;
}

export function getUserLlmSettings(user: UserRow): UserLlmSettings | null {
  if (!user.llm_settings_json) return null;
  try {
    const parsed = JSON.parse(user.llm_settings_json) as UserLlmSettings;
    if (parsed.apiKey) {
      if (isEncryptedValue(parsed.apiKey)) {
        parsed.apiKey = decryptString(parsed.apiKey);
      } else {
        setUserLlmSettings(user.id, parsed);
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setUserLlmSettings(userId: string, value: UserLlmSettings | null): void {
  const stored = value ? encryptLlmSettings(value) : null;
  getAppDb()
    .prepare("UPDATE users SET llm_settings_json = ? WHERE id = ?")
    .run(stored ? JSON.stringify(stored) : null, userId);
}

function encryptLlmSettings(value: UserLlmSettings): UserLlmSettings {
  return {
    ...value,
    apiKey: value.apiKey
      ? isEncryptedValue(value.apiKey)
        ? value.apiKey
        : encryptString(value.apiKey)
      : value.apiKey,
  };
}

export function getUserEnrichmentContactEmail(userId: string): string | null {
  const row = getAppDb()
    .prepare("SELECT enrichment_contact_email FROM users WHERE id = ?")
    .get(userId) as { enrichment_contact_email: string | null } | undefined;
  const value = row?.enrichment_contact_email?.trim();
  return value ? value : null;
}

export function setUserEnrichmentContactEmail(userId: string, email: string | null): void {
  const value = email?.trim();
  getAppDb()
    .prepare("UPDATE users SET enrichment_contact_email = ? WHERE id = ?")
    .run(value && value.length > 0 ? value : null, userId);
}

export function setUserPassword(userId: string, passwordHash: string): void {
  getAppDb()
    .prepare(
      "UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?",
    )
    .run(passwordHash, userId);
}

export function setDisplayName(userId: string, displayName: string | null): void {
  getAppDb()
    .prepare("UPDATE users SET display_name = ? WHERE id = ?")
    .run(displayName, userId);
}

export function setAvatarSeed(userId: string, seed: string | null): void {
  getAppDb()
    .prepare("UPDATE users SET avatar_seed = ? WHERE id = ?")
    .run(seed, userId);
}

export function listAllUsers(): UserRow[] {
  return getAppDb()
    .prepare("SELECT * FROM users ORDER BY created_at DESC")
    .all() as UserRow[];
}

export interface AdminUserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: "user" | "admin";
  created_at: string;
  last_login_at: string | null;
  disabled: 0 | 1;
  avatar_seed: string | null;
}

export function listUsersForAdmin(options: {
  search?: string | null;
  limit?: number;
  offset?: number;
} = {}): AdminUserRow[] {
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const { whereSql, params } = adminUsersWhere(options.search);
  return getAppDb()
    .prepare(
      `SELECT id, username, display_name, role, created_at, last_login_at, disabled, avatar_seed
         FROM users
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as AdminUserRow[];
}

export function countUsersForAdmin(search?: string | null): number {
  const { whereSql, params } = adminUsersWhere(search);
  const row = getAppDb()
    .prepare(`SELECT COUNT(*) AS n FROM users ${whereSql}`)
    .get(...params) as { n: number };
  return row.n;
}

function adminUsersWhere(search?: string | null): {
  whereSql: string;
  params: string[];
} {
  const q = search?.trim().toLowerCase();
  if (!q) return { whereSql: "", params: [] };
  const like = `%${q}%`;
  return {
    whereSql:
      "WHERE LOWER(username) LIKE ? OR LOWER(COALESCE(display_name, '')) LIKE ? OR LOWER(COALESCE(email, '')) LIKE ?",
    params: [like, like, like],
  };
}

export function setUserDisabled(userId: string, disabled: boolean): void {
  getAppDb()
    .prepare(
      "UPDATE users SET disabled = ?, session_version = session_version + 1 WHERE id = ?",
    )
    .run(disabled ? 1 : 0, userId);
}

export function setUserRoleForAdmin(userId: string, role: "user" | "admin"): void {
  getAppDb()
    .prepare("UPDATE users SET role = ?, session_version = session_version + 1 WHERE id = ?")
    .run(role, userId);
}

export function forceLogoutUserForAdmin(userId: string): void {
  bumpSessionVersion(userId);
}

export function countActiveAdmins(): number {
  const row = getAppDb()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0")
    .get() as { n: number };
  return row.n;
}

export function findUserByUsername(username: string): UserRow | null {
  const row = getAppDb()
    .prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?)")
    .get(username) as UserRow | undefined;
  return row ?? null;
}

export function findUserById(id: string): UserRow | null {
  const row = getAppDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
  return row ?? null;
}

export function countUsers(): number {
  const row = getAppDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return row.n;
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  displayName?: string;
  role?: "user" | "admin";
}

export function createUser(input: CreateUserInput): UserRow {
  const id = nanoid();
  const now = new Date().toISOString();
  getAppDb()
    .prepare(
      `INSERT INTO users (id, username, password_hash, display_name, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.username,
      input.passwordHash,
      input.displayName ?? null,
      input.role ?? "user",
      now,
    );
  const created = findUserById(id);
  if (!created) throw new Error("createUser: row missing after insert");
  return created;
}

export function touchLastLogin(userId: string): void {
  getAppDb()
    .prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
    .run(new Date().toISOString(), userId);
}

export function bumpSessionVersion(userId: string): void {
  getAppDb()
    .prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?")
    .run(userId);
}
