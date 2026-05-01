import { createHash } from "node:crypto";
import { normalizeTitle } from "@rw/core";
import type { ExternalCache } from "./cache.js";
import { cacheKey } from "./cache.js";
import { acceptFusionMatch } from "./fusion.js";
import { HttpClient } from "./http-client.js";

/**
 * Semantic Scholar Graph API client. Used as the **third-source fallback**
 * after Crossref → OpenAlex. S2 indexes ~200M+ papers with strong CS /
 * proceedings coverage; many EI-indexed Procedia conference papers that
 * neither Crossref nor OpenAlex resolves end up here.
 *
 * API docs: https://api.semanticscholar.org/api-docs/graph
 *
 * Same surface as Crossref/OpenAlex clients:
 *   - `searchByTitle(title)`  raw candidates list
 *   - `resolveByTitle(title, year, authors)`  first candidate that passes
 *     `acceptFusionMatch` (title ≥ 0.92, year ±1, ≥1 author surname overlap)
 */

const S2_BASE = "https://api.semanticscholar.org/graph/v1";

export interface SemanticScholarWork {
  doi: string;
  title: string | null;
  year: number | null;
  authors: string[];
  journal: string | null;
}

export interface SemanticScholarResolveResult {
  work: SemanticScholarWork;
  titleRatio: number;
  yearDelta: number;
}

export class SemanticScholarClient {
  constructor(
    private readonly http: HttpClient,
    private readonly cache?: ExternalCache,
  ) {}

  async searchByTitle(title: string): Promise<SemanticScholarWork[]> {
    const norm = normalizeTitle(title);
    if (!norm) return [];
    const sha = createHash("sha256").update(norm).digest("hex").slice(0, 16);
    const key = cacheKey("s2", "title", sha);
    const cached = this.cache?.get<SemanticScholarWork[]>(key);
    if (cached) return cached;

    const fields = "title,year,externalIds,authors,venue";
    const url = `${S2_BASE}/paper/search?query=${encodeURIComponent(title)}&limit=5&fields=${fields}`;
    const res = await this.http.getJson<S2SearchResponse>(url, { failGracefully: true });
    if (!res.ok || !res.data) {
      // 1 day negative TTL so re-runs of the same benchmark don't slam S2.
      this.cache?.set(key, [], 24 * 60 * 60 * 1000);
      return [];
    }
    const items = (res.data.data ?? [])
      .map(parseWork)
      .filter((w): w is SemanticScholarWork => w != null);
    this.cache?.set(key, items);
    return items;
  }

  /**
   * Search S2 by title, return the first candidate that passes the fusion
   * gate (same gate as Crossref/OpenAlex — title Levenshtein ≥ 0.92, year
   * ±1, ≥1 author surname overlap when both sides have authors).
   */
  async resolveByTitle(
    localTitle: string,
    localYear: number | null,
    localAuthors?: string[],
  ): Promise<SemanticScholarResolveResult | null> {
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

interface S2SearchResponse {
  total?: number;
  offset?: number;
  data?: S2PaperRaw[];
}

interface S2AuthorRaw {
  authorId?: string | null;
  name?: string | null;
}

interface S2ExternalIds {
  DOI?: string | null;
  // S2 also surfaces ArXivId, MAG, PubMed etc.; we only consume DOI.
}

interface S2PaperRaw {
  paperId?: string | null;
  title?: string | null;
  year?: number | null;
  externalIds?: S2ExternalIds | null;
  authors?: S2AuthorRaw[];
  venue?: string | null;
}

function parseWork(raw: S2PaperRaw): SemanticScholarWork | null {
  const doi = raw.externalIds?.DOI?.trim().toLowerCase() ?? null;
  if (!doi || !/^10\.\d{3,9}\//.test(doi)) return null;
  const title = (raw.title ?? "").trim() || null;
  const journal = (raw.venue ?? "").trim() || null;
  const year =
    typeof raw.year === "number" && raw.year >= 1500 && raw.year <= 2200
      ? raw.year
      : null;
  const authors = (raw.authors ?? [])
    .map((a) => a.name?.trim())
    .filter((n): n is string => Boolean(n));
  return { doi, title, year, authors, journal };
}
