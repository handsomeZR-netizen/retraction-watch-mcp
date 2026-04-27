import { describe, expect, it } from "vitest";
import type { RwRecord } from "../data/types.js";
import { screenAuthor } from "./author-history.js";

const sampleRecord: RwRecord = {
  recordId: "rec-1",
  title: "Retracted study on protein folding",
  subject: "",
  institution: "Department of Biology, Tsinghua University",
  journal: "Journal of Examples",
  publisher: "Example Press",
  country: "China",
  author: "Wei Zhang;Mei Liu",
  urls: "",
  articleType: "Research Article",
  retractionDate: "3/1/2024 0:00",
  retractionDoi: "10.1000/retract-author",
  retractionPubMedId: "",
  originalPaperDate: "5/3/2022 0:00",
  originalPaperDoi: "10.1000/orig-author",
  originalPaperPubMedId: "",
  retractionNature: "Retraction",
  reason: "Data fabrication",
  paywalled: "No",
  notes: "",
};

const repoStub = {
  findCandidateRecords: () => [sampleRecord],
  getRecordsByDoi: () => [],
  getRecordsByPmid: () => [],
  getSourceSnapshot: () => null,
} as never;

describe("screenAuthor", () => {
  it("flags an author that matches a retraction record by name + institution", async () => {
    const result = await screenAuthor(repoStub, {
      name: "Wei Zhang",
      affiliation: "Tsinghua University",
      email: null,
      orcid: null,
    });
    expect(["likely_match", "confirmed", "possible_match"]).toContain(result.verdict);
    expect(result.matchedRecord).not.toBeNull();
    expect(result.matchedRecord?.recordId).toBe("rec-1");
  });

  it("returns no_match for an empty name", async () => {
    const result = await screenAuthor(repoStub, {
      name: "",
      affiliation: null,
      email: null,
      orcid: null,
    });
    expect(result.verdict).toBe("no_match");
    expect(result.matchedRecord).toBeNull();
  });

  it("returns no_match when the candidate set has no relevant records", async () => {
    const emptyRepo = {
      findCandidateRecords: () => [],
      getRecordsByDoi: () => [],
      getRecordsByPmid: () => [],
      getSourceSnapshot: () => null,
    } as never;
    const result = await screenAuthor(emptyRepo, {
      name: "Some Unknown Person",
      affiliation: "Random Lab",
      email: null,
      orcid: null,
    });
    expect(result.verdict).toBe("no_match");
    expect(result.matchedRecord).toBeNull();
  });
});
