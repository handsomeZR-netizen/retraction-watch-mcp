import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SemanticScholarClient } from "./semantic-scholar.js";
import { ExternalCache } from "./cache.js";
import { HttpClient } from "./http-client.js";

const UA = "rw-test/0.0.0 (mailto:test@example.com)";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_PAPER = {
  paperId: "abc123",
  title: "Reproducibility crisis in machine learning",
  year: 2020,
  externalIds: { DOI: "10.1234/abc" },
  authors: [
    { authorId: "1", name: "Jane Doe" },
    { authorId: "2", name: "Alex Smith" },
  ],
  venue: "Journal of Foo",
};

let dir: string;
let cache: ExternalCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rw-s2-"));
  cache = new ExternalCache(join(dir, "cache.sqlite"));
});

afterEach(() => {
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("SemanticScholarClient.searchByTitle", () => {
  it("parses results with DOI from externalIds", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [SAMPLE_PAPER] }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new SemanticScholarClient(http, cache);
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
        data: [
          { paperId: "no-doi", title: "x", year: 2020, externalIds: {} },
          SAMPLE_PAPER,
        ],
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new SemanticScholarClient(http, cache);
    const out = await client.searchByTitle("query");
    expect(out).toHaveLength(1);
    expect(out[0].doi).toBe("10.1234/abc");
  });

  it("caches results so the same title query hits the network only once", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [SAMPLE_PAPER] }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new SemanticScholarClient(http, cache);
    await client.searchByTitle("Reproducibility crisis in machine learning");
    await client.searchByTitle("Reproducibility crisis in machine learning");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches negative results too", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404)) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new SemanticScholarClient(http, cache);
    expect(await client.searchByTitle("nothing")).toEqual([]);
    expect(await client.searchByTitle("nothing")).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("SemanticScholarClient.resolveByTitle", () => {
  it("returns the first candidate that passes the fusion gate (title+year+author)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [SAMPLE_PAPER] }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new SemanticScholarClient(http, cache);
    const out = await client.resolveByTitle(
      "Reproducibility crisis in machine learning",
      2020,
      ["Doe, J."],
    );
    expect(out?.work.doi).toBe("10.1234/abc");
    expect(out?.titleRatio).toBeGreaterThanOrEqual(0.92);
    expect(out?.yearDelta).toBe(0);
  });

  it("rejects when title passes but author surnames don't overlap", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [SAMPLE_PAPER] }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new SemanticScholarClient(http, cache);
    const out = await client.resolveByTitle(
      "Reproducibility crisis in machine learning",
      2020,
      ["Wong, R.", "Zhang, X."],
    );
    expect(out).toBeNull();
  });

  it("rejects when no candidate clears title threshold", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [
          { ...SAMPLE_PAPER, title: "A completely different paper title" },
        ],
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new SemanticScholarClient(http, cache);
    const out = await client.resolveByTitle("Reproducibility crisis", 2020);
    expect(out).toBeNull();
  });
});
