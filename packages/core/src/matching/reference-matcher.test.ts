import { describe, expect, it } from "vitest";
import type { RwRecord } from "../data/types.js";
import { screenReference } from "./reference-matcher.js";
import { BALANCED_POLICY, STRICT_POLICY } from "../policy.js";

const baseRecord: RwRecord = {
  recordId: "ref-1",
  title: "A Study of Machine Learning Models for Health Outcomes",
  subject: "",
  institution: "Example University",
  journal: "Journal of Examples",
  publisher: "Example Press",
  country: "USA",
  author: "Wei Zhang;Alice Smith",
  urls: "",
  articleType: "Research Article",
  retractionDate: "2/1/2024 0:00",
  retractionDoi: "10.1000/retract",
  retractionPubMedId: "",
  originalPaperDate: "5/3/2022 0:00",
  originalPaperDoi: "10.1000/orig",
  originalPaperPubMedId: "5550001",
  retractionNature: "Retraction",
  reason: "Compromised peer review",
  paywalled: "No",
  notes: "",
};

const repoStub = {
  findReferenceCandidates: () => [baseRecord],
  getRecordsByDoi: (doi: string) =>
    doi.toLowerCase() === "10.1000/orig" ? [baseRecord] : [],
  getRecordsByPmid: (pmid: string) => (pmid === "5550001" ? [baseRecord] : []),
  getSourceSnapshot: () => null,
};

describe("screenReference", () => {
  it("confirms exact DOI hit", async () => {
    const result = await screenReference(repoStub, {
      raw: "Zhang W, Smith A. (2022). Study of ML. JoE. https://doi.org/10.1000/orig",
      title: "Study of ML",
      authors: ["Zhang W"],
      year: 2022,
      doi: "https://doi.org/10.1000/orig",
    });
    expect(result.verdict).toBe("confirmed");
    expect(result.bestCandidate?.matchedFields).toContain("doi");
  });

  it("returns likely_match for high title similarity + author overlap", async () => {
    const result = await screenReference(repoStub, {
      raw: "",
      title: "A Study of Machine Learning Models for Health Outcomes",
      authors: ["Wei Zhang"],
      year: 2022,
    });
    expect(["likely_match", "possible_match"]).toContain(result.verdict);
    expect(result.matchedFields).toEqual(expect.arrayContaining(["title"]));
  });

  it("returns no_match when there are no matched fields", async () => {
    const result = await screenReference(repoStub, {
      raw: "",
      title: "Completely Unrelated Quantum Physics Title",
      authors: ["John Doe"],
      year: 1999,
    });
    expect(result.verdict).toBe("no_match");
  });

  it("strict policy keeps non-DOI matches out of formal candidates", async () => {
    const result = await screenReference(
      repoStub,
      {
        raw: "",
        title: "A Study of Machine Learning Models for Health Outcomes",
        authors: ["Wei Zhang"],
        year: 2022,
      },
      STRICT_POLICY,
    );
    expect(result.verdict).toBe("no_match");
  });

  it("matches Chinese-author reference back to pinyin record author", async () => {
    const result = await screenReference(
      repoStub,
      {
        raw: "",
        title: "A Study of Machine Learning Models for Health Outcomes",
        authors: ["张伟"],
        year: 2022,
      },
      BALANCED_POLICY,
    );
    expect(result.bestCandidate?.matchedFields).toEqual(
      expect.arrayContaining(["title"]),
    );
  });
});
