import { describe, expect, it } from "vitest";
import {
  buildProvenance,
  classifyReferenceTier,
  localFieldConfidence,
  TIER_CONFIDENCE,
  tierConfidence,
} from "./confidence.js";
import type { StructuredReference } from "../types.js";

function ref(partial: Partial<StructuredReference>): StructuredReference {
  return {
    raw: "raw",
    title: null,
    authors: [],
    year: null,
    doi: null,
    pmid: null,
    journal: null,
    source: "regex_text",
    ...partial,
  };
}

describe("classifyReferenceTier", () => {
  it("returns doi_or_pmid when doi is present", () => {
    expect(classifyReferenceTier(ref({ doi: "10.1/abc" }))).toBe("doi_or_pmid");
  });

  it("returns doi_or_pmid when pmid is present without doi", () => {
    expect(classifyReferenceTier(ref({ pmid: "12345678" }))).toBe("doi_or_pmid");
  });

  it("returns bibtex_full when bibtex source has author+year+title", () => {
    expect(
      classifyReferenceTier(
        ref({
          source: "bibtex",
          title: "Some title",
          year: 2020,
          authors: ["Doe, J."],
        }),
      ),
    ).toBe("bibtex_full");
  });

  it("falls through to title_year when bibtex is missing authors", () => {
    expect(
      classifyReferenceTier(
        ref({ source: "bibtex", title: "T", year: 2020, authors: [] }),
      ),
    ).toBe("title_year");
  });

  it("returns title_year when regex_text has both title and year", () => {
    expect(
      classifyReferenceTier(ref({ title: "T", year: 2020, source: "regex_text" })),
    ).toBe("title_year");
  });

  it("returns raw_only when only raw text is available", () => {
    expect(classifyReferenceTier(ref({ source: "regex_text" }))).toBe("raw_only");
  });
});

describe("tierConfidence", () => {
  it("matches the plan table", () => {
    expect(tierConfidence("doi_or_pmid")).toBe(1.0);
    expect(tierConfidence("bibtex_full")).toBe(0.9);
    expect(tierConfidence("title_year")).toBe(0.6);
    expect(tierConfidence("raw_only")).toBe(0.2);
  });

  it("exposes the tier table", () => {
    expect(TIER_CONFIDENCE.bibtex_full).toBe(0.9);
  });
});

describe("localFieldConfidence", () => {
  it("returns 1.0 for doi field when doi is present", () => {
    expect(localFieldConfidence("doi", ref({ doi: "10.1/abc" }), "regex_doi")).toBe(1.0);
  });

  it("returns 1.0 for pmid field when pmid is present", () => {
    expect(localFieldConfidence("pmid", ref({ pmid: "12345678" }), "regex_pmid")).toBe(1.0);
  });

  it("returns tier confidence for non-id fields", () => {
    const r = ref({ title: "T", year: 2020, source: "regex_text" });
    expect(localFieldConfidence("title", r, "regex_text")).toBe(0.6);
    expect(localFieldConfidence("year", r, "regex_text")).toBe(0.6);
  });

  it("returns 0.9 for title field on bibtex_full reference", () => {
    const r = ref({
      source: "bibtex",
      title: "T",
      year: 2020,
      authors: ["Doe, J."],
    });
    expect(localFieldConfidence("title", r, "bibtex")).toBe(0.9);
  });
});

describe("buildProvenance", () => {
  it("includes only fields that have values", () => {
    const r = ref({ title: "T", year: 2020, source: "regex_text" });
    const map = buildProvenance(r, "regex_text");
    expect(Object.keys(map).sort()).toEqual(["title", "year"]);
    expect(map.title?.confidence).toBe(0.6);
    expect(map.year?.confidence).toBe(0.6);
    expect(map.title?.source).toBe("regex_text");
  });

  it("scores doi and pmid at 1.0 even when other fields are tier-bound", () => {
    const r = ref({
      doi: "10.1/abc",
      title: "T",
      year: 2020,
      authors: ["Doe, J."],
      source: "regex_doi",
    });
    const map = buildProvenance(r, "regex_doi");
    expect(map.doi?.confidence).toBe(1.0);
    expect(map.title?.confidence).toBe(1.0);
  });
});
