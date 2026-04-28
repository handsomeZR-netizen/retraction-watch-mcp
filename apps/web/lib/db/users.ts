import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";
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
  email: string | null;
  email_verified: 0 | 1;
  active_workspace_id: string | null;
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

const ENCRYPTED_VALUE_PREFIX = "enc:v1:";
const DEV_SESSION_SECRET = "dev-only-rw-screen-session-secret-change-me-in-production-32bytes";

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

function isEncryptedValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_VALUE_PREFIX);
}

function dataKey(): Buffer {
  const raw = process.env.RW_DATA_KEY?.trim() ?? readFileEnv("RW_DATA_KEY_FILE");
  if (raw) {
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error("RW_DATA_KEY must be a 32-byte hex string");
    }
    return Buffer.from(raw, "hex");
  }
  const sessionSecret =
    process.env.RW_SESSION_SECRET?.trim() ?? readFileEnv("RW_SESSION_SECRET_FILE");
  if (sessionSecret) {
    return createHash("sha256").update(sessionSecret).digest();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "LLM settings encryption requires RW_DATA_KEY or RW_SESSION_SECRET (or *_FILE) in production",
    );
  }
  return createHash("sha256").update(DEV_SESSION_SECRET).digest();
}

function readFileEnv(name: string): string | null {
  const file = process.env[name]?.trim();
  if (!file) return null;
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    return value || null;
  } catch (err) {
    throw new Error(`failed to read ${name}=${file}: ${err}`);
  }
}

function encryptString(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTED_VALUE_PREFIX.slice(0, -1),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function decryptString(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}:` !== ENCRYPTED_VALUE_PREFIX) {
    throw new Error("invalid encrypted value");
  }
  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const ciphertext = Buffer.from(parts[4], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", dataKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
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
