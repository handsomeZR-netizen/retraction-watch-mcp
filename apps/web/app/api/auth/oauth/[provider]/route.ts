import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authorizeUrl, getProvider, newState } from "@/lib/auth/oauth";
import { appBaseUrl } from "@/lib/email/mailer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "rw_oauth_state";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerName } = await params;
  const provider = getProvider(providerName);
  if (!provider) {
    return NextResponse.json(
      { error: "OAuth provider 未配置或不支持" },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const redirect = url.searchParams.get("redirect");
  const redirectUri = `${appBaseUrl(req)}/api/auth/oauth/${provider.provider}/callback`;
  const state = newState();
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  const authUrl = authorizeUrl(provider.provider, provider.config, state, redirectUri, redirect);
  return NextResponse.redirect(authUrl);
}
