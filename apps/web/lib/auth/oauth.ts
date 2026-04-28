import { randomBytes, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type { OAuthProvider } from "@/lib/db/oauth";

export interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  parseUser: (raw: unknown) => {
    providerId: string;
    email: string | null;
    /**
     * True only when the provider asserts the email is verified. Google sets
     * `email_verified: true` on the OIDC response; GitHub only includes a
     * `verified` flag via the /user/emails endpoint (handled in fetchUserInfo).
     * Auto-linking to an existing local account MUST require this — otherwise
     * an attacker controlling an unverified matching email takes over the
     * account.
     */
    emailVerified: boolean;
    username: string | null;
    avatarUrl: string | null;
  };
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
        const r = raw as {
          id?: number | string;
          login?: string;
          email?: string | null;
          email_verified?: boolean;
          avatar_url?: string;
        };
        return {
          providerId: String(r.id ?? ""),
          email: r.email ?? null,
          // GitHub /user does not return verification status; fetchUserInfo
          // attaches `email_verified` after consulting /user/emails.
          emailVerified: r.email_verified === true,
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
        const r = raw as {
          sub?: string;
          email?: string;
          email_verified?: boolean;
          name?: string;
          picture?: string;
        };
        return {
          providerId: r.sub ?? "",
          email: r.email ?? null,
          // OIDC: only treat as verified when Google asserts it explicitly.
          emailVerified: r.email_verified === true,
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

export function safeLocalRedirect(value: string | null): string | null {
  if (!value) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    const base = new URL("https://rw-screen.local");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return null;
    if (!parsed.pathname.startsWith("/")) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function buildOAuthState(state: string, redirect: string | null): string {
  const safeRedirect = safeLocalRedirect(redirect);
  return state + (safeRedirect ? `:${encodeURIComponent(safeRedirect)}` : "");
}

export function parseOAuthState(
  raw: string,
  expected: string | undefined,
): { redirect: string } | null {
  const delimiter = raw.indexOf(":");
  const stateValue = delimiter === -1 ? raw : raw.slice(0, delimiter);
  const redirectEncoded = delimiter === -1 ? "" : raw.slice(delimiter + 1);
  if (!expected || !timingSafeStringEqual(expected, stateValue)) return null;
  if (!redirectEncoded) return { redirect: "/" };
  try {
    return { redirect: safeLocalRedirect(decodeURIComponent(redirectEncoded)) ?? "/" };
  } catch {
    return { redirect: "/" };
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
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
    state: buildOAuthState(state, redirect),
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
  const raw: unknown = await res.json();
  if (provider === "github") {
    // Always consult /user/emails so we know whether the address is verified;
    // /user alone does not include verification status. This is required for
    // safe auto-linking to existing local accounts.
    const er = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "rw-screen",
        Accept: "application/json",
      },
    });
    if (er.ok) {
      const list = (await er.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary =
        list.find((e) => e.primary && e.verified) ?? list.find((e) => e.verified);
      const target = raw as { email?: string | null; email_verified?: boolean };
      if (primary) {
        target.email = primary.email;
        target.email_verified = true;
      } else {
        // No verified email available; clear whatever /user reported so the
        // callback won't auto-link.
        target.email = null;
        target.email_verified = false;
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
