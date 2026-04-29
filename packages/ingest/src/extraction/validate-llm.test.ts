import { describe, expect, it } from "vitest";
import { validateLlmExtraction } from "./validate-llm.js";

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
