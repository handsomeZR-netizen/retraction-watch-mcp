import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrossrefClient } from "../external/crossref.js";
import { EuropePmcClient } from "../external/europepmc.js";
import { ExternalCache } from "../external/cache.js";
import { HttpClient } from "../external/http-client.js";
import { extractCandidates } from "./extract-candidates.js";
import { enrichMetadata } from "./enrich-metadata.js";
import type { RawReference } from "../types.js";

const UA = "rw-test/0.0.0 (mailto:test@example.com)";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let dir: string;
let cache: ExternalCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rw-pipeline-"));
  cache = new ExternalCache(join(dir, "cache.sqlite"));
});

afterEach(() => {
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("enrichMetadata", () => {
  it("fills missing fields from Crossref when DOI is known locally", async () => {
    const raws: RawReference[] = [
      { index: 0, raw: "Doe J. doi:10.1234/abc 2020." },
    ];
    const candidates = extractCandidates(raws);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].doi).toBe("10.1234/abc");

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        message: {
          DOI: "10.1234/abc",
          title: ["Resolved Title"],
          "container-title": ["Journal of Foo"],
          author: [{ given: "J.", family: "Doe" }],
          issued: { "date-parts": [[2020]] },
        },
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const crossref = new CrossrefClient(http, cache);

    const out = await enrichMetadata(candidates, [], { crossref });
    expect(out.references[0].title).toBe("Resolved Title");
    expect(out.references[0].journal).toBe("Journal of Foo");
    expect(out.references[0].provenance?.title?.source).toBe("crossref");
    expect(out.telemetry.crossrefCalls).toBe(1);
  });

  it("attaches a Crossref DOI via title-search when fusion accepts", async () => {
    // Build a candidate with title + year but no DOI.
    const candidates = extractCandidates([
      { index: 0, raw: "Doe J, Smith A. Reproducibility crisis in machine learning. 2020." },
    ]);

    // The candidate may not have a populated title from heuristics; force one
    // so the fusion path can run.
    candidates[0].title = "Reproducibility crisis in machine learning";
    candidates[0].year = 2020;

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        message: {
          items: [
            {
              DOI: "10.1234/abc",
              title: ["Reproducibility crisis in machine learning"],
              issued: { "date-parts": [[2020]] },
            },
          ],
        },
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const crossref = new CrossrefClient(http, cache);

    const out = await enrichMetadata(candidates, [], { crossref });
    expect(out.references[0].doi).toBe("10.1234/abc");
    expect(out.references[0].provenance?.doi?.source).toBe("crossref");
    const accepted = out.trace.find((t) => t.field === "doi" && t.accepted);
    expect(accepted?.source).toBe("crossref");
  });

  it("does NOT attach Crossref DOI when title fusion rejects", async () => {
    const candidates = extractCandidates([
      { index: 0, raw: "Doe J. Some narrow paper. 2020." },
    ]);
    candidates[0].title = "Some narrow paper";
    candidates[0].year = 2020;

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        message: {
          items: [
            {
              DOI: "10.1234/wrong",
              title: ["A completely different paper"],
              issued: { "date-parts": [[2020]] },
            },
          ],
        },
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const crossref = new CrossrefClient(http, cache);

    const out = await enrichMetadata(candidates, [], { crossref });
    expect(out.references[0].doi).toBeNull();
    const rejected = out.trace.find((t) => t.field === "doi" && !t.accepted);
    expect(rejected?.reason).toBe("crossref_title_below_threshold");
  });

  it("uses Europe PMC to resolve a DOI from a known PMID", async () => {
    const candidates = extractCandidates([
      { index: 0, raw: "Doe J. Some title. 2020. PMID: 31234567" },
    ]);
    expect(candidates[0].pmid).toBe("31234567");

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        resultList: {
          result: [
            {
              pmid: "31234567",
              doi: "10.1234/from-pmid",
              title: "Some title",
              pubYear: "2020",
            },
          ],
        },
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const europepmc = new EuropePmcClient(http, cache);

    const out = await enrichMetadata(candidates, [], { europepmc });
    expect(out.references[0].doi).toBe("10.1234/from-pmid");
    expect(out.references[0].provenance?.doi?.source).toBe("europepmc");
    expect(out.telemetry.epmcCalls).toBe(1);
  });

  it("records local-vs-Crossref title conflict instead of overwriting", async () => {
    const raws: RawReference[] = [
      { index: 0, raw: "Doe J. Locally Extracted Title. doi:10.1234/abc 2020." },
    ];
    const candidates = extractCandidates(raws);
    expect(candidates[0].doi).toBe("10.1234/abc");
    candidates[0].title = "Locally Extracted Title";

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        message: {
          DOI: "10.1234/abc",
          title: ["Crossref Has A Different Title"],
          issued: { "date-parts": [[2020]] },
        },
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const crossref = new CrossrefClient(http, cache);

    const out = await enrichMetadata(candidates, [], { crossref });
    // Local title kept.
    expect(out.references[0].title).not.toBe("Crossref Has A Different Title");
    // Conflict recorded.
    const titleProv = out.references[0].provenance?.title;
    expect(titleProv?.conflicts?.length).toBeGreaterThan(0);
    expect(titleProv?.conflicts?.[0].source).toBe("crossref");
  });
});
