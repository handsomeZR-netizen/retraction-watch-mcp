/**
 * Hallucination guardrail for LLM-extracted reference fields.
 *
 * The LLM is allowed to rephrase title/authors/journal, but any DOI / PMID /
 * year it emits must be substring-findable in the original reference text.
 * Any id-shaped field that fails this check is nulled out and recorded in
 * `rejected`, so the caller can fall back to local extraction for that field
 * and the audit trail can show why.
 *
 * Title also gets a noise-shape rejection pass: when the LLM puts page
 * ranges, vol(issue):page, or month-day fragments into the title slot, we
 * null it out — feeding "1-4." into Crossref title-search wastes a request
 * and can never resolve.
 */

export type RejectedField = "doi" | "pmid" | "year" | "title";

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
  rejected: RejectedField[];
}

export function validateLlmExtraction(
  refText: string,
  llmOut: LlmReferenceFields,
): LlmValidationResult {
  const rejected: RejectedField[] = [];
  let doi = llmOut.doi;
  let pmid = llmOut.pmid;
  let year = llmOut.year;
  let title = llmOut.title;

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
  if (title && looksLikeMetadataNoise(title)) {
    rejected.push("title");
    title = null;
  }

  return {
    cleaned: {
      title,
      authors: llmOut.authors ?? [],
      year,
      doi,
      pmid,
      journal: llmOut.journal,
    },
    rejected,
  };
}

/**
 * Detects "title" values that are actually citation-metadata noise:
 * page ranges, vol(issue):page fragments, month-day stubs, etc.
 *
 * Only patterns we observed in real benchmark data — kept tight to avoid
 * false-rejecting real titles like "ISO 10218-1: Robots..." or short
 * one-word standards.
 */
export function looksLikeMetadataNoise(title: string): boolean {
  const t = title.trim();
  if (t.length === 0) return true;
  // Catch very short fragments — real titles are at least ~8 chars.
  if (t.length < 8) return true;
  // All digits + punctuation (page ranges / vol-issue): "1-4." / "373-384" /
  // "p. 373-384" / "(57)" — anything without a single letter A-Z, a-z, or
  // 中日韩字符is metadata noise, not a title.
  if (!/[A-Za-z一-鿿]/.test(t)) return true;
  // "Mon dd;vol(issue):page-page" e.g. "Aug 17;57(6):365–88."
  if (/^[A-Z][a-z]{2}\.?\s*\d+\s*[;:]/.test(t)) return true;
  // "vol(issue): page-page" e.g. "7(1): p. 373-384."
  if (/^\d+\s*\(\d+\)\s*[:;]/.test(t)) return true;
  // "year;vol:page-page" e.g. "2020;57:365-88"
  if (/^(19|20)\d{2}\s*[;:]\s*\d+/.test(t)) return true;
  // "vol:page-page" e.g. "57:365-88"
  if (/^\d+\s*:\s*\d+[\s\-–]?\d*\.?$/.test(t)) return true;
  // Title that starts with "p." or "pp." then digits — pure page reference
  if (/^pp?\.?\s*\d+/.test(t)) return true;
  return false;
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
