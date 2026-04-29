import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrossrefClient, parseWork } from "./crossref.js";
import { ExternalCache } from "./cache.js";
import { HttpClient } from "./http-client.js";

const UA = "rw-test/0.0.0 (mailto:test@example.com)";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_MESSAGE = {
  DOI: "10.1234/abc",
  title: ["Reproducibility crisis in machine learning"],
  "container-title": ["Journal of Foo"],
  author: [
    { given: "J.", family: "Doe" },
    { given: "A.", family: "Smith" },
  ],
  issued: { "date-parts": [[2020]] },
};

let dir: string;
let cache: ExternalCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rw-crossref-"));
  cache = new ExternalCache(join(dir, "cache.sqlite"));
});

afterEach(() => {
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("parseWork", () => {
  it("parses a typical Crossref message", () => {
    const w = parseWork(SAMPLE_MESSAGE);
    expect(w?.doi).toBe("10.1234/abc");
    expect(w?.title).toBe("Reproducibility crisis in machine learning");
    expect(w?.year).toBe(2020);
    expect(w?.authors).toEqual(["Doe, J.", "Smith, A."]);
    expect(w?.journal).toBe("Journal of Foo");
  });

  it("returns null when DOI is missing", () => {
    expect(parseWork({ title: ["x"] })).toBeNull();
  });

  it("falls back to other date fields when issued is absent", () => {
    const w = parseWork({ DOI: "10.1/x", "published-online": { "date-parts": [[2019]] } });
    expect(w?.year).toBe(2019);
  });
});

describe("CrossrefClient.getByDoi", () => {
  it("returns parsed work and caches the result", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: SAMPLE_MESSAGE })) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new CrossrefClient(http, cache);
    const a = await client.getByDoi("10.1234/abc");
    const b = await client.getByDoi("10.1234/abc");
    expect(a?.doi).toBe("10.1234/abc");
    expect(b?.doi).toBe("10.1234/abc");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches negative results so we don't hammer the API", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404)) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new CrossrefClient(http, cache);
    expect(await client.getByDoi("10.0/none")).toBeNull();
    expect(await client.getByDoi("10.0/none")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("CrossrefClient.resolveByTitle", () => {
  it("returns null when no candidate clears the threshold", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        message: {
          items: [
            { ...SAMPLE_MESSAGE, title: ["A completely different paper title"] },
          ],
        },
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new CrossrefClient(http, cache);
    const out = await client.resolveByTitle(
      "Reproducibility crisis in machine learning",
      2020,
    );
    expect(out).toBeNull();
  });

  it("returns the matched work when title and year are within tolerance", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: { items: [SAMPLE_MESSAGE] } }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new CrossrefClient(http, cache);
    const out = await client.resolveByTitle(
      "Reproducibility crisis in machine learning",
      2020,
    );
    expect(out?.work.doi).toBe("10.1234/abc");
    expect(out?.titleRatio).toBe(1);
    expect(out?.yearDelta).toBe(0);
  });

  it("returns null when local year is missing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: { items: [SAMPLE_MESSAGE] } }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new CrossrefClient(http, cache);
    const out = await client.resolveByTitle(
      "Reproducibility crisis in machine learning",
      null,
    );
    expect(out).toBeNull();
  });
});
