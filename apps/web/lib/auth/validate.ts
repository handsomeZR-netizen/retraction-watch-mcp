const USERNAME_RE = /^[a-zA-Z0-9_.+\-@]{3,64}$/;

export function validateUsername(input: unknown): { ok: boolean; value?: string; reason?: string } {
  if (typeof input !== "string") return { ok: false, reason: "用户名必须是字符串" };
  const trimmed = input.trim();
  if (!USERNAME_RE.test(trimmed)) {
    return {
      ok: false,
      reason: "用户名长度 3-64，可用字母数字、下划线、连字符、点、加号、@",
    };
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
