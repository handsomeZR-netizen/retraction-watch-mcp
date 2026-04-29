import type { RetractionWatchRepository } from "../data/repository.js";
import type {
  MatchEvidence,
  ReferenceMatchCandidate,
  ReferenceVerdict,
  RwRecord,
  ScreenReferenceInput,
  ScreenReferenceResult,
} from "../data/types.js";
import { BALANCED_POLICY, type ScreeningPolicy } from "../policy.js";
import {
  extractYear,
  hasConflictingFullGivenNames,
  isLikelyChinese,
  jaccardSimilarity,
  normalizeDoi,
  normalizeName,
  normalizePmid,
  normalizeText,
  splitSemicolonList,
  titleTokens,
  toPinyin,
} from "./normalize.js";

const DEFAULT_NOTICE_TYPES: string[] = [];

export interface ScreenReferenceOptions {
  noticeTypes?: string[];
  candidateLimit?: number;
}

export type ReferenceCandidateSource = Pick<
  RetractionWatchRepository,
  "findReferenceCandidates" | "getRecordsByDoi" | "getRecordsByPmid" | "getSourceSnapshot"
>;

export async function screenReference(
  repository: ReferenceCandidateSource,
  input: ScreenReferenceInput,
  basePolicy: ScreeningPolicy = BALANCED_POLICY,
  options: ScreenReferenceOptions = {},
): Promise<ScreenReferenceResult> {
  const policy = basePolicy;
  const noticeTypes = options.noticeTypes ?? DEFAULT_NOTICE_TYPES;
  const rawLimit = options.candidateLimit ?? 25;
  const candidateLimit = Math.max(1, Math.min(200, Math.floor(Number(rawLimit) || 25)));

  const candidates: ReferenceMatchCandidate[] = [];

  if (input.doi) {
    const doiHits = repository.getRecordsByDoi(input.doi, noticeTypes, candidateLimit);
    for (const record of doiHits) {
      candidates.push(scoreReferenceCandidate(record, input, policy, { doiPreMatched: true }));
    }
  }
  if (input.pmid) {
    const pmidHits = repository.getRecordsByPmid(input.pmid, noticeTypes, candidateLimit);
    for (const record of pmidHits) {
      if (candidates.find((c) => c.record.recordId === record.recordId)) continue;
      candidates.push(scoreReferenceCandidate(record, input, policy, { pmidPreMatched: true }));
    }
  }

  if (candidates.length === 0 || candidates[0].verdict !== "confirmed") {
    const fuzzy = repository.findReferenceCandidates(input, noticeTypes, candidateLimit);
    for (const record of fuzzy) {
      if (candidates.find((c) => c.record.recordId === record.recordId)) continue;
      const scored = scoreReferenceCandidate(record, input, policy);
      if (scored.score > 0) candidates.push(scored);
    }
  }

  candidates.sort(
    (a, b) =>
      verdictRank(b.verdict) - verdictRank(a.verdict) ||
      b.score - a.score ||
      a.record.recordId.localeCompare(b.record.recordId),
  );

  const formal = candidates.filter((c) => c.verdict !== "no_match").slice(0, candidateLimit);
  const nearMisses = candidates
    .filter((c) => c.verdict === "no_match" && c.matchedFields.length > 0)
    .slice(0, 5);

  const best = formal[0] ?? null;

  return {
    input,
    verdict: best?.verdict ?? "no_match",
    score: best?.score ?? 0,
    // reviewRequired is true whenever we have anything short of a confirmed
    // best candidate OR there are near-misses worth a human glance.
    reviewRequired: best
      ? best.verdict !== "confirmed"
      : nearMisses.length > 0,
    matchedFields: best?.matchedFields ?? [],
    evidence: best?.evidence ?? [],
    bestCandidate: best,
    candidates: formal,
    nearMisses,
    policyVersion: policy.policyVersion,
  };
}

interface ScoreContext {
  evidence: MatchEvidence[];
  matchedFields: Set<string>;
  hasHardIdentifier: boolean;
}

interface ScoringHints {
  doiPreMatched?: boolean;
  pmidPreMatched?: boolean;
}

