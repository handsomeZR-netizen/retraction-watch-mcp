import { createHash } from "node:crypto";
import { normalizeTitle } from "@rw/core";
import type { ExternalCache } from "./cache.js";
import { cacheKey } from "./cache.js";
import { acceptFusionMatch } from "./fusion.js";
import { HttpClient } from "./http-client.js";

/**
 * Crossref REST API client. We hit the polite pool — `HttpClient` enforces a
 * mailto-bearing User-Agent — and cache responses through `ExternalCache`.
 *
 * Two entry points:
 *   - `getByDoi(doi)` for deterministic lookup; the DOI is authoritative.
 *   - `resolveByTitle(title, year)` for soft lookup; results pass through
 *     `acceptFusionMatch` so we never accept a Crossref DOI without a tight
 *     title+year agreement.
 */

const CROSSREF_BASE = "https://api.crossref.org";

export interface CrossrefWork {
  doi: string;
  title: string | null;
  year: number | null;
  authors: string[];
  journal: string | null;
}

export interface CrossrefResolveResult {
  work: CrossrefWork;
  titleRatio: number;
  yearDelta: number;
}

export class CrossrefClient {
  constructor(
    private readonly http: HttpClient,
    private readonly cache?: ExternalCache,
  ) {}

  async getByDoi(doi: string): Promise<CrossrefWork | null> {
    const normalized = doi.trim().toLowerCase();
    if (!normalized) return null;
    const key = cacheKey("crossref", "doi", normalized);
    // Wrap in { found, work } so that a negative result can be cached
    // distinctly from a cache miss (`get` returning null on miss can't
    // round-trip a stored null).
    const cached = this.cache?.get<{ found: boolean; work?: CrossrefWork }>(key);
    if (cached) {
      return cached.found ? (cached.work ?? null) : null;
    }

    const url = `${CROSSREF_BASE}/works/${encodeURIComponent(normalized)}`;
    const res = await this.http.getJson<CrossrefSingleResponse>(url, { failGracefully: true });
    if (!res.ok || !res.data) {
      this.cache?.set(key, { found: false }, 7 * 24 * 60 * 60 * 1000);
      return null;
    }
    const work = parseWork(res.data.message);
    if (work) {
      this.cache?.set(key, { found: true, work });
      return work;
    }
    this.cache?.set(key, { found: false }, 7 * 24 * 60 * 60 * 1000);
    return null;
  }

  async searchByTitle(title: string): Promise<CrossrefWork[]> {
    const norm = normalizeTitle(title);
    if (!norm) return [];
    const sha = createHash("sha256").update(norm).digest("hex").slice(0, 16);
    const key = cacheKey("crossref", "title", sha);
    const cached = this.cache?.get<CrossrefWork[]>(key);
    if (cached) return cached;

    const url = `${CROSSREF_BASE}/works?query.title=${encodeURIComponent(title)}&rows=5`;
    const res = await this.http.getJson<CrossrefSearchResponse>(url, { failGracefully: true });
    if (!res.ok || !res.data) {
      this.cache?.set(key, [], 24 * 60 * 60 * 1000);
      return [];
    }
    const items = (res.data.message?.items ?? [])
      .map(parseWork)
      .filter((w): w is CrossrefWork => w != null);
    this.cache?.set(key, items);
    return items;
  }

  /**
   * Search Crossref by title and return the first candidate that passes
   * `acceptFusionMatch` against the local title+year (+authors for surname
   * cross-check). Returns null if no candidate clears the threshold —
   * caller MUST treat null as "no Crossref DOI is safe to assign".
   */
  async resolveByTitle(
    localTitle: string,
    localYear: number | null,
    localAuthors?: string[],
  ): Promise<CrossrefResolveResult | null> {
    const candidates = await this.searchByTitle(localTitle);
    for (const work of candidates) {
      const decision = acceptFusionMatch(
        { title: localTitle, year: localYear, authors: localAuthors },
        { title: work.title, year: work.year, authors: work.authors },
      );
      if (decision.accept) {
        return {
          work,
          titleRatio: decision.titleRatio,
          yearDelta: decision.yearDelta ?? 0,
        };
      }
    }
    return null;
  }
}

interface CrossrefSingleResponse {
  message: CrossrefMessage;
}
interface CrossrefSearchResponse {
  message: { items?: CrossrefMessage[] };
}
interface CrossrefMessage {
  DOI?: string;
  title?: string[];
  "container-title"?: string[];
  author?: { given?: string; family?: string }[];
  issued?: { "date-parts"?: number[][] };
  published?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
}

export function parseWork(msg: CrossrefMessage): CrossrefWork | null {
  if (!msg?.DOI) return null;
  return {
    doi: msg.DOI.toLowerCase(),
    title: extractTitle(msg.title),
    year: extractYear(msg),
    authors: (msg.author ?? [])
      .map((a) => [a.family, a.given].filter(Boolean).join(", "))
      .filter(Boolean),
    journal: extractTitle(msg["container-title"]),
  };
}

function extractTitle(titles: string[] | undefined): string | null {
  if (!titles || titles.length === 0) return null;
  const t = titles.find((x) => x && x.trim());
  return t ? t.trim() : null;
}

function extractYear(msg: CrossrefMessage): number | null {
  const sources = [msg.issued, msg.published, msg["published-print"], msg["published-online"]];
  for (const s of sources) {
    const year = s?.["date-parts"]?.[0]?.[0];
    if (typeof year === "number" && year >= 1500 && year <= 2200) {
      return year;
    }
  }
  return null;
}
