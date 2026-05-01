import { describe, expect, it } from "vitest";
import {
  acceptFusionMatch,
  levenshtein,
  levenshteinRatio,
  TITLE_FUSION_THRESHOLD,
  YEAR_FUSION_TOLERANCE,
} from "./fusion.js";

describe("levenshtein", () => {
  it("returns zero for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });
  it("counts single-character edits", () => {
    expect(levenshtein("abc", "abd")).toBe(1);
  });
  it("counts insertions", () => {
    expect(levenshtein("abc", "abcd")).toBe(1);
  });
});

describe("levenshteinRatio", () => {
  it("is 1 for identical strings", () => {
    expect(levenshteinRatio("foo", "foo")).toBe(1);
  });
  it("is 0 for one-empty pair", () => {
    expect(levenshteinRatio("foo", "")).toBe(0);
  });
});

describe("acceptFusionMatch", () => {
  const TITLE_A = "Reproducibility crisis in machine learning";
  const TITLE_B = "Reproducibility crisis in machinelearning"; // 1 char merged
  const TITLE_FAR = "An entirely unrelated title";

  it("rejects when local title is missing", () => {
    const out = acceptFusionMatch(
      { title: null, year: 2020 },
      { title: TITLE_A, year: 2020 },
    );
    expect(out.accept).toBe(false);
    expect(out.reason).toBe("missing_title");
  });

  it("accepts when title and year match exactly", () => {
    const out = acceptFusionMatch(
      { title: TITLE_A, year: 2020 },
      { title: TITLE_A, year: 2020 },
    );
    expect(out.accept).toBe(true);
    expect(out.titleRatio).toBe(1);
  });

  it("accepts when title differs by one char and year matches", () => {
    const out = acceptFusionMatch(
      { title: TITLE_A, year: 2020 },
      { title: TITLE_B, year: 2020 },
    );
    expect(out.accept).toBe(true);
    expect(out.titleRatio).toBeGreaterThanOrEqual(TITLE_FUSION_THRESHOLD);
  });

  it("rejects when titles diverge below threshold", () => {
    const out = acceptFusionMatch(
      { title: TITLE_A, year: 2020 },
      { title: TITLE_FAR, year: 2020 },
    );
    expect(out.accept).toBe(false);
    expect(out.titleRatio).toBeLessThan(TITLE_FUSION_THRESHOLD);
    expect(out.reason).toBe("title_below_threshold");
  });

  it("accepts when year is within tolerance", () => {
    const out = acceptFusionMatch(
      { title: TITLE_A, year: 2020 },
      { title: TITLE_A, year: 2019 },
    );
    expect(out.accept).toBe(true);
    expect(out.yearDelta).toBe(1);
  });

  it("rejects when year is beyond tolerance", () => {
    const out = acceptFusionMatch(
      { title: TITLE_A, year: 2020 },
      { title: TITLE_A, year: 2018 },
    );
    expect(out.accept).toBe(false);
    expect(out.yearDelta).toBe(2);
    expect(out.reason).toBe("year_above_tolerance");
  });

  it("rejects when local year is missing", () => {
    const out = acceptFusionMatch(
      { title: TITLE_A, year: null },
      { title: TITLE_A, year: 2020 },
    );
    expect(out.accept).toBe(false);
    expect(out.reason).toBe("missing_year");
  });

  it("rejects when external year is missing", () => {
    const out = acceptFusionMatch(
      { title: TITLE_A, year: 2020 },
      { title: TITLE_A, year: null },
    );
    expect(out.accept).toBe(false);
    expect(out.reason).toBe("missing_year");
  });

  it("uses the configured tolerance constant", () => {
    expect(YEAR_FUSION_TOLERANCE).toBe(1);
    expect(TITLE_FUSION_THRESHOLD).toBe(0.92);
  });
});

describe("acceptFusionMatch — author surname gate", () => {
  const T = "Stochastic blockchain for IoT data integrity";

  it("accepts when one local surname appears in external authors", () => {
    const out = acceptFusionMatch(
      { title: T, year: 2018, authors: ["Chen, Y.-J.", "Lee, K."] },
      { title: T, year: 2018, authors: ["Doe, J.", "Chen, Y.-J."] },
    );
    expect(out.accept).toBe(true);
    expect(out.authorOverlap).toBe(true);
  });

  it("rejects when no local surname matches any external surname", () => {
    const out = acceptFusionMatch(
      { title: T, year: 2018, authors: ["Smith, A.", "Brown, B."] },
      { title: T, year: 2018, authors: ["Doe, J.", "Chen, Y.-J."] },
    );
    expect(out.accept).toBe(false);
    expect(out.reason).toBe("author_surname_mismatch");
    expect(out.authorOverlap).toBe(false);
  });

  it("falls back to title+year when local has no authors (weak match)", () => {
    const out = acceptFusionMatch(
      { title: T, year: 2018 },
      { title: T, year: 2018, authors: ["Doe, J."] },
    );
    expect(out.accept).toBe(true);
    expect(out.reason).toBe("weak_match_no_authors");
    expect(out.authorOverlap).toBe(false);
  });

  it("falls back to title+year when external has no authors", () => {
    const out = acceptFusionMatch(
      { title: T, year: 2018, authors: ["Chen, Y.-J."] },
      { title: T, year: 2018, authors: [] },
    );
    expect(out.accept).toBe(true);
    expect(out.reason).toBe("weak_match_no_authors");
  });

  it("normalizes diacritics (Müller ↔ Muller)", () => {
    const out = acceptFusionMatch(
      { title: T, year: 2018, authors: ["Müller, A."] },
      { title: T, year: 2018, authors: ["Muller, Andreas"] },
    );
    expect(out.accept).toBe(true);
    expect(out.authorOverlap).toBe(true);
  });

  it("handles 'Lastname F.' style on both sides", () => {
    const out = acceptFusionMatch(
      { title: T, year: 2018, authors: ["Chen Y.", "Lee K."] },
      { title: T, year: 2018, authors: ["Y. Chen", "Doe J."] },
    );
    expect(out.accept).toBe(true);
    expect(out.authorOverlap).toBe(true);
  });

  it("handles CJK surnames (李明 ↔ 李, 明)", () => {
    const out = acceptFusionMatch(
      { title: "中国数据完整性研究", year: 2020, authors: ["李 明", "王 芳"] },
      { title: "中国数据完整性研究", year: 2020, authors: ["李 明"] },
    );
    expect(out.accept).toBe(true);
    expect(out.authorOverlap).toBe(true);
  });

  it("ignores 'et al.' as a pseudo-author", () => {
    const out = acceptFusionMatch(
      { title: T, year: 2018, authors: ["et al."] },
      { title: T, year: 2018, authors: ["Doe, J."] },
    );
    expect(out.accept).toBe(true);
    // local surname set is empty, so falls through to weak match.
    expect(out.reason).toBe("weak_match_no_authors");
  });
});
