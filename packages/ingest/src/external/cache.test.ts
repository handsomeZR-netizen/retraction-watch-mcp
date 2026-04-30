import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExternalCache, cacheKey } from "./cache.js";

let dir: string;
let cache: ExternalCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rw-cache-"));
  cache = new ExternalCache(join(dir, "cache.sqlite"));
});

afterEach(() => {
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ExternalCache", () => {
  it("returns null on miss", () => {
    expect(cache.get<unknown>("crossref:doi:10.1/none")).toBeNull();
    expect(cache.stats.misses).toBe(1);
  });

  it("round-trips a value within TTL", () => {
    cache.set("crossref:doi:10.1/abc", { foo: 42 });
    expect(cache.get<{ foo: number }>("crossref:doi:10.1/abc")).toEqual({ foo: 42 });
    expect(cache.stats.hits).toBe(1);
  });

  it("evicts on read once expired", () => {
    cache.set("k", "v", 1);
    // sleep a tick so expiry passes
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy-wait
    }
    expect(cache.get<string>("k")).toBeNull();
    expect(cache.stats.expired).toBe(1);
    expect(cache.count()).toBe(0);
  });

  it("treats malformed cached value as miss without crashing", () => {
    // Inject a row with unparseable JSON via raw SQL.
    (cache as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db
      .prepare(
        "INSERT INTO external_cache (key, value, stored_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run("bad", "{not json", Date.now(), null);
    expect(cache.get<unknown>("bad")).toBeNull();
  });

  it("counts and evicts expired rows in bulk", () => {
    cache.set("a", 1, 1);
    cache.set("b", 2, 60_000);
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy-wait
    }
    const removed = cache.evictExpired();
    expect(removed).toBe(1);
    expect(cache.count()).toBe(1);
  });
});

describe("ExternalCache constructor", () => {
  it("creates the parent directory if it doesn't exist", () => {
    const fresh = mkdtempSync(join(tmpdir(), "rw-cache-fresh-"));
    const nestedDir = join(fresh, "nope", "still-nope");
    const dbPath = join(nestedDir, "cache.sqlite");
    // Sanity check: the directory genuinely does not exist before construction.
    expect(() => mkdtempSync(join(nestedDir, "x-"))).toThrow();
    let c: ExternalCache | null = null;
    try {
      c = new ExternalCache(dbPath);
      // Should round-trip a value, proving the file got created.
      c.set("k", "v");
      expect(c.get<string>("k")).toBe("v");
    } finally {
      c?.close();
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe("cacheKey", () => {
  it("joins source and parts with colon", () => {
    expect(cacheKey("crossref", "doi", "10.1/abc")).toBe("crossref:doi:10.1/abc");
  });
});
