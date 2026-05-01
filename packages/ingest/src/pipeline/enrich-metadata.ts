import type { FieldProvenance, ProvenanceMap, SourceTag } from "@rw/core/types";
import { classifyReferenceTier } from "../extraction/confidence.js";
import type { CrossrefClient, CrossrefWork } from "../external/crossref.js";
import type { EpmcWork, EuropePmcClient } from "../external/europepmc.js";
import type { OpenAlexClient } from "../external/openalex.js";
import type { SemanticScholarClient } from "../external/semantic-scholar.js";
import { looksLikeMetadataNoise } from "../extraction/validate-llm.js";
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
 *      the Crossref DOI as a crossref-sourced field. **If Crossref rejects
 *      or returns nothing, fall back to OpenAlex with the same fusion gate**
 *      — OpenAlex indexes ~250M works, including many proceedings that
 *      Crossref's title index doesn't cover.
 *   4. If still no DOI but a PMID: ask Europe PMC for the canonical record,
 *      again subject to the fusion gate.
 *
 * Each accept/reject decision is recorded in the trace so the result page can
 * show why a value was chosen.
 */

export interface EnrichmentClients {
  crossref?: CrossrefClient;
  europepmc?: EuropePmcClient;
  openalex?: OpenAlexClient;
  semanticScholar?: SemanticScholarClient;
  llm?: LlmExtractionClient;
}

export interface EnrichmentLimits {
  /**
   * Cap on Crossref network calls per manuscript across Step 2 (DOI verify)
   * and Step 3 (title→DOI search). Once reached, further refs in this
   * manuscript skip Crossref and fall through unchanged. Defaults to 60,
   * which is a generous headroom over a typical 30-50 ref paper but stops a
   * pathological 200-ref bibliography from exhausting the polite pool.
   */
  maxCrossrefCalls?: number;
  /**
   * Cap on OpenAlex network calls per manuscript (Step 3 fallback). Same
   * defense-in-depth rationale as Crossref. Default 60.
   */
  maxOpenAlexCalls?: number;
  /**
   * Cap on Semantic Scholar network calls per manuscript (Step 3 third
   * fallback). Default 60.
   */
  maxSemanticScholarCalls?: number;
}

export interface EnrichmentTelemetry {
  crossrefCalls: number;
  epmcCalls: number;
  llmCalls: number;
  enrichmentFailures: number;
  cacheHits: number;
  crossrefSkippedOverLimit: number;
  openalexCalls: number;
  openalexSkippedOverLimit: number;
  openalexResolved: number;
  semanticScholarCalls: number;
  semanticScholarSkippedOverLimit: number;
  semanticScholarResolved: number;
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
const DEFAULT_MAX_CROSSREF_CALLS = 60;
const DEFAULT_MAX_OPENALEX_CALLS = 60;
const DEFAULT_MAX_SEMANTIC_SCHOLAR_CALLS = 60;
/**
 * In-flight refs per enrichment step. The HttpClient already throttles to 3
 * per host, so going much higher here just queues at the semaphore. Six
 * leaves headroom for refs that hit different hosts in step 3 (Crossref →
 * OpenAlex → Semantic Scholar fallback chain).
 */
const ENRICHMENT_CONCURRENCY = 6;

export async function enrichMetadata(
  candidates: StructuredReference[],
  unresolvedRaw: RawReference[],
  clients: EnrichmentClients,
  limits: EnrichmentLimits = {},
): Promise<EnrichmentResult> {
  const telemetry: EnrichmentTelemetry = {
    crossrefCalls: 0,
    epmcCalls: 0,
    llmCalls: 0,
    enrichmentFailures: 0,
    cacheHits: 0,
    crossrefSkippedOverLimit: 0,
    openalexCalls: 0,
    openalexSkippedOverLimit: 0,
    openalexResolved: 0,
    semanticScholarCalls: 0,
    semanticScholarSkippedOverLimit: 0,
    semanticScholarResolved: 0,
  };
  const maxCrossrefCalls = limits.maxCrossrefCalls ?? DEFAULT_MAX_CROSSREF_CALLS;
  const maxOpenAlexCalls = limits.maxOpenAlexCalls ?? DEFAULT_MAX_OPENALEX_CALLS;
  const maxSemanticScholarCalls =
    limits.maxSemanticScholarCalls ?? DEFAULT_MAX_SEMANTIC_SCHOLAR_CALLS;
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
        // Final-pass noise sanity check on the merged title: covers the case
        // where slot.ref.title (from heuristic) and lr.title (from a stale
        // pre-fix LLM cache hit) are both metadata noise. We don't want a
        // garbage title here because step 3 (Crossref title-search) blindly
        // queries it.
        const slotTitle = slot.ref.title && !looksLikeMetadataNoise(slot.ref.title) ? slot.ref.title : null;
        const llmTitle = lr.title && !looksLikeMetadataNoise(lr.title) ? lr.title : null;
        const merged: StructuredReference = {
          ...slot.ref,
          title: slotTitle ?? llmTitle,
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
    const crossref = clients.crossref;
    await mapWithConcurrency(working, ENRICHMENT_CONCURRENCY, async (slot) => {
      const { ref, refIndex } = slot;
      if (!ref.doi) return;
      // Synchronous quota claim before await — JS is single-threaded so the
      // check + increment is atomic across concurrent refs, even with the
      // map-with-concurrency fan-out.
      if (telemetry.crossrefCalls >= maxCrossrefCalls) {
        telemetry.crossrefSkippedOverLimit += 1;
        return;
      }
      telemetry.crossrefCalls += 1;
      const work = await crossref.getByDoi(ref.doi);
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
        return;
      }
      slot.ref = mergeCrossrefIntoLocal(ref, work, refIndex, trace);
    });
  }

