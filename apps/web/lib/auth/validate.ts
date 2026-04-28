// Username: Unicode letters/digits + a small ASCII-symbol subset for emails,
// 3–64 chars (counted as code points). Rejects whitespace, control chars,
// and emoji presentation selectors. Used by /api/auth/register and login.
const USERNAME_DISALLOWED_RE = /[\s<>"\\\/|?*\u0000-\u001f\u007f]/;
const USERNAME_ALLOWED_SYMBOL_ONLY_RE = /^[._+\-@]+$/;

export function validateUsername(input: unknown): { ok: boolean; value?: string; reason?: string } {
  if (typeof input !== "string") return { ok: false, reason: "用户名必须是字符串" };
  const trimmed = input.trim();
  // Code-point length so a CJK or accented character counts as 1, not 3.
  const codePoints = [...trimmed];
  if (codePoints.length < 3 || codePoints.length > 64) {
    return {
      ok: false,
      reason: "用户名长度需在 3 到 64 个字符之间",
    };
  }
  if (USERNAME_DISALLOWED_RE.test(trimmed)) {
    return {
      ok: false,
      reason: "用户名不能包含空白或特殊符号 < > \" / \\ | ? *",
    };
  }
  if (USERNAME_ALLOWED_SYMBOL_ONLY_RE.test(trimmed)) {
    return { ok: false, reason: "用户名必须包含至少一个字母或数字" };
  }
  return { ok: true, value: trimmed };
}

/**
 * Resolve the client IP for audit / rate-limiting.
 *
 * Trust path: only honor X-Forwarded-For / X-Real-IP when explicitly told to.
 * Set RW_TRUST_PROXY=1 once the app is deployed behind a proxy you control
 * (nginx, Caddy, Cloudflare). When unset (default), the forwarded headers are
 * ignored so that an attacker connecting directly to the app can't rotate
 * spoofed IPs to bypass per-IP rate limits.
 *
 * "unknown" is returned when no real IP can be resolved — callers should
 * treat that as a single bucket rather than allow-listing it.
 */
export function getRequestIp(headers: Headers): string {
  if (process.env.RW_TRUST_PROXY === "1") {
    const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
    const real = headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return "unknown";
}
