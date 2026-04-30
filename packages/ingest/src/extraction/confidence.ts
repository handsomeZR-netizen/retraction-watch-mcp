import type {
  FieldProvenance,
  ProvenanceMap,
  SourceTag,
} from "@rw/core/types";
import type { StructuredReference } from "../types.js";

/**
 * Confidence tiers from the LLM-enrichment plan:
 *   DOI/PMID regex hit          → 1.0
 *   bibtex full (author+year+title) → 0.9
 *   regex_text with title+year  → 0.6
 *   raw text only               → 0.2
 *
 * DOI/PMID confidence is treated as 1.0 whenever the field is present in the
 * structured reference, because both the regex extractor and the
 * `validateLlmExtraction` guardrail verify textual presence before the value
 * lands here.
 */
export type ReferenceTier = "doi_or_pmid" | "bibtex_full" | "title_year" | "raw_only";

export const TIER_CONFIDENCE: Record<ReferenceTier, number> = {
  doi_or_pmid: 1.0,
  bibtex_full: 0.9,
  title_year: 0.6,
  raw_only: 0.2,
};

export function classifyReferenceTier(
  ref: Pick<StructuredReference, "title" | "authors" | "year" | "doi" | "pmid" | "source">,
): ReferenceTier {
  if (ref.doi || ref.pmid) return "doi_or_pmid";
  if (ref.source === "bibtex" && ref.authors.length > 0 && ref.year != null && !!ref.title) {
    return "bibtex_full";
  }
  if (ref.title && ref.year != null) return "title_year";
  return "raw_only";
}

export function tierConfidence(tier: ReferenceTier): number {
  return TIER_CONFIDENCE[tier];
}

type Field = keyof ProvenanceMap;

export function localFieldConfidence(
  field: Field,
  ref: StructuredReference,
  source: SourceTag,
): number {
  if (field === "doi" && ref.doi) return 1.0;
  if (field === "pmid" && ref.pmid) return 1.0;
  return tierConfidence(classifyReferenceTier({ ...ref, source }));
}

/**
 * Build a ProvenanceMap from a freshly structured reference. Only fields with
 * a non-null/non-empty value are included; the resulting map is suitable for
 * direct assignment to `StructuredReference.provenance`.
 */
export function buildProvenance(ref: StructuredReference, source: SourceTag): ProvenanceMap {
  const tier = classifyReferenceTier({ ...ref, source });
  const tierConf = tierConfidence(tier);
  const map: ProvenanceMap = {};

  if (ref.title) {
    map.title = mkField(ref.title, source, tierConf);
  }
  if (ref.doi) {
    map.doi = mkField(ref.doi, source, 1.0);
  }
  if (ref.pmid) {
    map.pmid = mkField(ref.pmid, source, 1.0);
  }
  if (ref.year != null) {
    map.year = mkField(ref.year, source, tierConf);
  }
  if (ref.authors.length > 0) {
    map.authors = mkField(ref.authors, source, tierConf);
  }
  if (ref.journal) {
    map.journal = mkField(ref.journal, source, tierConf);
  }
  return map;
}

function mkField<T>(value: T, source: SourceTag, confidence: number): FieldProvenance<T> {
  return { value, source, confidence };
}
