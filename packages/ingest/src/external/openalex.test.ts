import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAlexClient } from "./openalex.js";
import { ExternalCache } from "./cache.js";
import { HttpClient } from "./http-client.js";

const UA = "rw-test/0.0.0 (mailto:test@example.com)";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_RESULT = {
  doi: "https://doi.org/10.1234/abc",
  title: "Reproducibility crisis in machine learning",
  publication_year: 2020,
  authorships: [
    { author: { display_name: "Jane Doe" } },
    { author: { display_name: "Alex Smith" } },
  ],
  primary_location: {
    source: { display_name: "Journal of Foo" },
  },
};

let dir: string;
let cache: ExternalCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rw-openalex-"));
  cache = new ExternalCache(join(dir, "cache.sqlite"));
});

afterEach(() => {
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("OpenAlexClient.searchByTitle", () => {
  it("parses results and strips the doi.org URL prefix", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ results: [SAMPLE_RESULT] }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new OpenAlexClient(http, cache);
    const out = await client.searchByTitle("Reproducibility crisis in machine learning");
    expect(out).toHaveLength(1);
    expect(out[0].doi).toBe("10.1234/abc");
    expect(out[0].title).toBe("Reproducibility crisis in machine learning");
    expect(out[0].year).toBe(2020);
    expect(out[0].journal).toBe("Journal of Foo");
    expect(out[0].authors).toEqual(["Jane Doe", "Alex Smith"]);
  });

  it("filters out results without a DOI", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: [
          { title: "no-doi paper", publication_year: 2020 },
          SAMPLE_RESULT,
        ],
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new OpenAlexClient(http, cache);
    const out = await client.searchByTitle("query");
    expect(out).toHaveLength(1);
    expect(out[0].doi).toBe("10.1234/abc");
  });

  it("caches results so the same title query hits the network only once", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ results: [SAMPLE_RESULT] }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new OpenAlexClient(http, cache);
    await client.searchByTitle("Reproducibility crisis in machine learning");
    await client.searchByTitle("Reproducibility crisis in machine learning");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches negative results too", async () => {
    // 404 doesn't trigger retry/backoff (only 429/5xx do); keeps the test fast.
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404)) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new OpenAlexClient(http, cache);
    expect(await client.searchByTitle("nothing")).toEqual([]);
    expect(await client.searchByTitle("nothing")).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAlexClient.resolveByTitle", () => {
  it("returns the first candidate that passes the fusion gate", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ results: [SAMPLE_RESULT] }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new OpenAlexClient(http, cache);
    const out = await client.resolveByTitle(
      "Reproducibility crisis in machine learning",
      2020,
    );
    expect(out?.work.doi).toBe("10.1234/abc");
    expect(out?.titleRatio).toBeGreaterThanOrEqual(0.92);
    expect(out?.yearDelta).toBe(0);
  });

  it("returns null when no candidate clears the fusion gate", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: [
          { ...SAMPLE_RESULT, title: "A completely different paper title" },
        ],
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new OpenAlexClient(http, cache);
    const out = await client.resolveByTitle("Reproducibility crisis", 2020);
    expect(out).toBeNull();
  });

  it("rejects matches that pass title but fail year tolerance", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: [{ ...SAMPLE_RESULT, publication_year: 2010 }],
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new OpenAlexClient(http, cache);
    const out = await client.resolveByTitle(
      "Reproducibility crisis in machine learning",
      2020,
    );
    expect(out).toBeNull();
  });
});
