import { getAppDb } from "./app-db";

export type OAuthProvider = "github" | "google";

export interface OAuthIdentityRow {
  provider: OAuthProvider;
  provider_id: string;
  user_id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  linked_at: string;
}

export function findIdentity(
  provider: OAuthProvider,
  providerId: string,
): OAuthIdentityRow | null {
  const row = getAppDb()
    .prepare("SELECT * FROM oauth_identities WHERE provider = ? AND provider_id = ?")
    .get(provider, providerId) as OAuthIdentityRow | undefined;
  return row ?? null;
}

export function linkIdentity(input: {
  provider: OAuthProvider;
  providerId: string;
  userId: string;
  email?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
}): void {
  getAppDb()
    .prepare(
      `INSERT OR REPLACE INTO oauth_identities
        (provider, provider_id, user_id, email, username, avatar_url, linked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.provider,
      input.providerId,
      input.userId,
      input.email ?? null,
      input.username ?? null,
      input.avatarUrl ?? null,
      new Date().toISOString(),
    );
}

export function listIdentities(userId: string): OAuthIdentityRow[] {
  return getAppDb()
    .prepare("SELECT * FROM oauth_identities WHERE user_id = ?")
    .all(userId) as OAuthIdentityRow[];
}
