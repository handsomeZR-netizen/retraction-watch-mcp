/**
 * Author parsing: walks the author block, splits multi-author lines, dedupes
 * footnote-suffixed name variants, and links each author to an affiliation.
 */

import { EMAIL_REGEX, ORCID_REGEX } from "@rw/core";
import type { ManuscriptAuthor } from "../types.js";
import {
  affiliationForAuthor,
  AFFILIATION_RE,
  buildAffiliationMap,
  stripFootnoteSuffix,
} from "./affiliations.js";
import { isBoundaryLine } from "./boundaries.js";
import {
  candidateLooksLikeTitle,
  extractTitleRange,
  shouldMergeTitleContinuation,
  TITLE_NOISE_RE,
} from "./title.js";

const ORG_STOPWORD_RE =
  /^(Microsoft|Google|Meta|Apple|IBM|Mistral|OpenAI|Anthropic|Amazon|Nvidia|Haomo\.AI|Tesla|ByteDance|Tencent|Baidu|Alibaba|Huawei|Xiaomi)\b/i;

const AFFIL_PREFIX_RE = /^([a-z]|\d{1,2})(?=[A-Z])/;

const COUNTRY_OR_CITY_STOPWORDS = new Set([
  "China",
  "USA",
  "UK",
  "Japan",
  "Korea",
  "Singapore",
  "Beijing",
  "Shanghai",
  "Tokyo",
  "Seoul",
  "London",
  "Paris",
  "Boston",
  "Hong Kong",
  "Taiwan",
  "Germany",
  "France",
  "Italy",
  "Spain",
  "Canada",
  "Australia",
]);

export function extractAuthors(
  lines: string[],
  rawText: string,
): ManuscriptAuthor[] {
  const emails = unique(rawText.match(EMAIL_REGEX) ?? []);
  const orcids = unique(extractAllOrcids(rawText));

  const block = sliceAuthorBlock(lines);
  const affiliationMap = buildAffiliationMap(block);
  const rawNames = parseRawNames(block);
  const deduped = dedupAuthorWithFootnoteSuffix(rawNames);

  if (deduped.length === 0) {
    return emails.map((email) => ({
      name: email.split("@")[0],
      email,
      affiliation: null,
      orcid: orcids[0] ?? null,
    }));
  }

  return deduped.map((rawName, idx) => {
    const { base } = stripFootnoteSuffix(rawName);
    return {
      name: base,
      email: emails[idx] ?? null,
      orcid: orcids[idx] ?? null,
      affiliation: affiliationForAuthor(rawName, affiliationMap),
    };
  });
}

export function sliceAuthorBlock(lines: string[]): string[] {
  // Use the same title-range logic as extractTitle so any line consumed by
  // the title (including 2-line + 3-line wraps) is excluded from the author
  // scan. Previously this function had its own ad-hoc 2-merge loop that
  // disagreed with title.ts and let the third title line ("VANET Message
  // Streams") leak into the author list.
  const range = extractTitleRange(lines);
  // Without a title we still take the first chunk, capped tighter than
  // before to avoid swallowing the abstract body.
  if (!range) return lines.slice(0, 15);

  // Cap scan at titleEnd + 15 (was 60). Real author/affiliation blocks
  // finish well within that on every layout we tested (arXiv, Cell, Wiley,
  // Procedia). 60 was loose enough that abstract sentences wrapped onto
  // independent lines (e.g. "Forest. On the position-offset split…")
  // slipped past every name-shape filter and got listed as authors.
  const block: string[] = [];
  for (let i = range.endLine + 1; i < Math.min(lines.length, range.endLine + 16); i += 1) {
    const line = lines[i];
    if (isBoundaryLine(line)) break;
    block.push(line);
  }
  return block;
}

// Arabic block (incl. supplement / extended A) + Hebrew block. Used to detect
// RTL-dominant lines so we can use script-appropriate tokenization (no
// uppercase concept, different conjunction words).
const RTL_CHAR_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

function rtlCharFraction(line: string): number {
  if (!line) return 0;
  let count = 0;
  for (const ch of line) {
    if (RTL_CHAR_RE.test(ch)) count += 1;
  }
  return count / line.length;
}

