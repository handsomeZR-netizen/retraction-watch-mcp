import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hashPassword } from "@/lib/auth/password";
import { loginAs } from "@/lib/auth/session";
import {
  exchangeCode,
  fetchUserInfo,
  generateUniqueUsername,
  getProvider,
} from "@/lib/auth/oauth";
import { findIdentity, linkIdentity } from "@/lib/db/oauth";
import {
  countUsers,
  createUser,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  setAvatarSeed,
  setUserEmail,
  touchLastLogin,
} from "@/lib/db/users";
import { writeAudit } from "@/lib/db/audit";
import { appBaseUrl } from "@/lib/email/mailer";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "rw_oauth_state";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerName } = await params;
  const provider = getProvider(providerName);
  if (!provider) return NextResponse.redirect(`${appBaseUrl(req)}/login?error=oauth_unconfigured`);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state") ?? "";
  if (!code) return NextResponse.redirect(`${appBaseUrl(req)}/login?error=oauth_missing_code`);

  const cookieStore = await cookies();
  const expected = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);
  const [stateValue, redirectEncoded] = stateRaw.split(":");
  if (!expected || expected !== stateValue) {
    return NextResponse.redirect(`${appBaseUrl(req)}/login?error=oauth_state_mismatch`);
  }
  const redirect = redirectEncoded ? decodeURIComponent(redirectEncoded) : "/";

  try {
    const redirectUri = `${appBaseUrl(req)}/api/auth/oauth/${provider.provider}/callback`;
    const accessToken = await exchangeCode(provider.provider, provider.config, code, redirectUri);
    const raw = await fetchUserInfo(provider.provider, provider.config, accessToken);
    const info = provider.config.parseUser(raw);
    if (!info.providerId) {
      return NextResponse.redirect(`${appBaseUrl(req)}/login?error=oauth_no_id`);
    }

    const existing = findIdentity(provider.provider, info.providerId);
    let userId: string;
    if (existing) {
      userId = existing.user_id;
    } else if (info.email && info.emailVerified && findUserByEmail(info.email)) {
      // SAFE: the provider asserts the email is verified, so we can match it
      // to an existing local account that registered with the same email.
      const u = findUserByEmail(info.email)!;
      userId = u.id;
      linkIdentity({
        provider: provider.provider,
        providerId: info.providerId,
        userId: u.id,
        email: info.email,
        username: info.username,
        avatarUrl: info.avatarUrl,
      });
    } else if (info.email && !info.emailVerified && findUserByEmail(info.email)) {
      // UNSAFE: would let an attacker controlling an unverified provider email
      // take over an existing account. Refuse the auto-link and ask the user
      // to log in normally first, then link from /account.
      return NextResponse.redirect(
        `${appBaseUrl(req)}/login?error=oauth_unverified_email`,
      );
    } else {
      // create new
      let username =
        (info.username && !findUserByUsername(info.username) ? info.username : null) ??
        (info.email && !findUserByUsername(info.email) ? info.email : null) ??
        generateUniqueUsername(info.username ?? info.email ?? "user");
      if (findUserByUsername(username)) username = generateUniqueUsername(username);
      const placeholder = await hashPassword(`oauth-${provider.provider}-${info.providerId}-${Date.now()}`);
      const role = countUsers() === 0 ? "admin" : "user";
      const u = createUser({
        username,
        passwordHash: placeholder,
        displayName: info.username ?? undefined,
        role,
      });
      // Only mark email as verified locally when the provider asserts it.
      if (info.email) setUserEmail(u.id, info.email, info.emailVerified === true);
      if (info.avatarUrl || info.username) setAvatarSeed(u.id, info.username ?? username);
      linkIdentity({
        provider: provider.provider,
        providerId: info.providerId,
        userId: u.id,
        email: info.email,
        username: info.username,
        avatarUrl: info.avatarUrl,
      });
      userId = u.id;
    }

    const user = findUserById(userId);
    if (!user || user.disabled) {
      return NextResponse.redirect(`${appBaseUrl(req)}/login?error=oauth_disabled`);
    }
    touchLastLogin(user.id);
    await loginAs(user);
    writeAudit({
      userId: user.id,
      action: "login",
      detail: { provider: provider.provider },
      ip: getRequestIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.redirect(`${appBaseUrl(req)}${redirect.startsWith("/") ? redirect : "/"}`);
  } catch (err) {
    return NextResponse.redirect(
      `${appBaseUrl(req)}/login?error=oauth_${encodeURIComponent(
        err instanceof Error ? err.message : "fail",
      )}`,
    );
  }
}
