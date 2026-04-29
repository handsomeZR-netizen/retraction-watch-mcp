import { buildProvenance, classifyReferenceTier } from "../extraction/confidence.js";
import { heuristicStructureReferences, regexStructure } from "../refs.js";
import type { RawReference, StructuredReference } from "../types.js";

/**
 * Stage 2 of the enriched pipeline: turn raw reference strings into
 * StructuredReferences carrying per-field provenance.
 *
 * This stage is local-only: regex (DOI/PMID anchored) + heuristic title/
 * authors/year extraction for the rest. No LLM, no external APIs. Output
 * references include `provenance` so downstream stages can decide whether
 * enrichment is worth attempting.
 *
 * The output preserves input order via `RawReference.index`.
 */
export function extractCandidates(refs: RawReference[]): StructuredReference[] {
  if (refs.length === 0) return [];
  const { structured, unresolved } = regexStructure(refs);
  const heuristic = heuristicStructureReferences(unresolved);

  const indexById = new Map<string, StructuredReference>();
  for (const s of structured) indexById.set(s.raw, s);
  for (const h of heuristic) indexById.set(h.raw, h);

  const ordered = refs.map((r) => indexById.get(r.raw));
  return ordered
    .filter((r): r is StructuredReference => r != null)
    .map(attachProvenance);
}

function attachProvenance(ref: StructuredReference): StructuredReference {
  return {
    ...ref,
    provenance: buildProvenance(ref, ref.source),
  };
}

export { classifyReferenceTier };
