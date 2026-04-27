import { describe, expect, it } from "vitest";
import type { RwRecord, ScreenPersonInput } from "../data/types.js";
import { screenPerson, scoreCandidate } from "./matcher.js";

const baseRecord: RwRecord = {
  recordId: "1",
  title: "Example retracted article",
  subject: "",
  institution:
    "Department of Civil Engineering, COMSATS University Islamabad, Wah Campus, Pakistan; School of Engineering, Example University;",
  journal: "Example Journal",
  publisher: "Example Publisher",
  country: "Pakistan",
  author: "Ahsen Maqsoom;Bilal Aslam",
  urls: "",
  articleType: "Research Article",
  retractionDate: "1/21/2026 0:00",
  retractionDoi: "10.1000/retraction",
  retractionPubMedId: "",
  originalPaperDate: "2/2/2022 0:00",
  originalPaperDoi: "10.1000/original",
  originalPaperPubMedId: "123456",
  retractionNature: "Retraction",
  reason: "Compromised Peer Review;",
  paywalled: "No",
  notes: "",
};

describe("matcher", () => {
  it("confirms exact DOI matches", () => {
    const candidate = scoreCandidate(baseRecord, {
      name: "Different Person",
      doi: "https://doi.org/10.1000/original",
    });

    expect(candidate.verdict).toBe("confirmed");
    expect(candidate.reviewRequired).toBe(false);
    expect(candidate.matchedFields).toContain("doi");
  });

  it("returns likely match for exact name plus institution evidence", () => {
    const candidate = scoreCandidate(baseRecord, {
      name: "Ahsen Maqsoom",
      institution: "COMSATS University Islamabad",
    });

    expect(candidate.verdict).toBe("likely_match");
    expect(candidate.reviewRequired).toBe(true);
    expect(candidate.matchedFields).toEqual(expect.arrayContaining(["name", "institution"]));
  });

  it("keeps exact name only as possible match", () => {
    const candidate = scoreCandidate(baseRecord, {
      name: "Ahsen Maqsoom",
    });

    expect(candidate.verdict).toBe("possible_match");
    expect(candidate.reviewRequired).toBe(true);
  });

  it("penalizes institution conflict", () => {
    const candidate = scoreCandidate(baseRecord, {
      name: "Ahsen Maqsoom",
      institution: "University of Barcelona",
    });

    expect(candidate.verdict).toBe("no_match");
    expect(candidate.score).toBeLessThan(0.48);
  });

  it("does not use public email domain as positive evidence", () => {
    const input: ScreenPersonInput = {
      name: "Ahsen Maqsoom",
      email: "ahsen@gmail.com",
    };
    const candidate = scoreCandidate(baseRecord, input);

    expect(candidate.verdict).toBe("possible_match");
    expect(candidate.matchedFields).not.toContain("email_domain");
    expect(candidate.evidence.some((item) => item.field === "email_domain" && item.strength === "info")).toBe(true);
  });

  it("screening output separates rejected no_match candidates as near misses", async () => {
    const repository = {
      findCandidateRecords: () => [baseRecord],
      getSourceSnapshot: () => null,
    };

    const result = await screenPerson(repository as never, {
      name: "Ahsen Maqsoom",
      institution: "University of Barcelona",
    });

    expect(result.verdict).toBe("no_match");
    expect(result.candidates).toHaveLength(0);
    expect(result.nearMisses).toHaveLength(1);
    expect(result.reviewRequired).toBe(true);
    expect(result.manualReviewReasonCodes).toContain("NEAR_MISSES_PRESENT");
  });
});
