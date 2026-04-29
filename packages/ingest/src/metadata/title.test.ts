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

  it("rejects standalone journal-name banners", () => {
    expect(candidateLooksLikeTitle("International Journal of Architectural Computing")).toBe(false);
    expect(candidateLooksLikeTitle("Journal of Industrial Ecology")).toBe(false);
    expect(candidateLooksLikeTitle("Frontiers in Radiology")).toBe(false);
    expect(candidateLooksLikeTitle("Annals of Mathematics")).toBe(false);
  });

  it("merges a long colon-separated subtitle continuation (up to ~10 tokens)", () => {
    const lines = [
      "Tradeoffs and synergy between material cycles and greenhouse gas emissions:",
      "Opportunities in a rapidly growing housing stock",
      "Author One",
    ];
    const t = extractTitle(lines);
    expect(t).toContain("Tradeoffs and synergy");
    expect(t).toContain("Opportunities");
    expect(t).toContain("housing stock");
  });

  it("merges a question-titled paper with its descriptive subtitle", () => {
    const lines = [
      "How Fast Should a Model Commit to Supervision?",
      "Training Reasoning Models on the Tsallis Loss Continuum",
      "Author One, Author Two",
    ];
    const t = extractTitle(lines);
    expect(t).toContain("Supervision?");
    expect(t).toContain("Tsallis Loss");
  });

  it("rejects journal-name banner that spans two PDF lines", () => {
    const lines = [
      "Research Article",
      "International Journal of",
      "Architectural Computing",
      "2025, Vol. 23(1) 5–26",
      "Designing with sense: A critical review",
      "and proposal for enhanced design",
      "space exploration in generative",
      "design",
    ];
    const t = extractTitle(lines);
    expect(t).toContain("Designing with sense");
  });

  it("merges three-line wrapped titles", () => {
    const lines = [
      "Teacher Forcing as Generalized Bayes: Optimization Geometry",
      "Mismatch in Switching Surrogates",
      "for Chaotic Dynamics",
      "Author One",
    ];
    const t = extractTitle(lines);
    expect(t).toContain("Teacher Forcing");
    expect(t).toContain("Switching Surrogates");
    expect(t).toContain("Chaotic Dynamics");
  });

  it("merges arXiv-style 3-line title (LSTF-AD case)", () => {
    const lines = [
      "LSTF-AD: Lightweight Sender-Level",
      "Temporal Feature Anomaly Detection for",
      "VANET Message Streams",
      "Anonymous Authors",
      "Abstract",
    ];
    const t = extractTitle(lines);
    expect(t).toContain("LSTF-AD");
    expect(t).toContain("Temporal Feature Anomaly Detection");
    expect(t).toContain("VANET Message Streams");
  });

  it("strips trailing PDF line-number digits glued onto title text", () => {
    // Some extractors produce "Sender-Level1" / "Streams2" because the
    // page-margin line number was concatenated to the heading. Without the
    // strip the digit becomes part of the title and breaks the merge to
    // the second line (Sender-Level1 looks like an author footnote and
    // shouldMergeTitleContinuation refuses).
    const lines = [
      "LSTF-AD: Lightweight Sender-Level1",
      "Temporal Feature Anomaly Detection for2",
      "VANET Message Streams3",
      "Anonymous Authors4",
      "Abstract",
    ];
    const t = extractTitle(lines);
    expect(t).toBe("LSTF-AD: Lightweight Sender-Level Temporal Feature Anomaly Detection for VANET Message Streams");
  });

  it("does NOT merge when both lines are independent questions", () => {
    const lines = [
      "Are Large Language Models Conscious?",
      "Do Neural Networks Dream?",
    ];
    const t = extractTitle(lines);
    expect(t).toBe("Are Large Language Models Conscious?");
  });
});
