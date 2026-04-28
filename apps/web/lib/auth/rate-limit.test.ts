import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "./rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-28T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows up to limit and rejects the next call with retryAfterMs", () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 5; i += 1) {
      const r = rateLimit(key, { limit: 5, windowMs: 60_000 });
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(5 - 1 - i);
    }
    const denied = rateLimit(key, { limit: 5, windowMs: 60_000 });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("resets the counter after the window expires", () => {
    const key = `reset:${Math.random()}`;
    rateLimit(key, { limit: 2, windowMs: 1_000 });
    rateLimit(key, { limit: 2, windowMs: 1_000 });
    expect(rateLimit(key, { limit: 2, windowMs: 1_000 }).allowed).toBe(false);

    vi.advanceTimersByTime(1_500);

    const after = rateLimit(key, { limit: 2, windowMs: 1_000 });
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(1);
  });

  it("isolates buckets by key", () => {
    const keyA = `iso-a:${Math.random()}`;
    const keyB = `iso-b:${Math.random()}`;
    expect(rateLimit(keyA, { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
    expect(rateLimit(keyA, { limit: 1, windowMs: 60_000 }).allowed).toBe(false);
    expect(rateLimit(keyB, { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
  });
});
