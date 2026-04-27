import { randomUUID } from "node:crypto";
import { DEFAULT_LIMIT, MAX_LIMIT, POLICY_VERSION } from "../config.js";
import { RetractionWatchRepository } from "../data/repository.js";
import type {
  MatchCandidate,
  MatchEvidence,
  MatchVerdict,
  RwRecord,
  ScreenPersonInput,
  ScreenPersonResult,
} from "../data/types.js";
import {
  domainTokens,
  isPublicEmailDomain,
  normalizeDoi,
  normalizeEmailDomain,
  normalizeName,
  normalizePmid,
  significantInstitutionTokens,
  splitSemicolonList,
  tokenOverlapScore,
} from "./normalize.js";

interface ScoreContext {
  evidence: MatchEvidence[];
  matchedFields: Set<string>;
  hasHardIdentifier: boolean;
  hasNameEvidence: boolean;
  hasAuxiliaryEvidence: boolean;
}

export async function screenPerson(
  repository: RetractionWatchRepository,
  input: ScreenPersonInput,
): Promise<ScreenPersonResult> {
  const queryId = randomUUID();
  const limit = clampLimit(input.limit);
  const noticeTypes = normalizeNoticeTypes(input.include_notice_types);
  const candidateRecords = repository.findCandidateRecords(input, noticeTypes, limit);
  const scoredCandidates = candidateRecords
    .map((record) => scoreCandidate(record, input))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.record.recordId.localeCompare(right.record.recordId));

  const candidates = scoredCandidates
    .filter((candidate) => candidate.verdict !== "no_match")
    .slice(0, limit);
  const nearMisses = scoredCandidates
    .filter(
      (candidate) =>
        candidate.verdict === "no_match" &&
        (candidate.matchedFields.includes("name") ||
          candidate.matchedFields.includes("doi") ||
          candidate.matchedFields.includes("pmid")),
    )
    .slice(0, Math.min(limit, 10));

  const best = candidates[0] ?? null;
  const identityConfirmed = best?.verdict === "confirmed";
  const warnings = buildWarnings(input, identityConfirmed, nearMisses.length);
  const manualReviewReasonCodes = buildManualReviewReasonCodes(best, nearMisses.length, input);

  return {
    queryId,
    verdict: best?.verdict ?? "no_match",
    identityConfirmed,
    reviewRequired: best?.reviewRequired ?? nearMisses.length > 0,
    score: best?.score ?? 0,
    matchedFields: best?.matchedFields ?? [],
    evidence: best?.evidence ?? [],
    candidates,
    nearMisses,
    warnings,
    manualReviewReasonCodes,
    inputDiagnostics: buildInputDiagnostics(input, candidates, nearMisses),
    sourceVersion: repository.getSourceSnapshot(),
    policyVersion: POLICY_VERSION,
  };
}

export function scoreCandidate(record: RwRecord, input: ScreenPersonInput): MatchCandidate {
  const context: ScoreContext = {
    evidence: [],
    matchedFields: new Set<string>(),
    hasHardIdentifier: false,
    hasNameEvidence: false,
    hasAuxiliaryEvidence: false,
  };

  let score = 0;
  score += scoreIdentifiers(record, input, context);
  score += scoreName(record, input.name, context);
  score += scoreInstitution(record, input.institution, context);
  score += scoreEmailDomain(record, input.email, context);

  const finalScore = Math.max(0, Math.min(1, Number(score.toFixed(3))));
  const verdict = classify(finalScore, context);

  return {
    record,
    score: finalScore,
    verdict,
    reviewRequired: verdict !== "confirmed",
    matchedFields: [...context.matchedFields],
    evidence: context.evidence,
  };
}

