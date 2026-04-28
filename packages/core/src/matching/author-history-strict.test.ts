import { describe, expect, it } from "vitest";
import type { RwRecord } from "../data/types.js";
import { screenAuthor } from "./author-history.js";

const wangRecord: RwRecord = {
  recordId: "wang-1",
  title: "Retracted study with overlapping data",
  subject: "",
  institution: "School of Engineering, Other University",
  journal: "Some Journal",
  publisher: "",
  country: "USA",
  author: "Jian Wang;Other Author",
  urls: "",
  articleType: "Research Article",
  retractionDate: "1/1/2024 0:00",
  retractionDoi: "",
  retractionPubMedId: "",
  originalPaperDate: "1/1/2022 0:00",
  originalPaperDoi: "",
  originalPaperPubMedId: "",
  retractionNature: "Retraction",
  reason: "Data fabrication",
  paywalled: "No",
  notes: "",
};

const repoFor = (records: RwRecord[]) =>
  ({
    findCandidateRecords: () => records,
    getRecordsByDoi: () => [],
    getRecordsByPmid: () => [],
    getSourceSnapshot: () => null,
  }) as never;

describe("screenAuthor strictness", () => {
  it("does NOT confirm on a name-only match (no institution/email/orcid)", async () => {
    const result = await screenAuthor(repoFor([wangRecord]), {
      name: "Jian Wang",
      affiliation: null,
      email: null,
      orcid: null,
    });
    expect(result.verdict).not.toBe("confirmed");
  });

  it("returns no_match for a stopword-only 'name' like 'China'", async () => {
    const result = await screenAuthor(repoFor([wangRecord]), {
      name: "China",
      affiliation: null,
      email: null,
      orcid: null,
    });
    expect(result.verdict).toBe("no_match");
  });

  it("returns no_match for a too-short name", async () => {
    const result = await screenAuthor(repoFor([wangRecord]), {
      name: "AI",
      affiliation: null,
      email: null,
      orcid: null,
    });
    expect(result.verdict).toBe("no_match");
  });

  it("returns no_match when the candidate set has no records", async () => {
    const result = await screenAuthor(repoFor([]), {
      name: "Mei Liu",
      affiliation: "Some University",
      email: null,
      orcid: null,
    });
    expect(result.verdict).toBe("no_match");
  });
});
