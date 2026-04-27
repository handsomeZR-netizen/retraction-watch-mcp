import { nanoid } from "nanoid";
import { getAppDb } from "./app-db";

export type EmailTokenKind = "verify" | "reset";

export interface EmailTokenRow {
  token: string;
  user_id: string;
  kind: EmailTokenKind;
  email: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export function createEmailToken(input: {
  userId: string;
  email: string;
  kind: EmailTokenKind;
  expiresInHours?: number;
}): EmailTokenRow {
  const token = nanoid(40);
  const now = new Date();
  const expires = new Date(now.getTime() + (input.expiresInHours ?? 24) * 3600_000);
  getAppDb()
    .prepare(
      `INSERT INTO email_tokens (token, user_id, kind, email, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(token, input.userId, input.kind, input.email, now.toISOString(), expires.toISOString());
  return {
    token,
    user_id: input.userId,
    kind: input.kind,
    email: input.email,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    used_at: null,
  };
}

export function consumeEmailToken(token: string, kind: EmailTokenKind): EmailTokenRow | null {
  const row = getAppDb()
    .prepare("SELECT * FROM email_tokens WHERE token = ? AND kind = ?")
    .get(token, kind) as EmailTokenRow | undefined;
  if (!row) return null;
  if (row.used_at) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  getAppDb()
    .prepare("UPDATE email_tokens SET used_at = ? WHERE token = ?")
    .run(new Date().toISOString(), token);
  return row;
}
