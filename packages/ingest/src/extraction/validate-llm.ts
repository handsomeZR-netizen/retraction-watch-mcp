/**
 * Hallucination guardrail for LLM-extracted reference fields.
 *
 * The LLM is allowed to rephrase title/authors/journal, but any DOI / PMID /
 * year it emits must be substring-findable in the original reference text.
 * Any id-shaped field that fails this check is nulled out and recorded in
 * `rejected`, so the caller can fall back to local extraction for that field
 * and the audit trail can show why.
 */

export interface LlmReferenceFields {
  title: string | null;
  authors: string[];
  year: number | null;
  doi: string | null;
  pmid: string | null;
  journal: string | null;
}

export interface LlmValidationResult {
  cleaned: LlmReferenceFields;
  rejected: ("doi" | "pmid" | "year")[];
}

export function validateLlmExtraction(
  refText: string,
  llmOut: LlmReferenceFields,
): LlmValidationResult {
  const rejected: ("doi" | "pmid" | "year")[] = [];
  let doi = llmOut.doi;
  let pmid = llmOut.pmid;
  let year = llmOut.year;

  if (doi && !doiPresentInText(doi, refText)) {
    rejected.push("doi");
    doi = null;
  }
  if (pmid && !pmidPresentInText(pmid, refText)) {
    rejected.push("pmid");
    pmid = null;
  }
  if (year != null && !yearPresentInText(year, refText)) {
    rejected.push("year");
    year = null;
  }

  return {
    cleaned: {
      title: llmOut.title,
      authors: llmOut.authors ?? [],
      year,
      doi,
      pmid,
      journal: llmOut.journal,
    },
    rejected,
  };
}

function compactLower(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function doiPresentInText(doi: string, text: string): boolean {
  return compactLower(text).includes(compactLower(doi));
}

function pmidPresentInText(pmid: string, text: string): boolean {
  // PMID is digits only; allow direct substring match (no whitespace possible).
  const digits = pmid.replace(/\D+/g, "");
  if (!digits) return false;
  return text.includes(digits);
}

function yearPresentInText(year: number, text: string): boolean {
  if (!Number.isInteger(year)) return false;
  const re = new RegExp(`\\b${year}\\b`);
  return re.test(text);
}
