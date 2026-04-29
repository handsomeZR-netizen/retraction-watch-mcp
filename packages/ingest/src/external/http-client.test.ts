import { describe, expect, it, vi } from "vitest";
import { HttpClient, HttpError } from "./http-client.js";

const UA = "rw-test/0.0.0 (mailto:test@example.com)";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("HttpClient", () => {
  it("rejects a User-Agent without contact info", () => {
    expect(() => new HttpClient({ userAgent: "rw-test/0.0.0" })).toThrow(/polite User-Agent/);
  });

  it("returns parsed JSON on a 2xx response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
    const client = new HttpClient({ userAgent: UA, fetchImpl });
    const out = await client.getJson<{ ok: boolean }>("https://api.example.com/x");
    expect(out.ok).toBe(true);
    expect(out.data).toEqual({ ok: true });
    expect(out.attempts).toBe(1);
  });

  it("retries on 429 and succeeds", async () => {
    const seq = [
      jsonResponse({ msg: "rate limited" }, 429, { "retry-after": "0" }),
      jsonResponse({ ok: true }),
    ];
    const fetchImpl = vi.fn(async () => seq.shift()!) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    const client = new HttpClient({ userAgent: UA, fetchImpl, sleep, maxRetries: 2 });
    const out = await client.getJson<{ ok: boolean }>("https://api.example.com/x");
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.retried).toBe(true);
    expect(sleep).toHaveBeenCalled();
  });

  it("throws after exhausting retries when not failing gracefully", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    const client = new HttpClient({ userAgent: UA, fetchImpl, sleep, maxRetries: 1 });
    await expect(client.getJson("https://api.example.com/x")).rejects.toBeInstanceOf(HttpError);
  });

  it("returns ok:false instead of throwing when failGracefully is set", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    const client = new HttpClient({ userAgent: UA, fetchImpl, sleep, maxRetries: 1 });
    const out = await client.getJson("https://api.example.com/x", { failGracefully: true });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(500);
    expect(out.data).toBeNull();
  });

  it("does not retry on 404", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404)) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    const client = new HttpClient({ userAgent: UA, fetchImpl, sleep, maxRetries: 3 });
    await expect(client.getJson("https://api.example.com/x")).rejects.toBeInstanceOf(HttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("limits per-host concurrency", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const client = new HttpClient({
      userAgent: UA,
      fetchImpl,
      sleep: async () => {},
      perHostConcurrency: 2,
    });
    await Promise.all(
      Array.from({ length: 6 }, () => client.getJson("https://api.example.com/x")),
    );
    expect(peakInFlight).toBeLessThanOrEqual(2);
  });

  it("sends the polite User-Agent header on every call", async () => {
    let observedUa = "";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      observedUa = headers?.["User-Agent"] ?? "";
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const client = new HttpClient({ userAgent: UA, fetchImpl });
    await client.getJson("https://api.example.com/x");
    expect(observedUa).toBe(UA);
  });
});
