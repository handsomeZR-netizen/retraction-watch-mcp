import { describe, expect, it } from "vitest";
import { heuristicStructureReferences, locateAndSplitReferences, regexStructure } from "./refs.js";
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

    const refs = locateAndSplitReferences(doc);
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
});
