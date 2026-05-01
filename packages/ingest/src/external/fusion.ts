import { normalizeTitle } from "@rw/core";

/**
 * Thresholds for accepting an external metadata match (Crossref / EPMC /
 * OpenAlex / Semantic Scholar) over a local extraction:
 *   - normalized-title Levenshtein ratio ≥ 0.92
 *   - year within ±1
 *   - **at least one local author surname appears in the external authors
 *     list** (when both sides have author metadata). This is the
 *     correctness gate — title fuzzy-match alone can approve a totally
 *     different paper that happens to have a similar title; an author
 *     surname disagreement is a near-certain false positive.
 *
 * All three are required when authors are available on both sides. If
 * authors are missing on either side we fall back to title+year only and
 * mark the result as "weak_match_no_authors" for trace visibility.
 */
export const TITLE_FUSION_THRESHOLD = 0.92;
export const YEAR_FUSION_TOLERANCE = 1;

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function levenshteinRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

export function normalizedTitleRatio(a: string, b: string): number {
  return levenshteinRatio(normalizeTitle(a), normalizeTitle(b));
}

export interface FusionInput {
  title: string | null;
  year: number | null;
  authors?: string[];
}

export interface FusionDecision {
  accept: boolean;
  titleRatio: number;
  yearDelta: number | null;
  authorOverlap: boolean;
  reason?: string;
}

export function acceptFusionMatch(
  local: FusionInput,
  external: FusionInput,
): FusionDecision {
  if (!local.title || !external.title) {
    return {
      accept: false,
      titleRatio: 0,
      yearDelta: null,
      authorOverlap: false,
      reason: "missing_title",
    };
  }
  const titleRatio = normalizedTitleRatio(local.title, external.title);
  if (titleRatio < TITLE_FUSION_THRESHOLD) {
    return {
      accept: false,
      titleRatio,
      yearDelta: null,
      authorOverlap: false,
      reason: "title_below_threshold",
    };
  }
  if (local.year == null || external.year == null) {
    return {
      accept: false,
      titleRatio,
      yearDelta: null,
      authorOverlap: false,
      reason: "missing_year",
    };
  }
  const yearDelta = Math.abs(local.year - external.year);
  if (yearDelta > YEAR_FUSION_TOLERANCE) {
    return {
      accept: false,
      titleRatio,
      yearDelta,
      authorOverlap: false,
      reason: "year_above_tolerance",
    };
  }
  // Author surname check: both sides must have ≥ 1 author, and at least
  // one local surname must appear in the external authors. If either side
  // has no authors, we accept with a weaker `weak_match_no_authors` reason
  // so callers can downgrade confidence if they choose.
  const localSurnames = surnameSet(local.authors);
  const externalSurnames = surnameSet(external.authors);
  if (localSurnames.size === 0 || externalSurnames.size === 0) {
    return {
      accept: true,
      titleRatio,
      yearDelta,
      authorOverlap: false,
      reason: "weak_match_no_authors",
    };
  }
  let overlap = false;
  for (const s of localSurnames) {
    if (externalSurnames.has(s)) {
      overlap = true;
      break;
    }
  }
  if (!overlap) {
    return {
      accept: false,
      titleRatio,
      yearDelta,
      authorOverlap: false,
      reason: "author_surname_mismatch",
    };
  }
  return { accept: true, titleRatio, yearDelta, authorOverlap: true };
}

/**
 * Pulls a comparable surname out of each author string. Handles:
 *   - "Doe, Jane" → "doe"
 *   - "Jane Doe"  → "doe"   (last token after splitting on whitespace)
 *   - "Doe J."    → "doe"
 *   - "李 明"     → "李"     (CJK: first char is the family name)
 *   - "et al."    → dropped
 *
 * Lower-cases and strips diacritics so "Müller" matches "Muller".
 */
function surnameSet(authors: string[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!authors) return out;
  for (const author of authors) {
    const surname = extractSurname(author);
    if (surname) out.add(surname);
  }
  return out;
}

function extractSurname(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^et\s+al\.?$/i.test(trimmed)) return null;
  let surname: string;
  if (trimmed.includes(",")) {
    // "Doe, Jane" / "Doe, J." → token before comma
    surname = trimmed.split(",")[0]!.trim();
  } else if (/[一-鿿]/.test(trimmed)) {
    // CJK: take first non-space character (family name).
    const m = trimmed.match(/[一-鿿]/);
    surname = m?.[0] ?? "";
  } else {
    // No comma: pick the LAST multi-char token after dropping single-char
    // initials. Handles both:
    //   "Jane Doe"   → drop nothing → ["Jane","Doe"] → last = "Doe"
    //   "Doe J."     → drop "J"     → ["Doe"]        → last = "Doe"
    //   "F. M. Last" → drop initials → ["Last"]      → last = "Last"
    const tokens = trimmed
      .split(/\s+/)
      .map((t) => t.replace(/[.,;:()]/g, ""))
      .filter((t) => /[A-Za-zÀ-ɏ]/.test(t))
      .filter((t) => t.length >= 2);
    if (tokens.length === 0) return null;
    surname = tokens[tokens.length - 1]!;
  }
  if (!surname) return null;
  // NFD-strip diacritics, lowercase, drop non-letter chars.
  return surname
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z一-鿿]/g, "")
    || null;
}
