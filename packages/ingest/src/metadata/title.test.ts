import { describe, expect, it } from "vitest";
import { candidateLooksLikeTitle, extractTitle } from "./title.js";

describe("title extraction", () => {
  it("rejects letter-spaced banner text used by Wiley / J Ind Ecol templates", () => {
    expect(candidateLooksLikeTitle("R E S E A R C H A R T I C L E")).toBe(false);
    expect(candidateLooksLikeTitle("M E T H O D S A R T I C L E")).toBe(false);
    expect(candidateLooksLikeTitle("R E V I E W")).toBe(false);
  });

  it("still accepts a normal academic title", () => {
    expect(
      candidateLooksLikeTitle("Learnable Graph ODE Networks for Anomaly Detection"),
    ).toBe(true);
  });

  it("skips banner text and picks the real title underneath", () => {
    const lines = [
      "R E S E A R C H A R T I C L E",
      "Bayesian material flow analysis for systems with multiple levels",
      "Alice Smith",
    ];
    expect(extractTitle(lines)).toContain("Bayesian material flow analysis");
  });

  it("does not reject titles that legitimately contain single-letter abbreviations", () => {
    // 6 tokens, 1 single-char (B) — well below the 60% threshold.
    expect(
      candidateLooksLikeTitle("A vitamin B deficiency study in mice"),
    ).toBe(true);
  });

  it("rejects condensed article-class banners like 'Research Article' / 'Technical Report'", () => {
    expect(candidateLooksLikeTitle("Research Article")).toBe(false);
    expect(candidateLooksLikeTitle("Methods Article")).toBe(false);
    expect(candidateLooksLikeTitle("Technical Report")).toBe(false);
    expect(candidateLooksLikeTitle("Brief Communication")).toBe(false);
    expect(candidateLooksLikeTitle("Review Article")).toBe(false);
  });

  it("merges a 5-token title with its continuation line", () => {
    const lines = [
      "DV-World: Benchmarking Data Visualization",
      "Agents in Real-World Scenarios",
      "Alice Smith, Bob Jones",
    ];
    const t = extractTitle(lines);
    expect(t).toContain("DV-World");
    expect(t).toContain("Real-World Scenarios");
  });
});
