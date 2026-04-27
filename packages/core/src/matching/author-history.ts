import { RetractionWatchRepository } from "../data/repository.js";
import type {
  AuthorScreenResult,
  ManuscriptAuthor,
  RwRecord,
} from "../data/types.js";
import { BALANCED_POLICY, type ScreeningPolicy } from "../policy.js";
import { screenPerson } from "./matcher.js";

export interface ScreenAuthorOptions {
  policy?: ScreeningPolicy;
}

/**
 * Screen a single manuscript author against the Retraction Watch database
 * to detect prior involvement in retractions. Thin wrapper around screenPerson
 * that returns only the strongest match plus its evidence.
 */
export async function screenAuthor(
  repository: RetractionWatchRepository,
  author: ManuscriptAuthor,
  options: ScreenAuthorOptions = {},
): Promise<AuthorScreenResult> {
  const name = author.name?.trim();
  if (!name) {
    return {
      author,
      verdict: "no_match",
      score: 0,
      matchedRecord: null,
      evidence: [],
      matchedFields: [],
    };
  }

  const result = await screenPerson(
    repository,
    {
      name,
      email: author.email ?? undefined,
      institution: author.affiliation ?? undefined,
      limit: 5,
    },
    options.policy ?? BALANCED_POLICY,
  );

  const best = result.candidates[0] ?? null;
  let matchedRecord: RwRecord | null = null;
  if (best && (result.verdict === "confirmed" || result.verdict === "likely_match" || result.verdict === "possible_match")) {
    matchedRecord = best.record;
  }

  return {
    author,
    verdict: result.verdict,
    score: result.score,
    matchedRecord,
    evidence: result.evidence,
    matchedFields: result.matchedFields,
  };
}
