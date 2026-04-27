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

export function getRequestIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}
