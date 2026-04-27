interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();
const MAX_KEYS = 5_000;

export function rateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || w.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    if (buckets.size > MAX_KEYS) gc(now);
    return { allowed: true, remaining: options.limit - 1, retryAfterMs: 0 };
  }
  w.count += 1;
  if (w.count > options.limit) {
    return { allowed: false, remaining: 0, retryAfterMs: w.resetAt - now };
  }
  return { allowed: true, remaining: options.limit - w.count, retryAfterMs: 0 };
}

function gc(now: number): void {
  for (const [k, w] of buckets) {
    if (w.resetAt < now) buckets.delete(k);
  }
}
