/**
 * Sqlite-backed key-value cache for external API responses.
 *
 * Keys are namespaced by source: e.g. `crossref:doi:10.1/abc`,
 * `europepmc:title-sha:<sha256>`. TTL defaults to 30 days. Values are JSON
 * strings; the cache does not interpret them.
 */

import Database from "better-sqlite3";

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CacheStats {
  hits: number;
  misses: number;
  writes: number;
  expired: number;
}

export class ExternalCache {
  private readonly db: Database.Database;
  readonly stats: CacheStats = { hits: 0, misses: 0, writes: 0, expired: 0 };

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS external_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        stored_at INTEGER NOT NULL,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_expires ON external_cache(expires_at);
    `);
  }

  /**
   * Returns the cached JSON-parsed value, or null on miss / expired.
   * Expired rows are evicted lazily on read.
   */
  get<T>(key: string): T | null {
    const row = this.db
      .prepare("SELECT value, expires_at FROM external_cache WHERE key = ?")
      .get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) {
      this.stats.misses += 1;
      return null;
    }
    if (row.expires_at !== null && row.expires_at < Date.now()) {
      this.stats.expired += 1;
      this.stats.misses += 1;
      this.db.prepare("DELETE FROM external_cache WHERE key = ?").run(key);
      return null;
    }
    this.stats.hits += 1;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      this.stats.misses += 1;
      return null;
    }
  }

  set<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
    const now = Date.now();
    const expiresAt = ttlMs > 0 ? now + ttlMs : null;
    this.db
      .prepare(
        "INSERT OR REPLACE INTO external_cache (key, value, stored_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(key, JSON.stringify(value), now, expiresAt);
    this.stats.writes += 1;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM external_cache").get() as { n: number };
    return row.n;
  }

  /**
   * Drop every row whose expiry has passed. Returns the number of rows
   * removed. Call sparingly — read-side eviction handles most cases.
   */
  evictExpired(): number {
    const result = this.db
      .prepare("DELETE FROM external_cache WHERE expires_at IS NOT NULL AND expires_at < ?")
      .run(Date.now());
    return result.changes ?? 0;
  }

  close(): void {
    this.db.close();
  }
}

export function cacheKey(source: string, ...parts: (string | number)[]): string {
  return [source, ...parts.map(String)].join(":");
}