  // Step 3 — title→DOI for refs that still lack one. Crossref first, then
  // OpenAlex as a second source. Same fusion gate (title ≥ 0.92, year ±1)
  // applied to both — we never accept an external DOI without that
  // agreement.
  if (clients.crossref || clients.openalex || clients.semanticScholar) {
    await mapWithConcurrency(working, ENRICHMENT_CONCURRENCY, async (slot) => {
      const { ref, refIndex } = slot;
      if (ref.doi) return;
      if (!ref.title || ref.year == null) return;
      // Only try when the local title is at least medium-confidence; otherwise
      // we'd be querying external APIs with garbage.
      const tier = classifyReferenceTier(ref);
      if (tier === "raw_only") return;

      // 3a — Crossref title-search.
      let resolved: {
        doi: string;
        titleRatio: number;
        yearDelta: number;
        source: "crossref" | "openalex" | "semanticscholar";
      } | null = null;
      if (clients.crossref) {
        if (telemetry.crossrefCalls >= maxCrossrefCalls) {
          telemetry.crossrefSkippedOverLimit += 1;
        } else {
          telemetry.crossrefCalls += 1;
          const cr = await clients.crossref.resolveByTitle(ref.title, ref.year, ref.authors);
          if (cr) {
            resolved = {
              doi: cr.work.doi,
              titleRatio: cr.titleRatio,
              yearDelta: cr.yearDelta,
              source: "crossref",
            };
          } else {
            trace.push({
              refIndex,
              field: "doi",
              source: "crossref",
              confidence: 0,
              accepted: false,
              reason: "crossref_title_below_threshold",
            });
          }
        }
      }

      // 3b — OpenAlex fallback when Crossref didn't resolve.
      if (!resolved && clients.openalex) {
        if (telemetry.openalexCalls >= maxOpenAlexCalls) {
          telemetry.openalexSkippedOverLimit += 1;
        } else {
          telemetry.openalexCalls += 1;
          const oa = await clients.openalex.resolveByTitle(ref.title, ref.year, ref.authors);
          if (oa) {
            resolved = {
              doi: oa.work.doi,
              titleRatio: oa.titleRatio,
              yearDelta: oa.yearDelta,
              source: "openalex",
            };
            telemetry.openalexResolved += 1;
          } else {
            trace.push({
              refIndex,
              field: "doi",
              source: "openalex",
              confidence: 0,
              accepted: false,
              reason: "openalex_title_below_threshold",
            });
          }
        }
      }

      // 3c — Semantic Scholar third fallback.
      if (!resolved && clients.semanticScholar) {
        if (telemetry.semanticScholarCalls >= maxSemanticScholarCalls) {
          telemetry.semanticScholarSkippedOverLimit += 1;
        } else {
          telemetry.semanticScholarCalls += 1;
          const s2 = await clients.semanticScholar.resolveByTitle(
            ref.title,
            ref.year,
            ref.authors,
          );
          if (s2) {
            resolved = {
              doi: s2.work.doi,
              titleRatio: s2.titleRatio,
              yearDelta: s2.yearDelta,
              source: "semanticscholar",
            };
            telemetry.semanticScholarResolved += 1;
          } else {
            trace.push({
              refIndex,
              field: "doi",
              source: "semanticscholar",
              confidence: 0,
              accepted: false,
              reason: "s2_title_below_threshold",
            });
          }
        }
      }

      if (resolved) {
        const provenance = ref.provenance ?? {};
        provenance.doi = {
          value: resolved.doi,
          source: resolved.source,
          confidence: EXTERNAL_CONFIDENCE,
        };
        slot.ref = { ...ref, doi: resolved.doi, provenance };
        trace.push({
          refIndex,
          field: "doi",
          source: resolved.source,
          confidence: EXTERNAL_CONFIDENCE,
          accepted: true,
          reason: `title_match_${resolved.titleRatio.toFixed(2)}_year_delta_${resolved.yearDelta}`,
          after: resolved.doi,
        });
      }
    });
  }

  // Step 4 — Europe PMC DOI lookup for refs that still lack a DOI but have PMID.
  if (clients.europepmc) {
    const epmc = clients.europepmc;
    await mapWithConcurrency(working, ENRICHMENT_CONCURRENCY, async (slot) => {
      const { ref, refIndex } = slot;
      if (ref.doi) return;
      if (!ref.pmid) return;
      telemetry.epmcCalls += 1;
      const work = await epmc.getByPmid(ref.pmid);
      if (!work || !work.doi) {
        trace.push({
          refIndex,
          field: "doi",
          source: "europepmc",
          confidence: 0,
          accepted: false,
          reason: "epmc_no_doi_for_pmid",
        });
        return;
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
    });
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

/**
 * Process `items` in parallel, capping in-flight work at `limit`. The
 * callback can mutate shared state (telemetry counters, the items
 * themselves, the trace array) safely because JS is single-threaded between
 * awaits — sync increments before an `await` are atomic w.r.t. other
 * concurrent callbacks.
 *
 * Used by the enrichment pipeline to fan out per-ref external lookups
 * instead of awaiting them one at a time.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  };
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(next());
  }
  await Promise.all(workers);
}