function scoreReferenceCandidate(
  record: RwRecord,
  input: ScreenReferenceInput,
  policy: ScreeningPolicy,
  hints: ScoringHints = {},
): ReferenceMatchCandidate {
  const ctx: ScoreContext = {
    evidence: [],
    matchedFields: new Set(),
    hasHardIdentifier: false,
  };

  let score = 0;
  score += scoreDoi(record, input, ctx, policy, hints);
  score += scorePmid(record, input, ctx, policy, hints);
  const titleSimilarity = computeTitleSimilarity(record.title, input.title ?? "");
  score += scoreTitle(record, input, ctx, policy, titleSimilarity);
  score += scoreAuthors(record, input, ctx, policy);
  score += scoreYear(record, input, ctx, policy);
  score += scoreJournal(record, input, ctx, policy);

  const finalScore = Math.max(0, Math.min(1.5, Number(score.toFixed(3))));
  const verdict = classifyReference(finalScore, ctx, titleSimilarity, policy);

  return {
    record,
    score: finalScore,
    titleSimilarity,
    verdict,
    matchedFields: [...ctx.matchedFields],
    evidence: ctx.evidence,
  };
}

function scoreDoi(
  record: RwRecord,
  input: ScreenReferenceInput,
  ctx: ScoreContext,
  policy: ScreeningPolicy,
  hints: ScoringHints,
): number {
  const queryDoi = normalizeDoi(input.doi ?? "");
  if (!queryDoi) return 0;
  const recordDois = [
    normalizeDoi(record.originalPaperDoi),
    normalizeDoi(record.retractionDoi),
  ].filter(Boolean);
  if (recordDois.includes(queryDoi) || hints.doiPreMatched) {
    ctx.hasHardIdentifier = true;
    ctx.matchedFields.add("doi");
    return addEvidence(ctx, {
      field: "doi",
      strength: "strong",
      message: `Reference DOI "${queryDoi}" matches a Retraction Watch record DOI.`,
      scoreDelta: policy.weights.referenceDoiExact,
    });
  }
  return 0;
}

function scorePmid(
  record: RwRecord,
  input: ScreenReferenceInput,
  ctx: ScoreContext,
  policy: ScreeningPolicy,
  hints: ScoringHints,
): number {
  const queryPmid = normalizePmid(input.pmid ?? "");
  if (!queryPmid) return 0;
  const recordPmids = [
    normalizePmid(record.originalPaperPubMedId),
    normalizePmid(record.retractionPubMedId),
  ].filter(Boolean);
  if (recordPmids.includes(queryPmid) || hints.pmidPreMatched) {
    ctx.hasHardIdentifier = true;
    ctx.matchedFields.add("pmid");
    return addEvidence(ctx, {
      field: "pmid",
      strength: "strong",
      message: `Reference PMID "${queryPmid}" matches a Retraction Watch record PMID.`,
      scoreDelta: policy.weights.referencePmidExact,
    });
  }
  return 0;
}

function scoreTitle(
  record: RwRecord,
  input: ScreenReferenceInput,
  ctx: ScoreContext,
  policy: ScreeningPolicy,
  similarity: number,
): number {
  if (!input.title || !record.title) return 0;
  if (similarity >= policy.thresholds.referenceTitleJaccardLikely) {
    ctx.matchedFields.add("title");
    return addEvidence(ctx, {
      field: "title",
      strength: "medium",
      message: `Reference title token Jaccard with record title is ${similarity.toFixed(2)} (high).`,
      scoreDelta: policy.weights.referenceTitleHigh,
    });
  }
  if (similarity >= policy.thresholds.referenceTitleJaccardPossible) {
    ctx.matchedFields.add("title");
    return addEvidence(ctx, {
      field: "title",
      strength: "weak",
      message: `Reference title token Jaccard with record title is ${similarity.toFixed(2)} (partial).`,
      scoreDelta: policy.weights.referenceTitlePartial,
    });
  }
  return 0;
}

function scoreAuthors(
  record: RwRecord,
  input: ScreenReferenceInput,
  ctx: ScoreContext,
  policy: ScreeningPolicy,
): number {
  const refAuthors = (input.authors ?? []).filter(Boolean);
  if (refAuthors.length === 0) return 0;
  const recordAuthors = splitSemicolonList(record.author);
  if (recordAuthors.length === 0) return 0;

  const refNorm = refAuthors.map((a) => normalizeName(a));
  const recordNorm = recordAuthors.map((a) => normalizeName(a));

  let bestEvidence: { strength: "medium" | "weak"; message: string; weight: number } | null = null;

  for (const ref of refNorm) {
    for (const rec of recordNorm) {
      const exactMatch =
        ref.normalized && rec.normalized && ref.normalized === rec.normalized;
      const fullGivenConflict = hasConflictingFullGivenNames(ref, rec);
      const variantMatch =
        !fullGivenConflict &&
        (ref.variants.some((v) => rec.variants.includes(v)) ||
          (Boolean(ref.signature) && Boolean(rec.signature) && ref.signature === rec.signature));
      if (exactMatch || variantMatch) {
        const weight = policy.weights.referenceAuthorOverlap;
        const message = `Reference author "${ref.original}" matches record author "${rec.original}".`;
        if (!bestEvidence || weight > bestEvidence.weight) {
          bestEvidence = { strength: "medium", message, weight };
        }
        continue;
      }
      const surnameMatch =
        ref.surname &&
        rec.surname &&
        ref.surname === rec.surname &&
        ref.initials &&
        rec.initials &&
        ref.initials[0] === rec.initials[0];
      if (surnameMatch && !fullGivenConflict) {
        const weight = policy.weights.referenceAuthorSurnameOnly;
        const message = `Reference author "${ref.original}" shares surname and first initial with record author "${rec.original}".`;
        if (!bestEvidence || weight > bestEvidence.weight) {
          bestEvidence = { strength: "weak", message, weight };
        }
      }
    }
  }

  if (!bestEvidence) return 0;
  ctx.matchedFields.add("authors");
  return addEvidence(ctx, {
    field: "authors",
    strength: bestEvidence.strength,
    message: bestEvidence.message,
    scoreDelta: bestEvidence.weight,
  });
}

