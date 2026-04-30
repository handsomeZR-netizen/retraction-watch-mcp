import type { FieldProvenance, ProvenanceMap, SourceTag } from "@rw/core/types";
import { classifyReferenceTier } from "../extraction/confidence.js";
import type { CrossrefClient, CrossrefWork } from "../external/crossref.js";
import type { EpmcWork, EuropePmcClient } from "../external/europepmc.js";
import type { LlmExtractionClient } from "../llm-client.js";
import type { RawReference, StructuredReference } from "../types.js";
import { buildProvenance } from "../extraction/confidence.js";

/**
 * Stage 3 of the enriched pipeline.
 *
 * For each candidate reference:
 *   1. If raw_only or LLM-needed: structure via LLM (if available; the LLM
 *      client already runs the hallucination guardrail and zod validation).
 *   2. If a DOI is present (local or LLM-derived): fetch the canonical
 *      Crossref work and fill in any missing fields (title/year/authors/
 *      journal). Local fields that conflict with Crossref are kept; the
 *      conflict is recorded in `provenance.conflicts`.
 *   3. If no DOI but a high-confidence title+year: try Crossref title-search
 *      with the fusion gate (Levenshtein ≥ 0.92, year ±1). On accept, attach
 *      the Crossref DOI as a crossref-sourced field.
 *   4. If still no DOI but a PMID: ask Europe PMC for the canonical record,
 *      again subject to the fusion gate.
 *
 * Each accept/reject decision is recorded in the trace so the result page can
 * show why a value was chosen.
 */

export interface EnrichmentClients {
  crossref?: CrossrefClient;
  europepmc?: EuropePmcClient;
  llm?: LlmExtractionClient;
}

export interface EnrichmentTelemetry {
  crossrefCalls: number;
  epmcCalls: number;
  llmCalls: number;
  enrichmentFailures: number;
  cacheHits: number;
}

export interface ParseTraceEntry {
  refIndex: number;
  field: keyof ProvenanceMap | "reference";
  source: SourceTag;
  confidence: number;
  accepted: boolean;
  reason: string;
  before?: unknown;
  after?: unknown;
}

export interface EnrichmentResult {
  references: StructuredReference[];
  trace: ParseTraceEntry[];
  telemetry: EnrichmentTelemetry;
}

const EXTERNAL_CONFIDENCE = 0.95;

export async function enrichMetadata(
  candidates: StructuredReference[],
  unresolvedRaw: RawReference[],
  clients: EnrichmentClients,
): Promise<EnrichmentResult> {
  const telemetry: EnrichmentTelemetry = {
    crossrefCalls: 0,
    epmcCalls: 0,
    llmCalls: 0,
    enrichmentFailures: 0,
    cacheHits: 0,
  };
  const trace: ParseTraceEntry[] = [];
  let working = candidates.map((r, i) => ({ ref: r, refIndex: i }));

  // Step 1 — LLM structuring for unresolved + raw_only candidates.
  if (clients.llm) {
    const lowConfidenceTargets = working
      .filter(({ ref }) => classifyReferenceTier(ref) === "raw_only")
      .map(({ refIndex }) => ({ index: refIndex, raw: working[refIndex].ref.raw }));
    const allTargets: RawReference[] = [
      ...unresolvedRaw,
      ...lowConfidenceTargets,
    ];
    if (allTargets.length > 0) {
      const beforeRefsCalls = clients.llm.stats.refsCalls;
      const llmStructured = await clients.llm.structureReferences(allTargets);
      telemetry.llmCalls += clients.llm.stats.refsCalls - beforeRefsCalls;
      for (const lr of llmStructured) {
        // Find the existing slot — match on raw text (RawReference.index can
        // collide between unresolvedRaw and the lowConfidenceTargets array).
        const slot = working.find(({ ref }) => ref.raw === lr.raw);
        if (!slot) continue;
        const merged: StructuredReference = {
          ...slot.ref,
          title: slot.ref.title ?? lr.title,
          authors: slot.ref.authors.length > 0 ? slot.ref.authors : lr.authors,
          year: slot.ref.year ?? lr.year,
          doi: slot.ref.doi ?? lr.doi,
          pmid: slot.ref.pmid ?? lr.pmid,
          journal: slot.ref.journal ?? lr.journal,
          source: "llm" as SourceTag,
        };
        merged.provenance = buildProvenance(merged, "llm");
        slot.ref = merged;
        trace.push({
          refIndex: slot.refIndex,
          field: "reference",
          source: "llm",
          confidence: merged.provenance.title?.confidence ?? 0.2,
          accepted: true,
          reason: "llm_structured",
        });
      }
    }
  }

  // Step 2 — Crossref DOI validation + field fill-in.
  if (clients.crossref) {
    for (const slot of working) {
      const { ref, refIndex } = slot;
      if (!ref.doi) continue;
      telemetry.crossrefCalls += 1;
      const work = await clients.crossref.getByDoi(ref.doi);
      if (!work) {
        telemetry.enrichmentFailures += 1;
        trace.push({
          refIndex,
          field: "doi",
          source: "crossref",
          confidence: 0,
          accepted: false,
          reason: "crossref_lookup_failed",
        });
        continue;
      }
      slot.ref = mergeCrossrefIntoLocal(ref, work, refIndex, trace);
    }
  }

  // Step 3 — Crossref title→DOI for refs that still lack a DOI.
  if (clients.crossref) {
    for (const slot of working) {
      const { ref, refIndex } = slot;
      if (ref.doi) continue;
      if (!ref.title || ref.year == null) continue;
      // Only try when the local title is at least medium-confidence; otherwise
      // we'd be querying Crossref with garbage.
      const tier = classifyReferenceTier(ref);
      if (tier === "raw_only") continue;
      telemetry.crossrefCalls += 1;
      const resolved = await clients.crossref.resolveByTitle(ref.title, ref.year);
      if (!resolved) {
        trace.push({
          refIndex,
          field: "doi",
          source: "crossref",
          confidence: 0,
          accepted: false,
          reason: "crossref_title_below_threshold",
        });
        continue;
      }
      const provenance = ref.provenance ?? {};
      provenance.doi = {
        value: resolved.work.doi,
        source: "crossref",
        confidence: EXTERNAL_CONFIDENCE,
      };
      slot.ref = { ...ref, doi: resolved.work.doi, provenance };
      trace.push({
        refIndex,
        field: "doi",
        source: "crossref",
        confidence: EXTERNAL_CONFIDENCE,
        accepted: true,
        reason: `title_match_${resolved.titleRatio.toFixed(2)}_year_delta_${resolved.yearDelta}`,
        after: resolved.work.doi,
      });
    }
  }

  // Step 4 — Europe PMC DOI lookup for refs that still lack a DOI but have PMID.
  if (clients.europepmc) {
    for (const slot of working) {
      const { ref, refIndex } = slot;
      if (ref.doi) continue;
      if (!ref.pmid) continue;
      telemetry.epmcCalls += 1;
      const work = await clients.europepmc.getByPmid(ref.pmid);
      if (!work || !work.doi) {
        trace.push({
          refIndex,
          field: "doi",
          source: "europepmc",
          confidence: 0,
          accepted: false,
          reason: "epmc_no_doi_for_pmid",
        });
        continue;
      }
      const provenance = ref.provenance ?? {};
      provenance.doi = {
        value: work.doi,
        source: "europepmc",
        confidence: EXTERNAL_CONFIDENCE,
      };
      slot.ref = { ...ref, doi: work.doi, provenance };
      trace.push({
        refIndex,
        field: "doi",
        source: "europepmc",
        confidence: EXTERNAL_CONFIDENCE,
        accepted: true,
        reason: "epmc_pmid_lookup",
        after: work.doi,
      });
    }
  }

  return {
    references: working.map(({ ref }) => ref),
    trace,
    telemetry,
  };
}

