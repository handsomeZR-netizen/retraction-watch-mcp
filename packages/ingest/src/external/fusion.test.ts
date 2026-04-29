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
