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

  it("excludes a 3-line title's continuation lines from the author block", () => {
    // Repro for the LSTF-AD bug: the third title line ("VANET Message
    // Streams") used to leak into the author block because sliceAuthorBlock
    // ran its own 2-merge limit instead of reusing extractTitle's range.
    const lines = [
      "LSTF-AD: Lightweight Sender-Level",
      "Temporal Feature Anomaly Detection for",
      "VANET Message Streams",
      "Anonymous Authors",
      "Abstract",
      "Vehicular ad hoc networks (VANETs) rely on periodic cooperative messages…",
    ];
    const block = sliceAuthorBlock(lines);
    expect(block).toEqual(["Anonymous Authors"]);
  });

  it("does not list abstract sentence fragments as authors (Forest. On the …)", () => {
    // After the 16-line scan cap and the sentence-fragment guard in
    // isPlausibleName, abstract-body wraps like "Forest. On the position-
    // offset split…" must not appear in parseRawNames output.
    const block = [
      "Anonymous Authors",
      "Forest. On the position-offset split, the temporal-focused",
      "configuration achieves F1 = 0.8620 versus 0.8499 for Random Forest",
    ];
    const names = parseRawNames(block);
    expect(names).toEqual(["Anonymous Authors"]);
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

  it("rejects separated footnote address affiliations", () => {
    const names = parseRawNames([
      "Worapol Alex Pongpech a",
      "a NIDA, Seri Thai Rd, Bangkok and 10110, Thailand",
    ]);
    expect(names).toEqual(["Worapol Alex Pongpech a"]);
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

  it("maps separated lowercase footnote markers to address-style affiliations", () => {
    const lines = [
      "A Distributed Data Mesh Paradigm for an Event-based Smart Communities Monitoring Product",
      "Worapol Alex Pongpech a",
      "a NIDA, Seri Thai Rd, Bangkok and 10110, Thailand",
      "Abstract",
    ];
    const authors = extractAuthors(lines, lines.join("\n"));
    expect(authors.map((a) => a.name)).toEqual(["Worapol Alex Pongpech"]);
    expect(authors[0].affiliation).toMatch(/NIDA/);
  });
});

describe("RTL author parsing", () => {
  it("splits an Arabic byline on Arabic comma + ASCII comma", () => {
    const lines = [
      "تحليل البيانات الكبيرة في الرعاية الصحية",
      "محمد علي، أحمد حسن, سارة إبراهيم",
      "Department of Computer Science, Cairo University",
    ];
    const names = parseRawNames(lines);
    expect(names).toContain("محمد علي");
    expect(names).toContain("أحمد حسن");
    expect(names).toContain("سارة إبراهيم");
    // Department line must NOT yield a name
    expect(names.every((n) => !/Department/.test(n))).toBe(true);
  });

  it("splits a Hebrew byline on Hebrew comma + 'ו' conjunction", () => {
    const lines = [
      "ניתוח נתונים גדולים בבריאות",
      "דוד כהן, מיכאל לוי ו רחל ישראלי",
      "Faculty of Computer Science, Hebrew University",
    ];
    const names = parseRawNames(lines);
    expect(names).toContain("דוד כהן");
    expect(names).toContain("מיכאל לוי");
    expect(names).toContain("רחל ישראלי");
  });

  it("ignores RTL lines that lack any RTL letters (defensive)", () => {
    const names = parseRawNames(["Alice Smith, Bob Jones"]);
    // Latin-only line still flows through the Latin path.
    expect(names).toContain("Alice Smith");
    expect(names).toContain("Bob Jones");
  });
});