function mergeCrossrefIntoLocal(
  ref: StructuredReference,
  work: CrossrefWork,
  refIndex: number,
  trace: ParseTraceEntry[],
): StructuredReference {
  const provenance: ProvenanceMap = ref.provenance ?? {};
  const next = { ...ref };

  fillIfMissing<"title", string | null>(next, provenance, "title", work.title, "crossref", trace, refIndex);
  fillIfMissing<"year", number | null>(next, provenance, "year", work.year, "crossref", trace, refIndex);
  fillIfMissing<"journal", string | null>(next, provenance, "journal", work.journal, "crossref", trace, refIndex);
  fillIfMissingAuthors(next, provenance, work.authors, "crossref", trace, refIndex);

  // DOI was the lookup key; record provenance even though value is unchanged.
  if (!provenance.doi) {
    provenance.doi = mkProv(ref.doi, ref.source, 1.0);
  }

  next.provenance = provenance;
  return next;
}

function fillIfMissing<K extends keyof ProvenanceMap, V>(
  ref: StructuredReference,
  prov: ProvenanceMap,
  field: K,
  external: V,
  source: SourceTag,
  trace: ParseTraceEntry[],
  refIndex: number,
): void {
  const local = (ref as unknown as Record<string, unknown>)[field];
  if (local && local !== "") {
    if (external && local !== external) {
      const existing = prov[field];
      const conflicts = existing?.conflicts ?? [];
      conflicts.push({ source, value: external as never });
      prov[field] = { ...(existing as FieldProvenance<unknown>), conflicts } as never;
      trace.push({
        refIndex,
        field,
        source,
        confidence: EXTERNAL_CONFIDENCE,
        accepted: false,
        reason: "local_value_kept_external_conflict_recorded",
        before: local,
        after: external,
      });
    }
    return;
  }
  if (external == null || external === "") return;
  (ref as unknown as Record<string, unknown>)[field] = external;
  prov[field] = mkProv(external as never, source, EXTERNAL_CONFIDENCE);
  trace.push({
    refIndex,
    field,
    source,
    confidence: EXTERNAL_CONFIDENCE,
    accepted: true,
    reason: "external_filled_missing_local",
    after: external,
  });
}

function fillIfMissingAuthors(
  ref: StructuredReference,
  prov: ProvenanceMap,
  external: string[],
  source: SourceTag,
  trace: ParseTraceEntry[],
  refIndex: number,
): void {
  if (ref.authors.length > 0) return;
  if (external.length === 0) return;
  ref.authors = external;
  prov.authors = mkProv(external, source, EXTERNAL_CONFIDENCE);
  trace.push({
    refIndex,
    field: "authors",
    source,
    confidence: EXTERNAL_CONFIDENCE,
    accepted: true,
    reason: "external_filled_missing_local",
    after: external,
  });
}

function mkProv<T>(value: T, source: SourceTag, confidence: number): FieldProvenance<T> {
  return { value, source, confidence };
}

// Make EpmcWork referenceable by callers without a separate import.
export type { EpmcWork };
