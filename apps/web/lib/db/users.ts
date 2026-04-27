import { nanoid } from "nanoid";
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
    return JSON.parse(user.llm_settings_json) as UserLlmSettings;
  } catch {
    return null;
  }
}

export function setUserLlmSettings(userId: string, value: UserLlmSettings | null): void {
  getAppDb()
    .prepare("UPDATE users SET llm_settings_json = ? WHERE id = ?")
    .run(value ? JSON.stringify(value) : null, userId);
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

export function setUserDisabled(userId: string, disabled: boolean): void {
  getAppDb()
    .prepare(
      "UPDATE users SET disabled = ?, session_version = session_version + 1 WHERE id = ?",
    )
    .run(disabled ? 1 : 0, userId);
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
