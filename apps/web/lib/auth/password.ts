import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function isStrongEnough(password: string): { ok: boolean; reason?: string } {
  if (password.length < 8) return { ok: false, reason: "密码至少 8 位" };
  if (password.length > 128) return { ok: false, reason: "密码不能超过 128 位" };
  return { ok: true };
}
