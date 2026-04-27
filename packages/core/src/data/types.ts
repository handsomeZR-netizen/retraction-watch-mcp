export type RetractionNature =
  | "Retraction"
  | "Correction"
  | "Expression of concern"
  | "Reinstatement"
  | "";

export interface RawRwRecord {
  "Record ID": string;
  Title: string;
  Subject: string;
  Institution: string;
  Journal: string;
  Publisher: string;
  Country: string;
  Author: string;
  URLS: string;
  ArticleType: string;
  RetractionDate: string;
  RetractionDOI: string;
  RetractionPubMedID: string;
  OriginalPaperDate: string;
  OriginalPaperDOI: string;
  OriginalPaperPubMedID: string;
  RetractionNature: string;
  Reason: string;
  Paywalled: string;
  Notes: string;
  [key: string]: string;
}

export interface RwRecord {
  recordId: string;
  title: string;
  subject: string;
  institution: string;
  journal: string;
  publisher: string;
  country: string;
  author: string;
  urls: string;
  articleType: string;
  retractionDate: string;
  retractionDoi: string;
  retractionPubMedId: string;
  originalPaperDate: string;
  originalPaperDoi: string;
  originalPaperPubMedId: string;
  retractionNature: RetractionNature | string;
  reason: string;
  paywalled: string;
  notes: string;
  rawJson?: string;
}

export interface SourceSnapshot {
  importedAt: string;
  csvUrl: string;
  readmeUrl: string;
  csvSha256: string;
  csvBytes: number;
  generatedOn: string | null;
  sourceCommit: string | null;
  rowCount: number;
  policyVersion: string;
}

export interface ScreenPersonInput {
  name: string;
  email?: string;
  institution?: string;
  doi?: string;
  pmid?: string;
  include_notice_types?: string[];
  limit?: number;
  strict_mode?: boolean;
}

export type MatchVerdict =
  | "confirmed"
  | "likely_match"
  | "possible_match"
  | "no_match";

export interface MatchEvidence {
  field: string;
  strength: "strong" | "medium" | "weak" | "negative" | "info";
  message: string;
  scoreDelta: number;
}

export interface MatchCandidate {
  record: RwRecord;
  score: number;
  verdict: MatchVerdict;
  reviewRequired: boolean;
  matchedFields: string[];
  evidence: MatchEvidence[];
}

export interface ScreenInputDiagnostics {
  emailProvided: boolean;
  emailDomain: string | null;
  emailDomainPublic: boolean | null;
  emailUsedAsDomainOnly: boolean;
  emailContributedToScore: boolean;
  authorAffiliationMappingAvailable: false;
}

export interface ScreenPersonResult {
  queryId: string;
  verdict: MatchVerdict;
  identityConfirmed: boolean;
  reviewRequired: boolean;
  consequentialUseWarning: string;
  safeSummary: string;
  score: number;
  matchedFields: string[];
  evidence: MatchEvidence[];
  candidates: MatchCandidate[];
  nearMisses: MatchCandidate[];
  warnings: string[];
  manualReviewReasonCodes: string[];
  inputDiagnostics: ScreenInputDiagnostics;
  sourceVersion: SourceSnapshot | null;
  policyVersion: string;
}

export type ReferenceVerdict =
  | "confirmed"
  | "likely_match"
  | "possible_match"
  | "no_match";

export interface ScreenReferenceInput {
  raw?: string;
  title?: string | null;
  authors?: string[];
  year?: number | null;
  doi?: string | null;
  pmid?: string | null;
  journal?: string | null;
}

export interface ReferenceMatchCandidate {
  record: RwRecord;
  score: number;
  titleSimilarity: number;
  verdict: ReferenceVerdict;
  matchedFields: string[];
  evidence: MatchEvidence[];
}

export interface ScreenReferenceResult {
  input: ScreenReferenceInput;
  verdict: ReferenceVerdict;
  score: number;
  reviewRequired: boolean;
  matchedFields: string[];
  evidence: MatchEvidence[];
  bestCandidate: ReferenceMatchCandidate | null;
  candidates: ReferenceMatchCandidate[];
  nearMisses: ReferenceMatchCandidate[];
  policyVersion: string;
}

export interface ManuscriptAuthor {
  name: string;
  email: string | null;
  affiliation: string | null;
  orcid: string | null;
}

export interface ManuscriptMetadata {
  title: string | null;
  authors: ManuscriptAuthor[];
  doi: string | null;
  abstract: string | null;
}

export interface ManuscriptReference {
  raw: string;
  title: string | null;
  authors: string[];
  year: number | null;
  doi: string | null;
  pmid: string | null;
  journal: string | null;
  source: "regex_doi" | "regex_pmid" | "llm" | "bibtex";
}

export interface ScreenedReference {
  reference: ManuscriptReference;
  result: ScreenReferenceResult;
}

export interface AuthorScreenResult {
  author: ManuscriptAuthor;
  verdict: MatchVerdict;
  score: number;
  matchedRecord: RwRecord | null;
  evidence: MatchEvidence[];
  matchedFields: string[];
}

export interface ManuscriptScreenResult {
  manuscriptId: string;
  fileName: string;
  fileType: "pdf" | "docx" | "latex" | "unknown";
  metadata: ManuscriptMetadata;
  screenedReferences: ScreenedReference[];
  screenedAuthors: AuthorScreenResult[];
  verdict: "PASS" | "REVIEW" | "FAIL";
  totals: {
    references: number;
    confirmed: number;
    likely: number;
    possible: number;
    clean: number;
    authorsConfirmed: number;
    authorsLikely: number;
    authorsPossible: number;
  };
  warnings: string[];
  network: {
    deepseekCalls: number;
    crossrefCalls: number;
    cloudOcrCalls: number;
  };
  consequentialUseWarning: string;
  generatedAt: string;
  sourceVersion: SourceSnapshot | null;
  policyVersion: string;
}