function scoreIdentifiers(record: RwRecord, input: ScreenPersonInput, context: ScoreContext): number {
  let score = 0;
  const queryDoi = normalizeDoi(input.doi);
  const queryPmid = normalizePmid(input.pmid);

  if (
    queryDoi &&
    (queryDoi === normalizeDoi(record.originalPaperDoi) || queryDoi === normalizeDoi(record.retractionDoi))
  ) {
    score += addEvidence(context, {
      field: "doi",
      strength: "strong",
      message: "DOI exactly matches the original paper DOI or retraction notice DOI.",
      scoreDelta: 1,
    });
    context.hasHardIdentifier = true;
    context.matchedFields.add("doi");
  }

  if (
    queryPmid &&
    (queryPmid === normalizePmid(record.originalPaperPubMedId) ||
      queryPmid === normalizePmid(record.retractionPubMedId))
  ) {
    score += addEvidence(context, {
      field: "pmid",
      strength: "strong",
      message: "PubMed ID exactly matches the original paper PMID or retraction notice PMID.",
      scoreDelta: 1,
    });
    context.hasHardIdentifier = true;
    context.matchedFields.add("pmid");
  }

  return Math.min(score, 1);
}

function scoreName(record: RwRecord, name: string, context: ScoreContext): number {
  const queryName = normalizeName(name);
  if (!queryName.normalized) {
    return 0;
  }

  const authors = splitSemicolonList(record.author).map((author) => normalizeName(author));
  for (const author of authors) {
    if (author.normalized === queryName.normalized) {
      context.hasNameEvidence = true;
      context.matchedFields.add("name");
      return addEvidence(context, {
        field: "name",
        strength: "medium",
        message: `Author name exactly matches "${author.original}".`,
        scoreDelta: 0.48,
      });
    }

    if (queryName.variants.includes(author.normalized) || author.variants.includes(queryName.normalized)) {
      context.hasNameEvidence = true;
      context.matchedFields.add("name");
      return addEvidence(context, {
        field: "name",
        strength: "medium",
        message: `Author name matches a normalized name-order variant of "${author.original}".`,
        scoreDelta: 0.42,
      });
    }

    if (author.signature && author.signature === queryName.signature) {
      context.hasNameEvidence = true;
      context.matchedFields.add("name");
      return addEvidence(context, {
        field: "name",
        strength: "medium",
        message: `Author surname and initials match "${author.original}".`,
        scoreDelta: 0.35,
      });
    }

    if (
      author.surname &&
      author.surname === queryName.surname &&
      author.initials[0] &&
      author.initials[0] === queryName.initials[0]
    ) {
      context.hasNameEvidence = true;
      context.matchedFields.add("name");
      return addEvidence(context, {
        field: "name",
        strength: "weak",
        message: `Author surname and first initial match "${author.original}".`,
        scoreDelta: 0.25,
      });
    }
  }

  return 0;
}

function scoreInstitution(
  record: RwRecord,
  institution: string | undefined,
  context: ScoreContext,
): number {
  if (!institution?.trim()) {
    return 0;
  }

  const queryTokens = significantInstitutionTokens(institution);
  if (queryTokens.size === 0) {
    return 0;
  }

  let bestOverlap = 0;
  let bestInstitution = "";
  for (const candidate of splitSemicolonList(record.institution)) {
    const overlap = tokenOverlapScore(queryTokens, significantInstitutionTokens(candidate));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestInstitution = candidate;
    }
  }

  if (bestOverlap >= 0.75) {
    context.hasAuxiliaryEvidence = true;
    context.matchedFields.add("institution");
    return addEvidence(context, {
      field: "institution",
      strength: "medium",
      message: `Institution has high token overlap with "${bestInstitution}".`,
      scoreDelta: 0.24,
    });
  }

  if (bestOverlap >= 0.45) {
    context.hasAuxiliaryEvidence = true;
    context.matchedFields.add("institution");
    return addEvidence(context, {
      field: "institution",
      strength: "weak",
      message: `Institution partially overlaps with "${bestInstitution}".`,
      scoreDelta: 0.14,
    });
  }

  if (context.hasNameEvidence && splitSemicolonList(record.institution).length > 0) {
    return addEvidence(context, {
      field: "institution",
      strength: "negative",
      message: "A name-like match was found, but the provided institution does not overlap with listed affiliations.",
      scoreDelta: -0.2,
    });
  }

  return 0;
}

