/**
 * Find author-block boundaries in the header lines.
 *
 * Author block sits between the title and one of: Keywords, ABSTRACT,
 * Article history, copyright notice, or the next numbered section.
 */

const KEYWORDS_BOUNDARY_RE = /^keywords?\s*[:：]?\s*$/i;
const ABSTRACT_BOUNDARY_RE = /^(abstract|摘要|关键词|introduction|引言)\s*[:：]?\s*$/i;
// Elsevier renders ABSTRACT and ARTICLE INFO with letter-spacing
// → "A B S T R A C T" and "A R T I C L E I N F O"
const SPACED_ABSTRACT_RE = /^a\s*b\s*s\s*t\s*r\s*a\s*c\s*t\s*$/i;
const SPACED_ARTICLE_INFO_RE = /^a\s*r\s*t\s*i\s*c\s*l\s*e\s*i\s*n\s*f\s*o\s*$/i;
const COPYRIGHT_RE =
  /(©|\(c\))\s*\d{4}|elsevier\s+(b\.?v\.?|ltd|inc)|all rights reserved/i;
const ARTICLE_HISTORY_RE = /^article history\s*[:：]?\s*$/i;
const NUMBERED_SECTION_RE = /^\d+\s+[A-Z][a-z]/;
// Inline Keywords: prefix (the line itself starts with the keyword list)
const INLINE_KEYWORDS_RE = /^keywords?\s*[:：]/i;

export function isBoundaryLine(line: string): boolean {
  if (!line) return false;
  if (ABSTRACT_BOUNDARY_RE.test(line)) return true;
  if (KEYWORDS_BOUNDARY_RE.test(line)) return true;
  if (INLINE_KEYWORDS_RE.test(line)) return true;
  if (SPACED_ABSTRACT_RE.test(line)) return true;
  if (SPACED_ARTICLE_INFO_RE.test(line)) return true;
  if (COPYRIGHT_RE.test(line)) return true;
  if (ARTICLE_HISTORY_RE.test(line)) return true;
  if (NUMBERED_SECTION_RE.test(line)) return true;
  return false;
}
