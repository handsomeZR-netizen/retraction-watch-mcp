import type {
  AuthorScreenResult,
  MatchVerdict,
  ScreenReferenceResult,
} from "@rw/core";
import { describe, expect, it } from "vitest";
import { countTotals, decideVerdict } from "./screen-manuscript.js";

function ref(verdict: MatchVerdict): { result: ScreenReferenceResult } {
  // countTotals only reads result.verdict; cast keeps the fixture small.
  return { result: { verdict } as ScreenReferenceResult };
}

function author(verdict: MatchVerdict): AuthorScreenResult {
  return {
    author: { name: "X", email: null, affiliation: null, orcid: null },
    verdict,
    score: 0,
    matchedRecord: null,
    evidence: [],
    matchedFields: [],
  };
}

describe("countTotals", () => {
  it("buckets references and authors into separate counters", () => {
    const totals = countTotals(
      [ref("confirmed"), ref("likely_match"), ref("possible_match"), ref("no_match")],
      [author("confirmed"), author("likely_match"), author("possible_match"), author("no_match")],
    );
    expect(totals).toEqual({
      references: 4,
      confirmed: 1,
      likely: 1,
      possible: 1,
      clean: 1,
      authorsConfirmed: 1,
      authorsLikely: 1,
      authorsPossible: 1,
    });
  });
});

describe("decideVerdict", () => {
  it("returns FAIL when any reference is confirmed", () => {
    const totals = countTotals([ref("confirmed")], []);
    expect(decideVerdict(totals)).toBe("FAIL");
  });

  it("returns FAIL when any author is confirmed (even with clean references)", () => {
    const totals = countTotals([ref("no_match"), ref("no_match")], [author("confirmed")]);
    expect(decideVerdict(totals)).toBe("FAIL");
  });

  it("returns REVIEW when only an author is likely (no confirmed hits anywhere)", () => {
    const totals = countTotals([ref("no_match")], [author("likely_match")]);
    expect(decideVerdict(totals)).toBe("REVIEW");
  });

  it("returns REVIEW when only an author is possible", () => {
    const totals = countTotals([], [author("possible_match")]);
    expect(decideVerdict(totals)).toBe("REVIEW");
  });

  it("returns REVIEW when references have likely/possible hits without confirmed", () => {
    const totals = countTotals([ref("likely_match"), ref("possible_match")], []);
    expect(decideVerdict(totals)).toBe("REVIEW");
  });

  it("returns PASS when nothing matches", () => {
    const totals = countTotals([ref("no_match"), ref("no_match")], [author("no_match")]);
    expect(decideVerdict(totals)).toBe("PASS");
  });

  it("returns REVIEW when text extraction was empty and zero references parsed", () => {
    const totals = countTotals([], []);
    expect(decideVerdict(totals, ["text_extraction_empty"])).toBe("REVIEW");
  });

  it("does NOT promote to REVIEW on text_extraction_empty warning when references exist", () => {
    const totals = countTotals([ref("no_match"), ref("no_match")], []);
    expect(decideVerdict(totals, ["text_extraction_empty"])).toBe("PASS");
  });
});
