import bcrypt from "bcryptjs";

const ROUNDS = 12;
// bcrypt silently truncates input at 72 bytes; allowing 128-character
// passwords means two long passwords sharing the first 72 UTF-8 bytes would
// collide. Cap at 72 bytes here so the validation is honest.
const BCRYPT_MAX_BYTES = 72;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function isStrongEnough(password: string): { ok: boolean; reason?: string } {
  if (password.length < 8) return { ok: false, reason: "密码至少 8 位" };
  if (password.length > 128) return { ok: false, reason: "密码不能超过 128 位" };
  // Reject passwords whose UTF-8 encoding exceeds bcrypt's 72-byte input
  // limit. Most ASCII passwords up to 72 chars are fine; this only triggers
  // for users with many multi-byte characters.
  const byteLength = new TextEncoder().encode(password).byteLength;
  if (byteLength > BCRYPT_MAX_BYTES) {
    return {
      ok: false,
      reason: `密码长度（${byteLength} 字节）超出 bcrypt 上限 ${BCRYPT_MAX_BYTES} 字节，请缩短或减少非 ASCII 字符`,
    };
  }
  return { ok: true };
}
