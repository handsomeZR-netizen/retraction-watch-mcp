export { RetractionWatchRepository } from "./data/repository.js";
export { screenPerson, scoreCandidate } from "./matching/matcher.js";
export { screenReference } from "./matching/reference-matcher.js";
export { screenAuthor } from "./matching/author-history.js";
export {
  normalizeText,
  normalizeName,
  normalizeDoi,
  normalizePmid,
  normalizeEmailDomain,
  isPublicEmailDomain,
  normalizeInstitution,
  significantInstitutionTokens,
  tokenOverlapScore,
  domainTokens,
  splitSemicolonList,
  normalizeTitle,
  titleTokens,
  jaccardSimilarity,
  toPinyin,
  isLikelyChinese,
  normalizeNameWithPinyin,
  extractDoi,
  extractYear,
  extractPmid,
  inferFileType,
  DOI_REGEX,
  YEAR_REGEX,
  PMID_REGEX,
  EMAIL_REGEX,
  ORCID_REGEX,
} from "./matching/normalize.js";
export type { FileType, ManuscriptVerdict, IngestStage } from "./matching/normalize.js";
export {
  BALANCED_POLICY,
  STRICT_POLICY,
  CONSEQUENTIAL_USE_WARNING,
  clonePolicy,
  loadPolicy,
  resolvePolicyForInput,
  policyMetadata,
} from "./policy.js";
export type { ScreeningPolicy } from "./policy.js";
export {
  toPublicCandidate,
  toPublicRecord,
  toPublicScreenResult,
  jsonText,
} from "./output.js";
export type {
  RwRecord,
  ScreenPersonInput,
  ScreenPersonResult,
  MatchCandidate,
  MatchEvidence,
  MatchVerdict,
  SourceSnapshot,
  ScreenReferenceInput,
  ScreenReferenceResult,
  ReferenceVerdict,
  ReferenceMatchCandidate,
  ManuscriptAuthor,
  ManuscriptMetadata,
  ManuscriptReference,
  ManuscriptScreenResult,
  ScreenedReference,
  AuthorScreenResult,
  SourceTag,
  FieldProvenance,
  ProvenanceMap,
} from "./data/types.js";
