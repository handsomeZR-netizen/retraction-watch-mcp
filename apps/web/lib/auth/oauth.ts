import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import type { OAuthProvider } from "@/lib/db/oauth";

export interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  parseUser: (raw: unknown) => { providerId: string; email: string | null; username: string | null; avatarUrl: string | null };
}

const PROVIDERS: Record<OAuthProvider, () => ProviderConfig | null> = {
  github: () => {
    const clientId = process.env.OAUTH_GITHUB_CLIENT_ID;
    const clientSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userinfoUrl: "https://api.github.com/user",
      scope: "read:user user:email",
      clientId,
      clientSecret,
      parseUser: (raw) => {
        const r = raw as { id?: number | string; login?: string; email?: string | null; avatar_url?: string };
        return {
          providerId: String(r.id ?? ""),
          email: r.email ?? null,
          username: r.login ?? null,
          avatarUrl: r.avatar_url ?? null,
        };
      },
    };
  },
  google: () => {
    const clientId = process.env.OAUTH_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.OAUTH_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
      clientId,
      clientSecret,
      parseUser: (raw) => {
        const r = raw as { sub?: string; email?: string; name?: string; picture?: string };
        return {
          providerId: r.sub ?? "",
          email: r.email ?? null,
          username: r.name ?? r.email?.split("@")[0] ?? null,
          avatarUrl: r.picture ?? null,
        };
      },
    };
  },
};

export function getProvider(name: string): { provider: OAuthProvider; config: ProviderConfig } | null {
  if (name !== "github" && name !== "google") return null;
  const config = PROVIDERS[name]();
  if (!config) return null;
  return { provider: name, config };
}

export function listEnabledProviders(): OAuthProvider[] {
  return (Object.keys(PROVIDERS) as OAuthProvider[]).filter((p) => PROVIDERS[p]() !== null);
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

export function authorizeUrl(
  provider: OAuthProvider,
  config: ProviderConfig,
  state: string,
  redirectUri: string,
  redirect: string | null,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scope,
    state: state + (redirect ? `:${encodeURIComponent(redirect)}` : ""),
    response_type: "code",
  });
  if (provider === "google") {
    params.set("access_type", "online");
    params.set("prompt", "select_account");
  }
  if (provider === "github") {
    params.set("allow_signup", "true");
  }
  return `${config.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCode(
  provider: OAuthProvider,
  config: ProviderConfig,
  code: string,
  redirectUri: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const j = (await res.json()) as { access_token?: string; error?: string };
  if (!j.access_token) throw new Error(j.error ?? "missing access_token");
  return j.access_token;
}

export async function fetchUserInfo(
  provider: OAuthProvider,
  config: ProviderConfig,
  accessToken: string,
): Promise<unknown> {
  const res = await fetch(config.userinfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "rw-screen",
    },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  let raw: unknown = await res.json();
  if (provider === "github") {
    const u = raw as { email?: string | null };
    if (!u.email) {
      const er = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "rw-screen", Accept: "application/json" },
      });
      if (er.ok) {
        const list = (await er.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = list.find((e) => e.primary && e.verified) ?? list.find((e) => e.verified);
        if (primary) (raw as { email?: string }).email = primary.email;
      }
    }
  }
  return raw;
}

export function generateUniqueUsername(seed: string): string {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9_.+\-@]/g, "")
    .slice(0, 56);
  return `${base || "user"}-${nanoid(6).toLowerCase()}`;
}
