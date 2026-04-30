import { describe, expect, it } from "vitest";
import {
  findReferencesByMarker,
  heuristicStructureReferences,
  locateAndSplitReferences,
  regexStructure,
  unwrapBlobReferences,
} from "./refs.js";
import type { ExtractedDocument } from "./types.js";

describe("reference extraction fallback", () => {
  it("keeps author-year references without DOI when LLM is unavailable", () => {
    const doc: ExtractedDocument = {
      fullText: [
        "Title",
        "",
        "References",
        "Alladi, T., Agrawal, A., Gera, B., Chamola, V., Sikdar, B., and Guizani, M. (2021a). Deep neural networks for securing IoT enabled vehicular ad-hoc networks. In ICC 2021 - IEEE International Conference on Communications, pages 1-6.",
        "Boualouache, A. and Engel, T. (2023). A survey on machine-learning-based misbehavior detection systems for 5g and beyond vehicular networks. IEEE Communications Surveys & Tutorials, 25(2):1128-1172.",
        "Breiman, L. (2001). Random forests. Machine Learning, 45(1):5-32.",
        "Golle, P., Greene, D. H., and Staddon, J. (2004). Detecting and correcting malicious data in VANETs. In Proceedings of the First ACM Workshop on Vehicular Ad Hoc Networks, pages 29-37.",
      ].join("\n"),
      pages: [],
      metadata: {},
      source: "pdf",
      ocrUsed: false,
      warnings: [],
    };

    const { refs } = locateAndSplitReferences(doc);
    const { structured, unresolved } = regexStructure(refs);
    const fallback = heuristicStructureReferences(unresolved);

    expect(refs).toHaveLength(4);
    expect(structured).toHaveLength(0);
    expect(fallback).toHaveLength(4);
    expect(fallback[0]).toMatchObject({
      source: "regex_text",
      year: 2021,
    });
    expect(fallback[0]?.title).toBe(
      "Deep neural networks for securing IoT enabled vehicular ad-hoc networks",
    );
    expect(fallback[0]?.authors).toContain("Alladi T.");
  });

  it("recursively splits an overlong entry that concatenated 3 author-year refs on one line", () => {
    // Real failure mode observed in the 100-sample smoke test: APA-style
    // refs on one line collapse into a single >1500-char raw because the
    // line-based splitter never sees a newline between them.
    const concatenated =
      "Wu, P., Xia, B., & Zhao, X. (2014). The importance of use and end-of-life phases to the life cycle greenhouse gas (GHG) emissions of concrete—A review. Renewable and Sustainable Energy Reviews, 37, 360–369. " +
      "Zabalza Bribián, I., Valero Capilla, A., & Aranda Usón, A. (2011). Life cycle assessment of building materials: Comparative analysis of energy and environmental impacts. Building and Environment, 46(5), 1133–1140. " +
      "Smith, J., & Doe, R. (2018). Carbon footprint of cement production. Journal of Cleaner Production, 200, 1234–1245.";
    const lines = [
      "Other, A. (2010). First reference. Journal A, 1, 1.",
      "Padding, B. (2011). Second reference. Journal B, 2, 2.",
      "Filler, C. (2012). Third reference. Journal C, 3, 3.",
      concatenated,
    ];
    const doc: ExtractedDocument = {
      fullText: ["Title", "", "References", ...lines].join("\n"),
      pages: [],
      metadata: {},
      source: "pdf",
      ocrUsed: false,
      warnings: [],
    };
    const { refs } = locateAndSplitReferences(doc);
    // Three padding entries + 3 split sub-refs = 6.
    expect(refs.length).toBeGreaterThanOrEqual(6);
    const haystack = refs.map((r) => r.raw).join("\n");
    expect(haystack).toMatch(/Wu, P\., Xia, B\., & Zhao/);
    expect(haystack).toMatch(/Zabalza Bribi[aá]n/);
    expect(haystack).toMatch(/Smith, J\., & Doe/);
    // Each split piece should be a sane ref-sized chunk, not the merged blob.
    const wuRef = refs.find((r) => /^Wu, P\./.test(r.raw));
    expect(wuRef).toBeDefined();
    expect(wuRef!.raw.length).toBeLessThan(400);
    expect(wuRef!.raw).not.toMatch(/Zabalza/);
  });

  it("filters out body-text paragraphs that leaked past the references header", () => {
    // Real failure: an appendix section "A.2.4 Data Annotation: DV-Evol"
    // wasn't stripped by trimToReferences, and a paragraph starting with
    // "Sales, Inventory) capable of supporting hierarchical analysis…"
    // landed in the splitter output. It happens to contain a year so the
    // old `length > 25 && /\d{4}/` filter accepted it.
    const bodyTextLeak =
      "Sales, Inventory) capable of supporting hierarchical analysis; 2) Baseline Prototyping, using coding agents to generate a Python script (via openpyxl) that constructs the initial layout. This results in a final file complete with calculated KPI cards. The benchmark targets the critical capability of Visual Refinement, with tasks dating from 2024 onwards.";
    const doc: ExtractedDocument = {
      fullText: [
        "Title",
        "",
        "References",
        "Smith, J. (2020). Real reference one. Journal A, 1, 1.",
        "Doe, R. (2021). Real reference two. Journal B, 2, 2.",
        "Lee, K. (2022). Real reference three. Journal C, 3, 3.",
        "Chen, X. (2023). Real reference four. Journal D, 4, 4.",
        bodyTextLeak,
      ].join("\n"),
      pages: [],
      metadata: {},
      source: "pdf",
      ocrUsed: false,
      warnings: [],
    };
    const { refs } = locateAndSplitReferences(doc);
    expect(refs.map((r) => r.raw)).not.toContain(bodyTextLeak);
    // The 4 real refs should still be present.
    expect(refs.length).toBe(4);
  });

  it("splits a concat where boundary refs are bare-acronym orgs (ISO, IUCN)", () => {
    // Real failure case from the smoke benchmark: 4 refs jammed together,
    // and the boundary authors after the first one are short uppercase
    // acronyms (ISO, IUCN). The interior-boundary regex used to match only
    // word orgs ending in Ltd|Inc|Corp|... — bare acronyms slipped past.
    const concatenated =
      "Huo, J., Chen, P., Hubacek, K., Zheng, H., Meng, J., & Guan, D. (2022). Full-scale, near real-time multi-regional input-output table for the global emerging economies. Journal of Industrial Ecology, 26(4), 1218–1232. " +
      "International Food Policy Research Institute. (2024). Global Spatially-Disaggregated Crop Production Statistics Data for 2020 Version 1.0. " +
      "ISO. (2006). 14040: Environmental management – life cycle assessment – principles and framework. " +
      "IUCN. (2021). Amphibians, birds and mammals (spatial data).";
    const lines = [
      "Other, A. (2010). First reference. Journal A, 1, 1.",
      "Padding, B. (2011). Second reference. Journal B, 2, 2.",
      "Filler, C. (2012). Third reference. Journal C, 3, 3.",
      concatenated,
    ];
    const doc: ExtractedDocument = {
      fullText: ["Title", "", "References", ...lines].join("\n"),
      pages: [],
      metadata: {},
      source: "pdf",
      ocrUsed: false,
      warnings: [],
    };
    const { refs } = locateAndSplitReferences(doc);
    const haystack = refs.map((r) => r.raw).join("\n---\n");
    // 3 padding entries + 4 split sub-refs from the concatenation.
    expect(refs.length).toBeGreaterThanOrEqual(7);
    expect(haystack).toMatch(/^Huo, J\./m);
    expect(haystack).toMatch(/^International Food Policy/m);
    expect(haystack).toMatch(/^ISO\.\s*\(2006\)/m);
    expect(haystack).toMatch(/^IUCN\.\s*\(2021\)/m);
  });
});

