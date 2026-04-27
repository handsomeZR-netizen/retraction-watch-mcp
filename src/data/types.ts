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
