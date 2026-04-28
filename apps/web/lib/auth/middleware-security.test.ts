import { sealData } from "iron-session";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "../../middleware";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const TEST_SESSION_SECRET = "test-session-secret-32-bytes-minimum-value";

afterEach(() => {
  vi.useRealTimers();
});

describe("middleware auth security", () => {
  it("rejects cross-origin state-changing API requests", async () => {
    const req = new NextRequest("http://rw.test/api/auth/login", {
      method: "POST",
      headers: {
        host: "rw.test",
        origin: "https://evil.test",
      },
    });

    const res = await middleware(req);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("origin not allowed"),
    });
  });

  it("accepts session cookies through the configured ttl and rejects them after expiry", async () => {
    const saved = snapshotEnv([
      "RW_SESSION_SECRET",
      "RW_SESSION_SECRET_FILE",
      "NODE_ENV",
    ]);
    try {
      process.env.RW_SESSION_SECRET = TEST_SESSION_SECRET;
      delete process.env.RW_SESSION_SECRET_FILE;
      setEnvValue("NODE_ENV", "test");
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-28T00:00:00.000Z"));
      const cookie = await sealData(
        { userId: "user-1", role: "user", sessionVersion: 1 },
        { password: TEST_SESSION_SECRET, ttl: SESSION_TTL_SECONDS },
      );

      vi.setSystemTime(new Date("2026-05-13T00:00:00.000Z"));
      const stillValid = await middleware(protectedApiRequest(cookie));
      expect(stillValid.status).toBe(200);

      vi.setSystemTime(new Date("2026-05-29T00:00:00.000Z"));
      const expired = await middleware(protectedApiRequest(cookie));
      expect(expired.status).toBe(401);
    } finally {
      restoreEnv(saved);
    }
  });
});

function protectedApiRequest(cookie: string): NextRequest {
  return new NextRequest("http://rw.test/api/dashboard", {
    headers: {
      cookie: `rw_screen_session=${cookie}`,
      host: "rw.test",
    },
  });
}

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function setEnvValue(key: string, value: string): void {
  process.env[key] = value;
}
