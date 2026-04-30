import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EuropePmcClient, parseResult } from "./europepmc.js";
import { ExternalCache } from "./cache.js";
import { HttpClient } from "./http-client.js";

const UA = "rw-test/0.0.0 (mailto:test@example.com)";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE = {
  id: "31234567",
  source: "MED",
  pmid: "31234567",
  doi: "10.1234/abc",
  title: "Reproducibility crisis in machine learning",
  authorString: "Doe J, Smith A",
  journalTitle: "Journal of Foo",
  pubYear: "2020",
};

let dir: string;
let cache: ExternalCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rw-epmc-"));
  cache = new ExternalCache(join(dir, "cache.sqlite"));
});

afterEach(() => {
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("parseResult", () => {
  it("parses a typical EPMC result entry", () => {
    const w = parseResult(SAMPLE);
    expect(w?.doi).toBe("10.1234/abc");
    expect(w?.pmid).toBe("31234567");
    expect(w?.title).toContain("Reproducibility");
    expect(w?.year).toBe(2020);
    expect(w?.authors).toEqual(["Doe J", "Smith A"]);
    expect(w?.journal).toBe("Journal of Foo");
  });

  it("returns null when both doi and pmid are missing", () => {
    expect(parseResult({ title: "x", pubYear: "2020" })).toBeNull();
  });

  it("ignores non-numeric pubYear", () => {
    const w = parseResult({ ...SAMPLE, pubYear: "n/a" });
    expect(w?.year).toBeNull();
  });
});

describe("EuropePmcClient.getByDoi", () => {
  it("returns parsed work and caches", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ resultList: { result: [SAMPLE] } }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new EuropePmcClient(http, cache);
    const a = await client.getByDoi("10.1234/abc");
    const b = await client.getByDoi("10.1234/abc");
    expect(a?.doi).toBe("10.1234/abc");
    expect(b?.doi).toBe("10.1234/abc");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches negative results", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ resultList: { result: [] } }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new EuropePmcClient(http, cache);
    expect(await client.getByDoi("10.0/none")).toBeNull();
    expect(await client.getByDoi("10.0/none")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("EuropePmcClient.getByPmid", () => {
  it("queries EXT_ID + SRC:MED, returns parsed work, and caches the hit", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      // Confirm we're querying by PMID, not DOI.
      expect(url).toMatch(/EXT_ID/);
      expect(url).toMatch(/SRC%3AMED|SRC:MED/);
      expect(url).not.toMatch(/DOI%3A|DOI:/);
      return jsonResponse({ resultList: { result: [SAMPLE] } });
    }) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new EuropePmcClient(http, cache);
    const a = await client.getByPmid("31234567");
    const b = await client.getByPmid("31234567");
    expect(a?.doi).toBe("10.1234/abc");
    expect(a?.pmid).toBe("31234567");
    expect(b?.doi).toBe("10.1234/abc");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("strips non-digits from the PMID input (e.g. 'PMID: 12345')", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toMatch(/EXT_ID%3A12345|EXT_ID:12345/);
      return jsonResponse({ resultList: { result: [SAMPLE] } });
    }) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new EuropePmcClient(http, cache);
    const out = await client.getByPmid("PMID: 12345");
    expect(out?.doi).toBe("10.1234/abc");
  });

  it("caches negative results so a second miss doesn't re-fetch", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ resultList: { result: [] } }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new EuropePmcClient(http, cache);
    expect(await client.getByPmid("99999999")).toBeNull();
    expect(await client.getByPmid("99999999")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("EuropePmcClient.resolveByTitle", () => {
  it("accepts when title and year align", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ resultList: { result: [SAMPLE] } }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new EuropePmcClient(http, cache);
    const out = await client.resolveByTitle(
      "Reproducibility crisis in machine learning",
      2020,
    );
    expect(out?.work.doi).toBe("10.1234/abc");
    expect(out?.work.pmid).toBe("31234567");
  });

  it("rejects when title is too far off", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        resultList: {
          result: [{ ...SAMPLE, title: "An entirely unrelated paper" }],
        },
      }),
    ) as unknown as typeof fetch;
    const http = new HttpClient({ userAgent: UA, fetchImpl });
    const client = new EuropePmcClient(http, cache);
    const out = await client.resolveByTitle(
      "Reproducibility crisis in machine learning",
      2020,
    );
    expect(out).toBeNull();
  });
});
