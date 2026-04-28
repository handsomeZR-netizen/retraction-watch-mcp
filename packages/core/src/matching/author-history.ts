import { RetractionWatchRepository } from "../data/repository.js";
import type {
  AuthorScreenResult,
  ManuscriptAuthor,
  MatchVerdict,
  RwRecord,
} from "../data/types.js";
import { BALANCED_POLICY, type ScreeningPolicy } from "../policy.js";
import { screenPerson } from "./matcher.js";

export interface ScreenAuthorOptions {
  policy?: ScreeningPolicy;
}

const NAME_STOPWORDS = new Set([
  "china",
  "usa",
  "uk",
  "japan",
  "korea",
  "singapore",
  "beijing",
  "shanghai",
  "tokyo",
  "ltd",
  "inc",
  "corp",
  "co",
  "et al",
]);

function isNameTooWeakForScreening(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3) return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  // Single-token Western name with ≤3 chars is almost certainly noise
  if (tokens.length === 1 && /^[A-Za-z]+$/.test(tokens[0]) && tokens[0].length <= 3)
    return true;
  if (NAME_STOPWORDS.has(trimmed.toLowerCase())) return true;
  return false;
}

/**
 * Screen a single manuscript author against the Retraction Watch database
 * to detect prior involvement in retractions. Thin wrapper around screenPerson
 * that returns only the strongest match plus its evidence.
 *
 * Confirmed verdicts require corroborating evidence (institution / email /
 * orcid match), not just name overlap — name alone is too brittle for the
 * "this author was involved in a retraction" claim.
 */
export async function screenAuthor(
  repository: RetractionWatchRepository,
  author: ManuscriptAuthor,
  options: ScreenAuthorOptions = {},
): Promise<AuthorScreenResult> {
  const name = author.name?.trim();
  if (!name || isNameTooWeakForScreening(name)) {
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
  let verdict: MatchVerdict = result.verdict;
  let matchedRecord: RwRecord | null = null;
  if (best && (verdict === "confirmed" || verdict === "likely_match" || verdict === "possible_match")) {
    matchedRecord = best.record;
    // Downgrade confirmed when there is no corroborating evidence beyond the
    // raw name match. Authors share names — "Jian Wang" is not enough on its
    // own to claim a person was involved in a retraction.
    if (verdict === "confirmed") {
      const fields = new Set(result.matchedFields);
      const corroborated =
        fields.has("institution") ||
        fields.has("email") ||
        fields.has("orcid") ||
        fields.has("doi") ||
        fields.has("pmid");
      if (!corroborated) verdict = "likely_match";
    }
  }

  return {
    author,
    verdict,
    score: result.score,
    matchedRecord,
    evidence: result.evidence,
    matchedFields: result.matchedFields,
  };
}
