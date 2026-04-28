import { describe, expect, it } from "vitest";
import {
  dedupAuthorWithFootnoteSuffix,
  extractAuthors,
  parseRawNames,
  sliceAuthorBlock,
} from "./authors.js";

const ELSEVIER_HEADER_LINES = [
  "Learnable Graph ODE Networks for Anomaly Detection in CAN-FD Vehicle Networks",
  "Miao Xua, Lizeng Zhangb and Peiyu Houc",
  "aSchool of Civil Engineering and Transportation, Beihua University, Jilin, China.",
  "bHaomo.AI Technology Co., Ltd, Beijing 101300, China.",
  "cSchool of Civil Engineering and Transportation, Beihua University, Jilin, China.",
  "A R T I C L E I N F O",
  "Keywords:",
  "Anomaly Detection",
  "Graph Structure Learning",
  "A B S T R A C T",
  "As vehicles become increasingly interconnected with networks…",
];

describe("sliceAuthorBlock", () => {
  it("stops at the A R T I C L E I N F O boundary", () => {
    const block = sliceAuthorBlock(ELSEVIER_HEADER_LINES);
    expect(block).toContain("Miao Xua, Lizeng Zhangb and Peiyu Houc");
    expect(block.some((l) => /^A R T I C L E/.test(l))).toBe(false);
    expect(block.some((l) => /Anomaly Detection/.test(l))).toBe(false);
  });

  it("stops at an inline 'Keywords:' line", () => {
    const lines = [
      "Useful Paper Title Here",
      "Alice Doea, Bob Smithb",
      "aDepartment of Examples, Example University",
      "Keywords: anomaly, graph, ODE",
      "Anomaly Detection",
    ];
    const block = sliceAuthorBlock(lines);
    expect(block.every((l) => !/anomaly detection/i.test(l) || /aDepartment/.test(l))).toBe(true);
  });
});

describe("parseRawNames", () => {
  it("rejects bullet lines, footnote-prefixed corp affiliations, and country fragments", () => {
    const block = [
      "Miao Xua, Lizeng Zhangb and Peiyu Houc",
      "• Bullet text that should not be parsed",
      "aSchool of Civil Engineering, Beihua University",
      "bHaomo.AI Technology Co., Ltd, Beijing 101300, China.",
      "China.",
      "Singapore",
    ];
    const names = parseRawNames(block);
    // Only the actual author line should yield names
    expect(names).toContain("Miao Xua");
    expect(names).toContain("Lizeng Zhangb");
    expect(names).toContain("Peiyu Houc");
    expect(names).not.toContain("China.");
    expect(names).not.toContain("Singapore");
    expect(names.find((n) => /Haomo/.test(n))).toBeUndefined();
    expect(names.find((n) => /^•/.test(n))).toBeUndefined();
  });
});

describe("dedupAuthorWithFootnoteSuffix", () => {
  it("collapses 'Mira Chen' and 'Mira Chena' into the marker form", () => {
    const out = dedupAuthorWithFootnoteSuffix(["Mira Chen", "Mira Chena"]);
    expect(out).toEqual(["Mira Chena"]);
  });

  it("preserves order of first appearance", () => {
    const out = dedupAuthorWithFootnoteSuffix([
      "Alice Doe",
      "Bob Smith",
      "Alice Doea",
      "Charlie Park",
    ]);
    expect(out).toEqual(["Alice Doea", "Bob Smith", "Charlie Park"]);
  });

  it("treats CJK names without footnote markers as distinct entries", () => {
    const out = dedupAuthorWithFootnoteSuffix(["王伟", "李明"]);
    expect(out).toEqual(["王伟", "李明"]);
  });
});

describe("extractAuthors integration", () => {
  it("extracts 3 authors from a synthetic Elsevier header with affiliations mapped by footnote", () => {
    const fullText = ELSEVIER_HEADER_LINES.join("\n");
    const authors = extractAuthors(ELSEVIER_HEADER_LINES, fullText);
    expect(authors.map((a) => a.name)).toEqual(["Miao Xu", "Lizeng Zhang", "Peiyu Hou"]);
    expect(authors[0].affiliation).toMatch(/Beihua University/);
    expect(authors[1].affiliation).toMatch(/Haomo|Beijing/);
    expect(authors[2].affiliation).toMatch(/Beihua University/);
  });
});
