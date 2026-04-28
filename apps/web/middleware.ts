import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/forgot",
]);

const PUBLIC_PATH_PREFIXES = ["/reset/", "/verify/", "/invite/"];

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
];

// CSRF defense: state-changing API requests must declare a same-origin
// Origin/Referer. Browsers attach Origin to every fetch automatically; this
// closes the iron-session sameSite=lax loophole for cross-site POST.
function checkCsrf(req: NextRequest): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  if (!req.nextUrl.pathname.startsWith("/api/")) return null;

  const origin = parseUrl(req.headers.get("origin"));
  const referer = parseUrl(req.headers.get("referer"));
  const source = origin ?? referer;

  if (!source) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "forbidden: missing origin/referer" },
        { status: 403 },
      );
    }
    return null; // dev tools / curl in dev
  }

  const ownHost = req.headers.get("host");
  if (ownHost && source.host === ownHost) return null;
  const baseUrl = parseUrl(process.env.RW_BASE_URL ?? null);
  if (baseUrl && source.host === baseUrl.host) return null;
  if (
    process.env.NODE_ENV !== "production" &&
    (source.hostname === "localhost" || source.hostname === "127.0.0.1")
  ) {
    return null;
  }

  return NextResponse.json(
    { error: "forbidden: origin not allowed" },
    { status: 403 },
  );
}

function parseUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CSRF check runs even for public API routes (login/register etc.) — it is
  // exactly those routes that benefit most from origin validation.
  const csrf = checkCsrf(req);
  if (csrf) return csrf;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const cookie = req.cookies.get("rw_screen_session");
  if (!cookie) {
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
