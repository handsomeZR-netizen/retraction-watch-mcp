/**
 * Map Elsevier-style footnote markers (a, b, c…) to affiliation lines.
 *
 * Author block typically looks like:
 *   Mira Chena, Ethan Zhaoa, Lena Parkb
 *   aDepartment of Educational Psychology, Northbridge University, …
 *   bSchool of Public Health, Eastern Bay University, …
 */

export const AFFILIATION_RE =
  /\b(University|Institute|College|Hospital|Laborator(y|ies)|Department|School|Center|Centre|Faculty|大学|学院|医院|研究所|研究院|实验室|系)\b/i;

// Lines that look like a footnote-prefixed corporate affiliation
// (e.g. "bHaomo.AI Technology Co., Ltd, Beijing"), which AFFILIATION_RE alone
// would miss because they contain no university/department keyword.
export const CORP_AFFILIATION_RE =
  /\b(Inc\.?|Corp(\.|oration)?|Co\.,?|Ltd\.?|LLC|GmbH|SA|AG|Pty|Pte|Technology|Technologies|Group|Holdings)\b/;

const FOOTNOTE_PREFIX_RE = /^([a-z])(?=[A-Z])/;
// Allow up to 4 digits for numeric markers (^1Department, ^12 ...)
const NUMERIC_PREFIX_RE = /^(\d{1,2})(?=[A-Z])/;

export interface AffiliationMap {
  byKey: Map<string, string>;
  /** Affiliation line without footnote prefix, in document order. */
  ordered: string[];
}

export function buildAffiliationMap(blockLines: string[]): AffiliationMap {
  const byKey = new Map<string, string>();
  const ordered: string[] = [];
  for (const line of blockLines) {
    const looksLikeAffiliation =
      AFFILIATION_RE.test(line) ||
      (FOOTNOTE_PREFIX_RE.test(line) && CORP_AFFILIATION_RE.test(line));
    if (!looksLikeAffiliation) continue;
    const letterMatch = line.match(FOOTNOTE_PREFIX_RE);
    const numericMatch = !letterMatch ? line.match(NUMERIC_PREFIX_RE) : null;
    let key: string | null = null;
    let body = line;
    if (letterMatch) {
      key = letterMatch[1];
      body = line.slice(letterMatch[0].length).trim();
    } else if (numericMatch) {
      key = numericMatch[1];
      body = line.slice(numericMatch[0].length).trim();
    }
    body = body.replace(/^[,;\s]+/, "").trim();
    if (key && !byKey.has(key)) byKey.set(key, body);
    ordered.push(body);
  }
  return { byKey, ordered };
}

/**
 * Strip a trailing single footnote letter (or digit) from a name token.
 * Returns the cleaned name plus any markers we removed.
 */
export function stripFootnoteSuffix(name: string): {
  base: string;
  markers: string[];
} {
  // Capture trailing letters or digits that are likely footnote refs.
  // e.g. "Miao Xua" → ("Miao Xu", ["a"])
  // e.g. "Mira Chen1,2" → ("Mira Chen", ["1","2"])
  const markers: string[] = [];
  let cleaned = name.trim();
  // Strip non-letter footnote glyphs first (∗*†‡§¶○●)
  cleaned = cleaned.replace(/[∗*†‡§¶○●]+\s*$/, (m) => {
    markers.push(...m.split("").filter((c) => /\S/.test(c)));
    return "";
  });
  // Trailing comma+digits sequence like "Mira Chen1,2"
  const digitRun = cleaned.match(/(?:[\s,]*\d{1,2})+$/);
  if (digitRun) {
    const digits = digitRun[0].match(/\d{1,2}/g) ?? [];
    markers.push(...digits);
    cleaned = cleaned.slice(0, -digitRun[0].length).trim();
  }
  // Trailing single footnote letter glued to the surname (only single lowercase)
  // Be conservative: only do this when removing it leaves a name that ends in
  // a known surname-ish pattern (≥2 letters and capitalized first letter).
  const tailLetter = cleaned.match(/^(.+?[A-Za-z]{2,})([a-d])$/);
  if (tailLetter) {
    const candidate = tailLetter[1];
    // Require the body to look like ≥2 capitalized words
    const words = candidate.split(/\s+/);
    if (words.length >= 2 && /^[A-Z]/.test(words.at(-1) ?? "")) {
      markers.push(tailLetter[2]);
      cleaned = candidate.trim();
    }
  }
  return { base: cleaned.replace(/[,;\s]+$/, "").trim(), markers };
}

/**
 * Lookup the best affiliation for a parsed author. Prefers footnote-keyed
 * lookup, falls back to first ordered affiliation, then null.
 */
export function affiliationForAuthor(
  rawName: string,
  map: AffiliationMap,
): string | null {
  const { markers } = stripFootnoteSuffix(rawName);
  for (const marker of markers) {
    const hit = map.byKey.get(marker);
    if (hit) return hit;
  }
  return map.ordered[0] ?? null;
}
