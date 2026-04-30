import { createHash } from "node:crypto";
import { normalizeTitle } from "@rw/core";
import type { ExternalCache } from "./cache.js";
import { cacheKey } from "./cache.js";
import { acceptFusionMatch } from "./fusion.js";
import { HttpClient } from "./http-client.js";

/**
 * Europe PMC search client. Same fusion gate as Crossref: a returned DOI is
 * only adopted when the local title agrees within `TITLE_FUSION_THRESHOLD`
 * and the year is within `YEAR_FUSION_TOLERANCE`.
 *
 * EPMC also exposes PMIDs, which Crossref does not — the client returns both
 * DOI and PMID so the enrichment step can populate either ID.
 */

const EPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";

export interface EpmcWork {
  doi: string | null;
  pmid: string | null;
  title: string | null;
  year: number | null;
  authors: string[];
  journal: string | null;
}

export interface EpmcResolveResult {
  work: EpmcWork;
  titleRatio: number;
  yearDelta: number;
}

export class EuropePmcClient {
  constructor(
    private readonly http: HttpClient,
    private readonly cache?: ExternalCache,
  ) {}

  async getByDoi(doi: string): Promise<EpmcWork | null> {
    const normalized = doi.trim().toLowerCase();
    if (!normalized) return null;
    const key = cacheKey("europepmc", "doi", normalized);
    const cached = this.cache?.get<{ found: boolean; work?: EpmcWork }>(key);
    if (cached) return cached.found ? (cached.work ?? null) : null;

    const url = `${EPMC_BASE}/search?query=${encodeURIComponent(`DOI:"${normalized}"`)}&format=json&resultType=lite&pageSize=1`;
    const res = await this.http.getJson<EpmcSearchResponse>(url, { failGracefully: true });
    if (!res.ok || !res.data) {
      this.cache?.set(key, { found: false }, 7 * 24 * 60 * 60 * 1000);
      return null;
    }
    const work = parseFirst(res.data);
    if (work) {
      this.cache?.set(key, { found: true, work });
      return work;
    }
    this.cache?.set(key, { found: false }, 7 * 24 * 60 * 60 * 1000);
    return null;
  }

  async searchByTitle(title: string): Promise<EpmcWork[]> {
    const norm = normalizeTitle(title);
    if (!norm) return [];
    const sha = createHash("sha256").update(norm).digest("hex").slice(0, 16);
    const key = cacheKey("europepmc", "title", sha);
    const cached = this.cache?.get<EpmcWork[]>(key);
    if (cached) return cached;

    const url = `${EPMC_BASE}/search?query=${encodeURIComponent(`TITLE:"${title}"`)}&format=json&resultType=lite&pageSize=5`;
    const res = await this.http.getJson<EpmcSearchResponse>(url, { failGracefully: true });
    if (!res.ok || !res.data) {
      this.cache?.set(key, [], 24 * 60 * 60 * 1000);
      return [];
    }
    const items = (res.data.resultList?.result ?? [])
      .map(parseResult)
      .filter((w): w is EpmcWork => w != null);
    this.cache?.set(key, items);
    return items;
  }

  async resolveByTitle(
    localTitle: string,
    localYear: number | null,
  ): Promise<EpmcResolveResult | null> {
    const candidates = await this.searchByTitle(localTitle);
    for (const work of candidates) {
      const decision = acceptFusionMatch(
        { title: localTitle, year: localYear },
        { title: work.title, year: work.year },
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

interface EpmcSearchResponse {
  resultList?: { result?: EpmcResultEntry[] };
}

interface EpmcResultEntry {
  id?: string;
  source?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  journalTitle?: string;
  pubYear?: string;
}

export function parseResult(entry: EpmcResultEntry): EpmcWork | null {
  if (!entry) return null;
  if (!entry.doi && !entry.pmid) return null;
  return {
    doi: entry.doi ? entry.doi.toLowerCase() : null,
    pmid: entry.pmid ?? null,
    title: entry.title?.trim() || null,
    year: parseYear(entry.pubYear),
    authors: parseAuthors(entry.authorString),
    journal: entry.journalTitle?.trim() || null,
  };
}

function parseFirst(data: EpmcSearchResponse): EpmcWork | null {
  const first = data.resultList?.result?.[0];
  return first ? parseResult(first) : null;
}

function parseYear(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1500 && n <= 2200 ? n : null;
}

function parseAuthors(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}
