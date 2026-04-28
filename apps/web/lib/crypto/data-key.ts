import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";

export const ENCRYPTED_VALUE_PREFIX = "enc:v1:";
const DEV_SESSION_SECRET =
  "dev-only-rw-screen-session-secret-change-me-in-production-32bytes";

export function isEncryptedValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_VALUE_PREFIX);
}

export function encryptString(plaintext: string): string {
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

export function decryptString(encoded: string): string {
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
      "encryption requires RW_DATA_KEY or RW_SESSION_SECRET (or *_FILE) in production",
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
