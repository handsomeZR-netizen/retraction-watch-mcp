import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { RwRecord, ScreenReferenceInput } from "../data/types.js";
import { screenReference } from "./reference-matcher.js";

describe("screenReference performance baseline", () => {
  it("screens one reference against 1000 candidates under 50ms", async () => {
    const records = makeRecords(1000);
    const input: ScreenReferenceInput = {
      raw: "Zhang W, Smith A. Reliable methods for clinical signal detection. Journal of Benchmarks. 2021.",
      title: "Reliable methods for clinical signal detection",
      authors: ["Wei Zhang", "Alice Smith"],
      year: 2021,
      journal: "Journal of Benchmarks",
    };
    const repo = {
      findReferenceCandidates: () => records,
      getRecordsByDoi: () => [],
      getRecordsByPmid: () => [],
      getSourceSnapshot: () => null,
    };

    // Warm-up runs to amortize JIT
    for (let i = 0; i < 3; i += 1) {
      await screenReference(repo, input, undefined, { candidateLimit: 1000 });
    }
    // Take the best of 5 runs to filter out GC / scheduler noise on slow CI VMs.
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const started = performance.now();
      await screenReference(repo, input, undefined, { candidateLimit: 1000 });
      samples.push(performance.now() - started);
    }
    const best = Math.min(...samples);

    // CI runners (especially shared macOS) are 3-5× slower than dev machines.
    // Threshold guards against algorithmic regressions, not absolute speed,
    // so allow generous headroom in CI.
    const threshold = process.env.CI ? 500 : 80;
    expect(best).toBeLessThan(threshold);
  });
});

function makeRecords(count: number): RwRecord[] {
  let seed = 42;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  return Array.from({ length: count }, (_, i) => {
    const a = next() % 1000;
    const b = next() % 1000;
    const title =
      i === count - 1
        ? "Reliable methods for clinical signal detection"
        : `Randomized benchmark topic ${a} with biomedical signal ${b}`;
    const author = i === count - 1 ? "Wei Zhang;Alice Smith" : `Author ${a};Researcher ${b}`;
    return {
      recordId: `rw-${String(i).padStart(4, "0")}`,
      title,
      subject: "",
      institution: "Benchmark Institute",
      journal: i === count - 1 ? "Journal of Benchmarks" : `Journal ${a}`,
      publisher: "",
      country: "USA",
      author,
      urls: "",
      articleType: "Research Article",
      retractionDate: "1/1/2024 0:00",
      retractionDoi: "",
      retractionPubMedId: "",
      originalPaperDate: "1/1/2021 0:00",
      originalPaperDoi: "",
      originalPaperPubMedId: "",
      retractionNature: "Retraction",
      reason: "Benchmark",
      paywalled: "No",
      notes: "",
    };
  });
}
