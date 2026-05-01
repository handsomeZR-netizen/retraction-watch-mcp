import { createHash } from "node:crypto";
import { normalizeTitle } from "@rw/core";
import type { ExternalCache } from "./cache.js";
import { cacheKey } from "./cache.js";
import { acceptFusionMatch } from "./fusion.js";
import { HttpClient } from "./http-client.js";

/**
 * OpenAlex REST API client. Used as the **second-source fallback** when
 * Crossref's title-search fusion gate rejects (or returns nothing) — many
 * conference-proceedings refs that don't print a DOI are indexed by
 * OpenAlex but missing from Crossref's title index.
 *
 * Polite-pool: like Crossref, OpenAlex throttles anonymous traffic. The
 * `HttpClient` is constructed with a `mailto:` User-Agent which qualifies
 * us for the higher rate limit.
 *
 * API docs: https://docs.openalex.org/api-entities/works
 *
 * Two entry points (mirroring CrossrefClient):
 *   - `searchByTitle(title)`  raw candidates list
 *   - `resolveByTitle(title, year)`  first candidate that passes the same
 *     `acceptFusionMatch` gate Crossref uses (title Levenshtein ≥ 0.92,
 *     year ±1). Returns null if nothing clears.
 */

const OPENALEX_BASE = "https://api.openalex.org";

export interface OpenAlexWork {
  doi: string;
  title: string | null;
  year: number | null;
  authors: string[];
  journal: string | null;
}

export interface OpenAlexResolveResult {
  work: OpenAlexWork;
  titleRatio: number;
  yearDelta: number;
}

export class OpenAlexClient {
  constructor(
    private readonly http: HttpClient,
    private readonly cache?: ExternalCache,
  ) {}

  async searchByTitle(title: string): Promise<OpenAlexWork[]> {
    const norm = normalizeTitle(title);
    if (!norm) return [];
    const sha = createHash("sha256").update(norm).digest("hex").slice(0, 16);
    const key = cacheKey("openalex", "title", sha);
    const cached = this.cache?.get<OpenAlexWork[]>(key);
    if (cached) return cached;

    const url = `${OPENALEX_BASE}/works?search=${encodeURIComponent(title)}&per_page=5`;
    const res = await this.http.getJson<OpenAlexSearchResponse>(url, { failGracefully: true });
    if (!res.ok || !res.data) {
      // Cache the negative result for 1 day so we don't hammer the API on
      // every benchmark re-run for refs OpenAlex genuinely doesn't index.
      this.cache?.set(key, [], 24 * 60 * 60 * 1000);
      return [];
    }
    const items = (res.data.results ?? [])
      .map(parseWork)
      .filter((w): w is OpenAlexWork => w != null);
    this.cache?.set(key, items);
    return items;
  }

  /**
   * Search OpenAlex by title and return the first candidate that passes
   * `acceptFusionMatch` against the local title+year (+authors for
   * surname cross-check). Returns null if no candidate clears the
   * threshold — caller MUST treat null as "no OpenAlex DOI is safe to
   * assign".
   */
  async resolveByTitle(
    localTitle: string,
    localYear: number | null,
    localAuthors?: string[],
  ): Promise<OpenAlexResolveResult | null> {
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

interface OpenAlexSearchResponse {
  results?: OpenAlexWorkRaw[];
}

interface OpenAlexAuthorship {
  author?: { display_name?: string };
}

interface OpenAlexSourceRef {
  display_name?: string;
}

interface OpenAlexPrimaryLocation {
  source?: OpenAlexSourceRef;
}

interface OpenAlexWorkRaw {
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: OpenAlexAuthorship[];
  primary_location?: OpenAlexPrimaryLocation;
  host_venue?: OpenAlexSourceRef;
}

function parseWork(raw: OpenAlexWorkRaw): OpenAlexWork | null {
  if (!raw.doi) return null;
  // OpenAlex returns DOI as a full URL ("https://doi.org/10.1234/abc"); strip
  // to the bare DOI so it matches Crossref's format and our local extractor.
  const doi = raw.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
  if (!/^10\.\d{3,9}\//.test(doi)) return null;
  const title = (raw.title || raw.display_name || "").trim() || null;
  const journal =
    (raw.primary_location?.source?.display_name || raw.host_venue?.display_name || "").trim() ||
    null;
  const authors = (raw.authorships ?? [])
    .map((a) => a.author?.display_name?.trim())
    .filter((n): n is string => Boolean(n));
  const year =
    typeof raw.publication_year === "number" && raw.publication_year >= 1500 &&
    raw.publication_year <= 2200
      ? raw.publication_year
      : null;
  return { doi, title, year, authors, journal };
}