describe("LLM-fallback signals", () => {
  it("locateAndSplitReferences returns needsLlmFallback when no References header is found", () => {
    // Mimics a double-column PDF where unpdf's reading order ate the header.
    // Body still contains numbered citation markers but no "References".
    const garbledTail = [
      "[1] Smith J, Doe R. Paper one. Journal A 2020;1:1.",
      "[2] Lee K. Paper two. Journal B 2021;2:2.",
      "[3] Patel R. Paper three. Journal C 2022;3:3.",
      "[4] Wong Y. Paper four. Journal D 2023;4:4.",
      "[5] Garcia M. Paper five. Journal E 2024;5:5.",
    ].join("\n");
    const doc: ExtractedDocument = {
      fullText:
        "Title\n\nIntroduction body…\n\n" +
        "Filler text. ".repeat(200) +
        "\n" +
        garbledTail,
      pages: [],
      metadata: {},
      source: "pdf",
      ocrUsed: false,
      warnings: [],
    };
    const result = locateAndSplitReferences(doc);
    // Header-by-marker fallback should locate the [1] anchor and split.
    expect(result.referencesStartIndex).toBeGreaterThan(0);
    expect(result.refs.length).toBeGreaterThanOrEqual(3);
    expect(result.needsLlmFallback).toBe(false);
  });

  it("returns needsLlmFallback=true when neither header nor markers exist", () => {
    const doc: ExtractedDocument = {
      fullText: "A paper with no references section at all. Lorem ipsum dolor sit amet ".repeat(20),
      pages: [],
      metadata: {},
      source: "pdf",
      ocrUsed: false,
      warnings: [],
    };
    const result = locateAndSplitReferences(doc);
    expect(result.refs.length).toBe(0);
    expect(result.needsLlmFallback).toBe(true);
    expect(result.referencesStartIndex).toBe(-1);
  });

  it("findReferencesByMarker locks onto the first sustained run of low-numbered markers", () => {
    const text =
      "Discussion: prior work [34] noted X, and [35] explored Y, so we [36] tested Z. " +
      // ↑ this run is the discussion's own citations — must NOT match (numbers too high)
      "Filler ".repeat(500) +
      "1. Anderson A. First ref. Journal A 2018;1:1. " +
      "2. Berry B. Second ref. Journal B 2019;2:2. " +
      "3. Carlos C. Third ref. Journal C 2020;3:3.";
    const idx = findReferencesByMarker(text);
    expect(idx).toBeGreaterThan(0);
    // The match should land at or after "1. Anderson", not at "[34]".
    expect(text.slice(idx, idx + 20)).toMatch(/^\s*1\.\s+Anderson/);
  });

  it("unwrapBlobReferences inserts newlines before numbered markers in a single-line blob", () => {
    // Real failure mode: unpdf returns refs as one long line.
    // Each entry padded to ~70 chars × 50 = 3500+ chars, satisfying the
    // length threshold.
    const blob =
      "References " +
      Array.from({ length: 50 }, (_, i) => {
        const n = i + 1;
        return ` ${n}. Author${n} A. Title that is reasonably descriptive number ${n}. Journal X 202${i % 10}; ${n}: ${100 + n}-${110 + n}.`;
      }).join("");
    expect(blob.length).toBeGreaterThan(3000);
    expect((blob.match(/\n/g) ?? []).length).toBe(0);
    const unwrapped = unwrapBlobReferences(blob);
    expect((unwrapped.match(/\n/g) ?? []).length).toBeGreaterThanOrEqual(50);
    // Each line after the split should start with its marker.
    expect(unwrapped).toMatch(/\n1\. Author1/);
    expect(unwrapped).toMatch(/\n50\. Author50/);
  });
});
