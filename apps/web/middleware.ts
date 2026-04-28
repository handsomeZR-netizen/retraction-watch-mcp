import { unsealData } from "iron-session";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

interface SessionPayload {
  userId?: string;
  role?: "user" | "admin";
  sessionVersion?: number;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

// Edge-safe session secret resolution. Mirrors apps/web/lib/auth/session.ts
// but does NOT touch fs (middleware runs on the edge runtime) — operators who
// want secret-file support must also export the value as RW_SESSION_SECRET in
// their orchestrator environment so middleware can read it.
function sessionSecret(): string | null {
  const raw = process.env.RW_SESSION_SECRET?.trim();
  if (raw) return raw;
  if (process.env.NODE_ENV !== "production") {
    return "dev-only-rw-screen-session-secret-change-me-in-production-32bytes";
  }
  return null;
}

async function verifySessionCookie(value: string): Promise<SessionPayload | null> {
  const password = sessionSecret();
  if (!password) return null;
  try {
    const data = (await unsealData(value, {
      password,
      ttl: SESSION_TTL_SECONDS,
    })) as SessionPayload;
    if (!data || !data.userId) return null;
    return data;
  } catch {
    return null;
  }
}

const PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/forgot",
]);

const PUBLIC_PATH_PREFIXES = ["/reset/", "/verify/", "/invite/", "/share/"];

const PUBLIC_API_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/me",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-email",
  "/api/auth/oauth",
  "/api/health",
  "/api/workspaces/invite/",
  "/api/share/",
];

// CSRF defense: state-changing API requests must declare a same-origin
// Origin/Referer. Browsers attach Origin to every fetch automatically; this
// closes the iron-session sameSite=lax loophole for cross-site POST.
//
// In production, the canonical origin MUST come from RW_BASE_URL. Trusting the
// raw Host header behind a permissive proxy is dangerous — an attacker who
// controls the Host can match it against their own Origin. In dev we fall back
// to ownHost + localhost since there's typically no proxy.
function checkCsrf(req: NextRequest): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  if (!req.nextUrl.pathname.startsWith("/api/")) return null;

  const isProd = process.env.NODE_ENV === "production";
  const origin = parseUrl(req.headers.get("origin"));
  const referer = parseUrl(req.headers.get("referer"));
  const source = origin ?? referer;

  if (!source) {
    if (isProd) {
      return forbid("missing origin/referer");
    }
    return null; // dev tools / curl in dev
  }

  // Production trust path: RW_BASE_URL is the only canonical origin.
  if (isProd) {
    const baseUrl = parseUrl(process.env.RW_BASE_URL ?? null);
    if (!baseUrl) {
      return forbid("RW_BASE_URL not configured");
    }
    if (source.host === baseUrl.host) return null;
    return forbid("origin not allowed");
  }

  // Dev trust path: same-host or localhost.
  const ownHost = req.headers.get("host");
  if (ownHost && source.host === ownHost) return null;
  if (source.hostname === "localhost" || source.hostname === "127.0.0.1") return null;
  const baseUrl = parseUrl(process.env.RW_BASE_URL ?? null);
  if (baseUrl && source.host === baseUrl.host) return null;
  return forbid("origin not allowed");
}

function forbid(reason: string): NextResponse {
  return NextResponse.json({ error: `forbidden: ${reason}` }, { status: 403 });
}

function parseUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CSRF check runs even for public API routes (login/register etc.) — it is
  // exactly those routes that benefit most from origin validation.
  const csrf = checkCsrf(req);
  if (csrf) return csrf;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Validate the session cookie by actually unsealing it. The previous "cookie
  // exists" check let any arbitrary value through to the protected handler;
  // requireUser inside the route still rejects, but bouncing here saves work
  // and avoids exposing handlers to bogus traffic.
  const cookie = req.cookies.get("rw_screen_session");
  const session = cookie ? await verifySessionCookie(cookie.value) : null;
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.ico$).*)",
  ],
};