function isRtlDominantLine(line: string): boolean {
  // Stripped of common Latin punctuation/whitespace, ≥40% of remaining chars
  // are in Arabic/Hebrew blocks → treat as RTL line.
  const stripped = line.replace(/[\s.,;:()\-–—'"`،؛٫]/g, "");
  if (stripped.length < 4) return false;
  let count = 0;
  for (const ch of stripped) {
    if (RTL_CHAR_RE.test(ch)) count += 1;
  }
  return count / stripped.length >= 0.4;
}

function splitRtlNames(line: string): string[] {
  // Arabic comma U+060C (،), Hebrew/Arabic conjunctions (و / ו "and"),
  // ASCII comma, semicolon. Drop tokens with no RTL letters at all.
  const segs = line
    .split(/[,;،؛]| و | ו /u)
    .map((s) => s.trim())
    .filter(Boolean);
  return segs.filter((s) => RTL_CHAR_RE.test(s));
}

function isPlausibleRtlName(seg: string): boolean {
  // RTL names typically 2-4 space-separated tokens, each ≥2 letters.
  const tokens = seg.split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 6) return false;
  if (seg.length < 3 || seg.length > 80) return false;
  // At least 4 RTL letters total; reject lines that are mostly Latin (those
  // belong on the Latin path).
  let rtl = 0;
  for (const ch of seg) {
    if (RTL_CHAR_RE.test(ch)) rtl += 1;
  }
  return rtl >= 4;
}

export function parseRawNames(blockLines: string[]): string[] {
  const collected: string[] = [];
  for (const rawLine of blockLines) {
    if (rawLine.length < 4 || rawLine.length > 400) continue;
    if (rawLine.includes("@")) continue;
    if (/^https?:\/\//i.test(rawLine)) continue;
    if (/^doi[: ]/i.test(rawLine)) continue;
    if (/^[•◦▪●○■□–—]/.test(rawLine)) continue;
    if (/\.{2,}\s*$/.test(rawLine)) continue;
    if (isAffiliationLineNotName(rawLine)) continue;
    if (AFFILIATION_RE.test(rawLine) && rawLine.split(/\s+/).length <= 6) continue;
    if (/^\(.*\)$/.test(rawLine)) continue;
    if (/^\d/.test(rawLine)) continue;
    if (/^[A-Z][a-z]+\s+(Brain|Research|Labs?|Inc\.?|Corp(\.|oration)?|AI)$/i.test(rawLine)) continue;
    if (ORG_STOPWORD_RE.test(rawLine)) continue;

    // RTL-dominant lines (Arabic / Hebrew bylines) take a separate path —
    // the Latin-script "must start with capital letter" rule rejects them
    // entirely because Arabic/Hebrew have no uppercase concept.
    if (isRtlDominantLine(rawLine)) {
      for (const seg of splitRtlNames(rawLine)) {
        const cleaned = cleanNameToken(seg);
        if (cleaned && isPlausibleRtlName(cleaned)) {
          collected.push(cleaned);
        }
      }
      continue;
    }

    if (looksLikeNameLine(rawLine)) {
      const segs = splitNameSegments(rawLine);
      for (const seg of segs) {
        const cleaned = cleanNameToken(seg);
        if (cleaned && isPlausibleName(cleaned)) {
          collected.push(cleaned);
        }
      }
    }
  }
  return collected;
}

const CORP_SUFFIX_RE = /\b(Inc\.?|Corp(\.|oration)?|Co\.,?|Ltd\.?|LLC|GmbH|SA|AG|Pty|Pte)\b/i;

function isAffiliationLineNotName(line: string): boolean {
  // Footnote-prefixed affiliation: "aDepartment of...", "1Department of..."
  if (AFFIL_PREFIX_RE.test(line) && AFFILIATION_RE.test(line)) return true;
  // Footnote-prefixed corporate affiliation: "bHaomo.AI Technology Co., Ltd"
  if (AFFIL_PREFIX_RE.test(line) && CORP_SUFFIX_RE.test(line)) return true;
  if (/^([a-z]|\d{1,2})\s+[A-Z]/.test(line)) {
    if (AFFILIATION_RE.test(line) || CORP_SUFFIX_RE.test(line)) return true;
    if (/\b(Rd\.?|Road|Street|St\.?|Avenue|Ave\.?|Bangkok|Thailand|China|Singapore|USA|United States)\b/i.test(line)) return true;
    if ((line.match(/,/g) ?? []).length >= 2) return true;
  }
  return false;
}

function splitNameSegments(line: string): string[] {
  const primary = line
    .split(/,| ; | and (?=[A-Z])| & |·|；/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const seg of primary) {
    out.push(...splitSpaceSeparatedNames(seg));
  }
  return out;
}

function splitSpaceSeparatedNames(seg: string): string[] {
  const tokens = seg.split(/\s+/).filter(Boolean);
  if (tokens.length <= 3) return [seg];
  const stripped = tokens.map((t) => t.replace(/[\d∗*†‡§¶○●]+$/u, ""));
  const isCap = stripped.map((t) => /^[A-Z\p{Lu}]/u.test(t));
  const allCap = isCap.every(Boolean);
  if (!allCap) return [seg];
  const groups: string[] = [];
  let i = 0;
  while (i < stripped.length) {
    const t = stripped[i];
    if (/^[A-Z]\.?$/.test(t) && i + 1 < stripped.length) {
      groups.push([t, stripped[i + 1]].join(" "));
      i += 2;
      continue;
    }
    if (i + 1 < stripped.length) {
      groups.push([t, stripped[i + 1]].join(" "));
      i += 2;
      continue;
    }
    groups.push(t);
    i += 1;
  }
  return groups;
}

function cleanNameToken(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeNameLine(line: string): boolean {
  const tokens = line.split(/\s+/);
  if (tokens.length < 2) return false;
  const stripped = tokens.map((t) =>
    t.replace(/[\d∗*†‡§¶○●,;.]+$/u, "").replace(/^,/, "").trim(),
  );
  const lettersOnly = stripped.filter((t) => /^[A-Z\p{Lu}][\p{L}'.\-]*$/u.test(t)).length;
  if (lettersOnly >= 2) return true;
  if (/[一-鿿]{2,}/.test(line)) return true;
  return false;
}

// Connector / preposition / verb tokens that indicate a sentence fragment
// rather than a name. "Forest. On the position-offset split", "Anomaly
// Detection for", "VANET Message Streams" all leak through the casing-only
// gate but are obviously not personal names.
const SENTENCE_FRAGMENT_TOKEN_RE =
  /^(for|of|in|on|to|by|via|with|under|over|and|the|or|as|from|into|using|under|toward|towards|across|against|about|when|where|while|since|because|that|which|whose|than|then|than|but|nor|so|yet)$/i;

function isPlausibleName(name: string): boolean {
  // Strip footnote markers and trailing punctuation for the check
  const { base: rawBase } = stripFootnoteSuffix(name);
  const base = rawBase.replace(/[.,;:!?]+$/, "").trim();
  const tokens = base.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  if (tokens.length > 6) return false;
  if (base.length < 3 || base.length > 80) return false;
  if (TITLE_NOISE_RE.test(base)) return false;
  if (AFFILIATION_RE.test(base)) return false;
  if (CORP_SUFFIX_RE.test(base)) return false;
  if (COUNTRY_OR_CITY_STOPWORDS.has(base)) return false;
  // Sentence-fragment guards: "Forest. On the position-offset split" and
  // friends are abstract-body wraps that the boundary scan didn't catch.
  // (1) Mid-string "lower-case word + period + space + capital" is a
  //     sentence boundary, never a name.
  if (/[a-z]\.\s+[A-Z]/.test(base)) return false;
  // (2) Any non-CJK token that's a connector / preposition / verb is a
  //     give-away the line is prose ("Anomaly Detection for", "Message
  //     Streams" passes — but "in / on / for / and" prepositions don't).
  const hasConnector = tokens.some((t) => SENTENCE_FRAGMENT_TOKEN_RE.test(t));
  if (hasConnector && !/[一-鿿]{2,}/.test(base)) return false;
  // Reject single-token "names" — almost always a country, city, or corp remnant.
  if (tokens.length === 1 && !/[一-鿿]{2,}/.test(base)) return false;
  // At least one token must look like a capitalized word with ≥2 letters,
  // or contain CJK characters.
  const hasCapWord = tokens.some((t) =>
    /^[A-Z\p{Lu}][\p{L}'.\-]{1,}$/u.test(t),
  );
  if (!hasCapWord && !/[一-鿿]{2,}/.test(base)) return false;
  return true;
}

export function dedupAuthorWithFootnoteSuffix(names: string[]): string[] {
  const seen = new Map<string, string>();
  const order: string[] = [];
  for (const raw of names) {
    const { base } = stripFootnoteSuffix(raw);
    const key = base.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key) continue;
    if (seen.has(key)) {
      // Keep the more informative form (the one with footnote markers, since
      // it lets us look up affiliations).
      const prev = seen.get(key)!;
      const prevHasMarker = stripFootnoteSuffix(prev).markers.length > 0;
      const rawHasMarker = stripFootnoteSuffix(raw).markers.length > 0;
      if (rawHasMarker && !prevHasMarker) {
        const idx = order.indexOf(prev);
        if (idx >= 0) order[idx] = raw;
        seen.set(key, raw);
      }
      continue;
    }
    seen.set(key, raw);
    order.push(raw);
  }
  return order;
}

function extractAllOrcids(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ORCID_REGEX.lastIndex = 0;
  while ((m = ORCID_REGEX.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}
