import { describe, expect, it } from "vitest";
import type { RwRecord, ScreenPersonInput } from "../data/types.js";
import { BALANCED_POLICY, CONSEQUENTIAL_USE_WARNING, STRICT_POLICY } from "../policy.js";
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

function recordWith(overrides: Partial<RwRecord>): RwRecord {
  return { ...baseRecord, ...overrides };
}

describe("matcher", () => {
  it("confirms exact DOI when the queried name also matches an author", () => {
    const candidate = scoreCandidate(baseRecord, {
      name: "Ahsen Maqsoom",
      doi: "https://doi.org/10.1000/original",
    });

    expect(candidate.verdict).toBe("confirmed");
    expect(candidate.reviewRequired).toBe(false);
    expect(candidate.matchedFields).toEqual(expect.arrayContaining(["doi", "name"]));
  });

  it("does NOT confirm a DOI hit when the queried name is not an author of the record", () => {
    const candidate = scoreCandidate(baseRecord, {
      name: "Different Person",
      doi: "https://doi.org/10.1000/original",
    });

    // The paper IS retracted (DOI matches), but the queried person is not on
    // the record's author list, so we must not call this an identity hit.
    expect(candidate.verdict).not.toBe("confirmed");
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

  it("rejects same-surname initial collisions when full given names differ", () => {
    const cases = [
      {
        recordAuthor: "Mei Xu",
        recordInstitution: "Wuhan University of Engineering Science",
        queryName: "Miao Xu",
        queryInstitution: "Beihua University, civil engineering",
      },
      {
        recordAuthor: "Ling Zhang",
        recordInstitution: "Wuhan Central Hospital",
        queryName: "Lizeng Zhang",
        queryInstitution: "Haomo.AI",
      },
    ];

    for (const item of cases) {
      const record = recordWith({
        recordId: `collision-${item.recordAuthor}`,
        author: item.recordAuthor,
        institution: item.recordInstitution,
      });

      const withInstitution = scoreCandidate(record, {
        name: item.queryName,
        institution: item.queryInstitution,
      });
      expect(withInstitution.verdict).toBe("no_match");
      expect(withInstitution.score).toBeLessThan(BALANCED_POLICY.thresholds.possibleMatch);
      expect(withInstitution.matchedFields).not.toContain("name");

      const withoutCorroboration = scoreCandidate(record, {
        name: item.queryName,
      });
      expect(withoutCorroboration.verdict).toBe("no_match");
      expect(withoutCorroboration.score).toBeLessThan(BALANCED_POLICY.thresholds.possibleMatch);
      expect(withoutCorroboration.matchedFields).not.toContain("name");
    }
  });

  it("does not turn full-given-name collisions into review-triggering near misses", async () => {
    const record = recordWith({
      author: "Mei Xu",
      institution: "Wuhan University of Engineering Science",
    });
    const repository = {
      findCandidateRecords: () => [record],
      getSourceSnapshot: () => null,
    };

    const result = await screenPerson(repository as never, {
      name: "Miao Xu",
      institution: "Beihua University, civil engineering",
    });

    expect(result.verdict).toBe("no_match");
    expect(result.reviewRequired).toBe(false);
    expect(result.candidates).toHaveLength(0);
    expect(result.nearMisses).toHaveLength(0);
  });

  it("still treats initial-only author abbreviations as soft name evidence", () => {
    const record = recordWith({ author: "Wei Zhang" });
    const candidate = scoreCandidate(record, { name: "Zhang W" });

    expect(candidate.verdict).toBe("possible_match");
    expect(candidate.matchedFields).toContain("name");
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

  it("includes cautious summary fields for downstream LLM use", async () => {
    const repository = {
      findCandidateRecords: () => [baseRecord],
      getSourceSnapshot: () => null,
    };

    const result = await screenPerson(repository as never, {
      name: "Ahsen Maqsoom",
    });

    expect(result.consequentialUseWarning).toBe(CONSEQUENTIAL_USE_WARNING);
    expect(result.safeSummary).toContain("not an identity confirmation");
  });

  it("strict policy demotes non-identifier matches to near misses", async () => {
    const repository = {
      findCandidateRecords: () => [baseRecord],
      getSourceSnapshot: () => null,
    };

    const result = await screenPerson(
      repository as never,
      {
        name: "Ahsen Maqsoom",
        institution: "COMSATS University Islamabad",
      },
      STRICT_POLICY,
    );

    expect(result.verdict).toBe("no_match");
    expect(result.candidates).toHaveLength(0);
    expect(result.nearMisses).toHaveLength(1);
    expect(result.policyVersion).toBe(STRICT_POLICY.policyVersion);
  });
});