function scoreYear(
  record: RwRecord,
  input: ScreenReferenceInput,
  ctx: ScoreContext,
  policy: ScreeningPolicy,
): number {
  if (!input.year || !Number.isFinite(input.year)) return 0;
  const recordYear = extractYear(record.originalPaperDate) ?? extractYear(record.retractionDate);
  if (!recordYear) return 0;
  const diff = Math.abs(recordYear - Number(input.year));
  if (diff <= 1) {
    ctx.matchedFields.add("year");
    return addEvidence(ctx, {
      field: "year",
      strength: "weak",
      message: `Reference year ${input.year} is within ±1 of record year ${recordYear}.`,
      scoreDelta: policy.weights.referenceYearMatch,
    });
  }
  if (diff >= 4) {
    return addEvidence(ctx, {
      field: "year",
      strength: "negative",
      message: `Reference year ${input.year} differs from record year ${recordYear} by ${diff}.`,
      scoreDelta: policy.weights.referenceYearConflictPenalty,
    });
  }
  return 0;
}

function scoreJournal(
  record: RwRecord,
  input: ScreenReferenceInput,
  ctx: ScoreContext,
  policy: ScreeningPolicy,
): number {
  if (!input.journal || !record.journal) return 0;
  const ref = normalizeText(input.journal);
  const rec = normalizeText(record.journal);
  if (!ref || !rec) return 0;
  if (ref === rec || rec.includes(ref) || ref.includes(rec)) {
    ctx.matchedFields.add("journal");
    return addEvidence(ctx, {
      field: "journal",
      strength: "weak",
      message: `Reference journal "${input.journal}" matches record journal "${record.journal}".`,
      scoreDelta: policy.weights.referenceJournalMatch,
    });
  }
  return 0;
}

function classifyReference(
  score: number,
  ctx: ScoreContext,
  similarity: number,
  policy: ScreeningPolicy,
): ReferenceVerdict {
  if (ctx.hasHardIdentifier) return "confirmed";
  if (policy.safety.hardIdentifiersOnly) return "no_match";
  if (
    score >= policy.thresholds.referenceLikely &&
    similarity >= policy.thresholds.referenceTitleJaccardLikely &&
    ctx.matchedFields.has("authors")
  ) {
    return "likely_match";
  }
  if (
    score >= policy.thresholds.referencePossible &&
    similarity >= policy.thresholds.referenceTitleJaccardPossible
  ) {
    return "possible_match";
  }
  return "no_match";
}

function verdictRank(verdict: ReferenceVerdict): number {
  switch (verdict) {
    case "confirmed":
      return 3;
    case "likely_match":
      return 2;
    case "possible_match":
      return 1;
    default:
      return 0;
  }
}

function addEvidence(ctx: ScoreContext, evidence: MatchEvidence): number {
  ctx.evidence.push(evidence);
  return evidence.scoreDelta;
}

function computeTitleSimilarity(recordTitle: string, refTitle: string): number {
  if (!refTitle || !recordTitle) return 0;
  const refIsChinese = isLikelyChinese(refTitle);
  const recordIsChinese = isLikelyChinese(recordTitle);
  if (refIsChinese !== recordIsChinese) {
    if (refIsChinese) {
      const refPinyin = toPinyin(refTitle);
      if (refPinyin) {
        return jaccardSimilarity(titleTokens(refPinyin), titleTokens(recordTitle));
      }
    }
  }
  return jaccardSimilarity(titleTokens(refTitle), titleTokens(recordTitle));
}