function scoreEmailDomain(record: RwRecord, email: string | undefined, context: ScoreContext): number {
  const domain = normalizeEmailDomain(email);
  if (!domain) {
    if (email?.trim()) {
      addEvidence(context, {
        field: "email_domain",
        strength: "info",
        message: "An email value was provided, but no valid domain could be extracted.",
        scoreDelta: 0,
      });
    }
    return 0;
  }

  if (isPublicEmailDomain(domain)) {
    addEvidence(context, {
      field: "email_domain",
      strength: "info",
      message: `Email domain "${domain}" is a public provider and is not used as positive evidence.`,
      scoreDelta: 0,
    });
    return 0;
  }

  const queryTokens = domainTokens(domain);
  let bestOverlap = 0;
  for (const candidate of splitSemicolonList(record.institution)) {
    bestOverlap = Math.max(bestOverlap, tokenOverlapScore(queryTokens, significantInstitutionTokens(candidate)));
  }

  if (bestOverlap >= 0.65) {
    context.hasAuxiliaryEvidence = true;
    context.matchedFields.add("email_domain");
    return addEvidence(context, {
      field: "email_domain",
      strength: "weak",
      message: `Email domain "${domain}" overlaps with listed affiliation tokens.`,
      scoreDelta: 0.1,
    });
  }

  addEvidence(context, {
    field: "email_domain",
    strength: "info",
    message: `Email domain "${domain}" was checked as domain-only evidence, but it did not overlap enough with listed affiliations to affect the score.`,
    scoreDelta: 0,
  });
  return 0;
}

function classify(score: number, context: ScoreContext): MatchVerdict {
  if (context.hasHardIdentifier) {
    return "confirmed";
  }
  if (score >= 0.7 && context.hasNameEvidence && context.hasAuxiliaryEvidence) {
    return "likely_match";
  }
  if (score >= 0.35 && context.hasNameEvidence) {
    return "possible_match";
  }
  return "no_match";
}

function addEvidence(context: ScoreContext, evidence: MatchEvidence): number {
  context.evidence.push(evidence);
  return evidence.scoreDelta;
}

function normalizeNoticeTypes(noticeTypes: string[] | undefined): string[] {
  if (!noticeTypes || noticeTypes.length === 0) {
    return [];
  }
  return [...new Set(noticeTypes.map((type) => type.trim()).filter(Boolean))];
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}

function buildInputDiagnostics(
  input: ScreenPersonInput,
  candidates: MatchCandidate[],
  nearMisses: MatchCandidate[],
) {
  const emailDomain = normalizeEmailDomain(input.email);
  const allCandidates = [...candidates, ...nearMisses];

  return {
    emailProvided: Boolean(input.email?.trim()),
    emailDomain: emailDomain || null,
    emailDomainPublic: emailDomain ? isPublicEmailDomain(emailDomain) : null,
    emailUsedAsDomainOnly: Boolean(input.email?.trim()),
    emailContributedToScore: allCandidates.some((candidate) =>
      candidate.matchedFields.includes("email_domain"),
    ),
    authorAffiliationMappingAvailable: false as const,
  };
}

function buildWarnings(
  input: ScreenPersonInput,
  identityConfirmed: boolean,
  nearMissCount: number,
): string[] {
  const warnings = [
    "Retraction Watch data links notices/publications to author-name strings; it does not by itself prove personal misconduct.",
    "The public Retraction Watch CSV does not provide author-to-affiliation mapping, so institution evidence is auxiliary only.",
  ];

  if (!identityConfirmed) {
    warnings.push("This result is not an identity confirmation and should be manually reviewed before any consequential use.");
  }
  if (input.email?.trim()) {
    warnings.push("The public Retraction Watch data has no email field; email is reduced to domain-only weak evidence.");
  }
  if (nearMissCount > 0) {
    warnings.push("Some records had weak or conflicting evidence and are returned as nearMisses rather than matches.");
  }

  return warnings;
}

function buildManualReviewReasonCodes(
  best: MatchCandidate | null,
  nearMissCount: number,
  input: ScreenPersonInput,
): string[] {
  const codes = new Set<string>();

  if (!best || best.verdict !== "confirmed") {
    codes.add("NON_CONFIRMED_IDENTITY");
  }
  codes.add("AUTHOR_AFFILIATION_MAPPING_UNAVAILABLE");
  if (input.email?.trim()) {
    codes.add("EMAIL_DOMAIN_ONLY");
  }
  if (nearMissCount > 0) {
    codes.add("NEAR_MISSES_PRESENT");
  }
  if (best?.reviewRequired) {
    codes.add("MANUAL_REVIEW_REQUIRED");
  }

  return [...codes];
}
