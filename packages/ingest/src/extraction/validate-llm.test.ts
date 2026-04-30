import { describe, expect, it } from "vitest";
import { looksLikeMetadataNoise, validateLlmExtraction } from "./validate-llm.js";

const REF =
  "Doe J, Smith A. Some title. Journal of Foo, 2020. doi:10.1234/abc.def-99 PMID: 31234567";

function llm(partial: Partial<Parameters<typeof validateLlmExtraction>[1]>) {
  return validateLlmExtraction(REF, {
    title: null,
    authors: [],
    year: null,
    doi: null,
    pmid: null,
    journal: null,
    ...partial,
  });
}

describe("validateLlmExtraction — DOI guardrail", () => {
  it("keeps a legit DOI present in the text", () => {
    const out = llm({ doi: "10.1234/abc.def-99" });
    expect(out.cleaned.doi).toBe("10.1234/abc.def-99");
    expect(out.rejected).toEqual([]);
  });

  it("rejects a fabricated DOI not in the text", () => {
    const out = llm({ doi: "10.9999/totally-fake" });
    expect(out.cleaned.doi).toBeNull();
    expect(out.rejected).toContain("doi");
  });

  it("accepts a DOI with internal whitespace difference", () => {
    const out = llm({ doi: "10.1234 /abc.def-99" });
    expect(out.cleaned.doi).toBe("10.1234 /abc.def-99");
    expect(out.rejected).toEqual([]);
  });

  it("accepts a DOI that differs only in case", () => {
    const out = llm({ doi: "10.1234/ABC.DEF-99" });
    expect(out.cleaned.doi).toBe("10.1234/ABC.DEF-99");
    expect(out.rejected).toEqual([]);
  });

  it("rejects a DOI that is a near-miss substring", () => {
    const out = llm({ doi: "10.1234/abc.def-98" });
    expect(out.cleaned.doi).toBeNull();
    expect(out.rejected).toContain("doi");
  });
});

describe("validateLlmExtraction — PMID guardrail", () => {
  it("keeps a PMID present in the text", () => {
    const out = llm({ pmid: "31234567" });
    expect(out.cleaned.pmid).toBe("31234567");
    expect(out.rejected).toEqual([]);
  });

  it("rejects a PMID not in the text", () => {
    const out = llm({ pmid: "99999999" });
    expect(out.cleaned.pmid).toBeNull();
    expect(out.rejected).toContain("pmid");
  });
});

describe("validateLlmExtraction — year guardrail", () => {
  it("keeps a year present in the text", () => {
    const out = llm({ year: 2020 });
    expect(out.cleaned.year).toBe(2020);
    expect(out.rejected).toEqual([]);
  });

  it("rejects a fabricated year", () => {
    const out = llm({ year: 1999 });
    expect(out.cleaned.year).toBeNull();
    expect(out.rejected).toContain("year");
  });

  it("does not match year when only a substring overlaps", () => {
    // text contains 2020 but not 2200 even though digits overlap
    const out = llm({ year: 2200 });
    expect(out.cleaned.year).toBeNull();
    expect(out.rejected).toContain("year");
  });
});

describe("validateLlmExtraction — passthrough", () => {
  it("does not touch title, authors, or journal", () => {
    const out = llm({
      title: "Some completely-rewritten title that need not be in text",
      authors: ["Doe, J.", "Smith, A."],
      journal: "Journal of Foo",
    });
    expect(out.cleaned.title).toContain("rewritten");
    expect(out.cleaned.authors).toHaveLength(2);
    expect(out.cleaned.journal).toBe("Journal of Foo");
  });

  it("aggregates multiple rejections", () => {
    const out = llm({ doi: "10.0/none", pmid: "11111111", year: 1850 });
    expect(out.rejected.sort()).toEqual(["doi", "pmid", "year"]);
    expect(out.cleaned.doi).toBeNull();
    expect(out.cleaned.pmid).toBeNull();
    expect(out.cleaned.year).toBeNull();
  });
});

describe("looksLikeMetadataNoise — title shape detector", () => {
  it("rejects pure page-range fragments", () => {
    expect(looksLikeMetadataNoise("1-4.")).toBe(true);
    expect(looksLikeMetadataNoise("373-384")).toBe(true);
    expect(looksLikeMetadataNoise("p. 373-384.")).toBe(true);
  });

  it("rejects vol(issue):page fragments", () => {
    expect(looksLikeMetadataNoise("7(1): p. 373-384.")).toBe(true);
    expect(looksLikeMetadataNoise("57(6): 365-388")).toBe(true);
  });

  it("rejects month-day vol(issue):page fragments", () => {
    expect(looksLikeMetadataNoise("Aug 17;57(6):365–88.")).toBe(true);
    expect(looksLikeMetadataNoise("Mar 5;12(3):100-120")).toBe(true);
  });

  it("rejects year;vol:page fragments", () => {
    expect(looksLikeMetadataNoise("2020;57:365-88")).toBe(true);
    expect(looksLikeMetadataNoise("2018; 7: 100-120")).toBe(true);
  });

  it("rejects too-short and digits-only fragments", () => {
    expect(looksLikeMetadataNoise("1-4")).toBe(true);
    expect(looksLikeMetadataNoise("57:365")).toBe(true);
    expect(looksLikeMetadataNoise("(2020)")).toBe(true);
  });

  it("keeps real article titles", () => {
    expect(looksLikeMetadataNoise("The COVID-19 pandemic")).toBe(false);
    expect(
      looksLikeMetadataNoise(
        "Self-Attention Based Molecule Representation for Predicting Drug-Target Interaction",
      ),
    ).toBe(false);
    expect(
      looksLikeMetadataNoise(
        "Stochastic blockchain for IoT data integrity",
      ),
    ).toBe(false);
  });

  it("keeps real book and standard titles even when they start with digits", () => {
    expect(
      looksLikeMetadataNoise("ISO 10218-1: Robots and Robotic Devices"),
    ).toBe(false);
    expect(
      looksLikeMetadataNoise("Methods of Multivariate Analysis"),
    ).toBe(false);
    // A title starting with a year-like number but with substantive words.
    expect(
      looksLikeMetadataNoise("2020 Annual Review of Genomics"),
    ).toBe(false);
  });
});

describe("validateLlmExtraction — title noise rejection", () => {
  it("nulls out a vol-issue-page title", () => {
    const out = llm({ title: "7(1): p. 373-384." });
    expect(out.cleaned.title).toBeNull();
    expect(out.rejected).toContain("title");
  });

  it("nulls out a Mon-day vol-issue-page title", () => {
    const out = llm({ title: "Aug 17;57(6):365–88." });
    expect(out.cleaned.title).toBeNull();
    expect(out.rejected).toContain("title");
  });

  it("keeps a real article title untouched", () => {
    const out = llm({ title: "The COVID-19 pandemic" });
    expect(out.cleaned.title).toBe("The COVID-19 pandemic");
    expect(out.rejected).not.toContain("title");
  });
});
