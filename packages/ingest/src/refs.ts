import { extractDoi, extractPmid, extractYear, YEAR_REGEX } from "@rw/core";
import { looksLikeMetadataNoise } from "./extraction/validate-llm.js";
import type {
  ExtractedDocument,
  RawReference,
  StructuredReference,
} from "./types.js";

const SECTION_HEADERS = [
  "References",
  "REFERENCES",
  "参考文献",
  "Bibliography",
  "BIBLIOGRAPHY",
  "Cited Works",
  "Works Cited",
  "Literature Cited",
];

export interface SplitResult {
  refs: RawReference[];
  /**
   * True if the regex layer either failed to locate a References section
   * entirely, or located one but split out very few candidates. The caller
   * (screen-manuscript) checks this and may invoke an LLM-based segmenter
   * over the raw text as a fallback. The threshold is intentionally low so
   * we don't fire LLM for every paper that happens to have a small ref list.
   */
  needsLlmFallback: boolean;
  /**
   * Where in `doc.fullText` the splitter believes the References section
   * starts. -1 if neither header detection nor marker fallback found anything.
   * The LLM segmenter uses this (or the trailing 8 KB if -1) as its input
   * window so it doesn't have to digest the entire paper.
   */
  referencesStartIndex: number;
}

const LLM_FALLBACK_MIN_REFS = 3;

export function locateAndSplitReferences(doc: ExtractedDocument): SplitResult {
  const text = doc.fullText;
  if (!text) return { refs: [], needsLlmFallback: false, referencesStartIndex: -1 };
  let start = findReferencesStart(text);
  if (start < 0) start = findReferencesByMarker(text);
  if (start < 0) {
    return { refs: [], needsLlmFallback: true, referencesStartIndex: -1 };
  }
  const tail = text.slice(start);
  const trimmed = trimToReferences(tail);
  const block = unwrapBlobReferences(trimmed);
  const entries = splitEntries(block);
  const refs = entries.map((raw, index) => ({ raw: raw.trim(), index }));
  return {
    refs,
    needsLlmFallback: refs.length < LLM_FALLBACK_MIN_REFS,
    referencesStartIndex: start,
  };
}

function findReferencesStart(text: string): number {
  let bestIdx = -1;
  for (const header of SECTION_HEADERS) {
    const re = new RegExp(
      `(?:^|\\n)\\s*${escapeRegex(header)}[\\s\\d.:;,()\\-]*(?:\\n|$)`,
      "g",
    );
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > bestIdx) {
        bestIdx = match.index;
      }
    }
  }
  return bestIdx;
}

function trimToReferences(tail: string): string {
  const stopHeaders = [
    "Acknowledgements",
    "Acknowledgments",
    "Appendix",
    "Author Contributions",
    "Conflict of Interest",
    "Funding",
    "Supplementary",
    "致谢",
  ];
  let end = tail.length;
  for (const h of stopHeaders) {
    const re = new RegExp(`\\n\\s*${escapeRegex(h)}\\s*\\n`, "i");
    const m = tail.match(re);
    if (m && m.index !== undefined && m.index < end && m.index > 200) {
      end = m.index;
    }
  }
  return tail.slice(0, end);
}

// Boundary inside one giant entry where another author-year ref begins.
// Matches `". "` followed by either:
//   * Western author lists: "Lastname, F.,? Lastname, G.,? & Lastname, H. (YYYY)"
//     including 2-word surnames like "Zabalza Bribián" (very common in
//     Spanish/Portuguese citations).
//   * Org-as-author: "Ministry of X. (YYYY)" / "Nesher Israel Cement
//     Enterprises Ltd. (2014)".
// Conservative: requires a trailing parenthesized year so we won't split
// mid-title at every period.
const SURNAME_TOKEN = "[A-Z][a-zA-Z'À-ſ\\-]+(?:\\s+[A-Z][a-zA-Z'À-ſ\\-]+){0,2}";
const INITIALS_TAIL = "(?:,\\s+[A-Z]\\.?(?:\\s*[A-Z]\\.?)*)?";
const ADDITIONAL_AUTHOR = `(?:,?\\s+(?:&\\s+)?${SURNAME_TOKEN}${INITIALS_TAIL})`;
const ORG_AUTHOR =
  "(?:[A-Z][a-zA-Z'\\-]+\\s+){1,5}(?:Ltd|Inc|Corp|Co|Foundation|Department|Ministry|Office|Bureau|Institute|Authority|Council|Agency|Association)\\.?" +
  // Bare 2–5-char acronym orgs ("ISO", "IUCN", "WHO"). Safe because the
  // outer regex requires `\s*\(YYYY\)` immediately after, so a stray "USA"
  // or "NATO" mid-sentence won't trigger a split.
  "|[A-Z]{2,5}\\.?";
const AUTHOR_YEAR_INTERIOR_BOUNDARY_RE = new RegExp(
  `\\.\\s+(?=(?:${SURNAME_TOKEN}${INITIALS_TAIL}${ADDITIONAL_AUTHOR}{0,7}|${ORG_AUTHOR})\\s*\\([12]\\d{3}[a-z]?\\))`,
  "g",
);

// Each pattern describes a way a real reference can BEGIN. The cumulative
// goal is "accept anything that plausibly starts with an author or numbering,
// reject body text like 'Sales, Inventory) capable of …'". Patterns 1-2 cover
// numbered styles; 3-5 cover initial-based citations (APA / Vancouver); 6
// covers ICML/CVPR-style "Firstname Lastname, Firstname Lastname" lists; 7
// covers CJK; 8 covers org authors.
const REF_LIKE_HEAD_PATTERNS: RegExp[] = [
  /^\[\d+\]\s+/, // [1] Smith J …
  /^\d{1,3}[\.\)]\s+\S/, // 1. Smith / 1) Smith
  // APA initials with period: "Smith, J." or "Zabalza Bribián, I." or "Smith, J. K."
  /^[A-Z][a-zA-Z'À-ſ\-]+(?:\s+[A-Z][a-zA-Z'À-ſ\-]+){0,2},\s+[A-Z]\./,
  // Reversed-order initials-first: "W. U. Ahmad, S. Narenthiran, …"
  /^(?:[A-Z]\.\s*){1,3}[A-Z][a-zA-Z'À-ſ\-]+,\s+(?:[A-Z]\.\s*){1,3}[A-Z][a-zA-Z'À-ſ\-]+/,
  // First name spelt out + comma/paren terminator: "Smith, John, Inc," or "Smith, John (2020)"
  /^[A-Z][a-zA-Z'À-ſ\-]+(?:\s+[A-Z][a-zA-Z'À-ſ\-]+){0,2},\s+[A-Z][a-zA-Z]+\s*[\(,]/,
  // Vancouver concatenated initials: "Smith JK." / "Smith JK," / "Smith A and Doe B"
  /^[A-Z][a-zA-Z'À-ſ\-]+(?:\s+[A-Z][a-zA-Z'À-ſ\-]+)?\s+[A-Z]{1,3}(?:[\.,]|\s+(?:and|&)\s+)/,
  // ML-paper style "Firstname Lastname, Firstname Lastname, …" — requires
  // ≥3 such name pairs in the head so single phrases like "United States,
  // Saudi Arabia, the UK" don't slip through. The repeated `\s+[A-Z][a-zA-Z'\-]+`
  // captures 2-word combos; the third repeat anchors it as a real author list.
  /^[A-Z][a-zA-Z'À-ſ\-]+(?:\s+[A-Z][a-zA-Z'À-ſ\-]+)?,\s+[A-Z][a-zA-Z'À-ſ\-]+(?:\s+[A-Z][a-zA-Z'À-ſ\-]+)?,\s+(?:and\s+)?[A-Z][a-zA-Z'À-ſ\-]+/,
  // CJK author: "李明,"
  /^[一-鿿]{2,4}[,，\s]/,
  // Org-as-author: "Ministry of Health (2020)"
  /^(?:[A-Z][a-z]+\s+){1,5}(?:Ltd|Inc|Corp|Foundation|Ministry|Department|Bureau|Institute|Authority|Council|Agency|Association)\b/,
  // Bare-acronym org-as-author: "ISO. (2006)" / "IUCN. (2021)" / "WHO (2019)".
  // Required follow-up by `(YYYY)` keeps stray mid-sentence acronyms out.
  /^[A-Z]{2,5}\.?\s*\([12]\d{3}/,
];

function isLikelyReference(s: string): boolean {
  // A ref must (a) have an identifying timestamp/identifier and (b) start
  // with a recognizable author/numbering shape. The same heuristic used to
  // happen implicitly via `length > 25 && /\d{4}/`, but that admitted body
  // text from un-trimmed appendix sections (any paragraph with a year in it).
  if (s.length < 30) return false;
  const hasYear = /\b(?:19|20)\d{2}\b/.test(s);
  const hasDoi = /10\.\d{4,9}\//.test(s);
  const hasPmid = /\bPMID:\s*\d+/i.test(s);
  if (!hasYear && !hasDoi && !hasPmid) return false;
  const head = s.slice(0, 120);
  return REF_LIKE_HEAD_PATTERNS.some((re) => re.test(head));
}

// When an entry is overlong AND contains an interior author-year boundary,
// split it into sub-refs. Threshold of 350 is set just above the length of
// a typical full-title APA entry — a real well-formed single ref rarely
// contains ". Lastname, F. (YYYY)" inside its title/journal portion, since
// the regex demands a parenthesized year right after the author block.
function recursiveSplitOverlong(entry: string): string[] {
  if (entry.length <= 350) return [entry];
  const matches = [...entry.matchAll(AUTHOR_YEAR_INTERIOR_BOUNDARY_RE)];
  if (matches.length < 1) return [entry];
  const cuts = [0, ...matches.map((m) => (m.index ?? 0) + 1), entry.length];
  const out: string[] = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const piece = entry.slice(cuts[i], cuts[i + 1]).trim();
    if (piece) out.push(piece);
  }
  return out;
}

function splitEntries(block: string): string[] {
  const cleaned = block.replace(/\r/g, "").trim();
  const lines = cleaned.split(/\n+/);
  const lineHeadRe =
    /^\s*(?:\[(?:\d{1,3}|[A-Za-z][A-Za-z+\-]{0,12}\d{2,4}[a-z]?)\]|\(\d{1,3}\)|\d{1,3}\.)\s+/;
  const isNumberedByLine =
    lines.slice(0, 40).filter((l) => lineHeadRe.test(l)).length >= 4;

  if (isNumberedByLine) {
    const out: string[] = [];
    let current = "";
    for (const line of lines) {
      if (lineHeadRe.test(line)) {
        if (current.trim()) out.push(current);
        current = line.replace(lineHeadRe, "");
      } else {
        current += " " + line.trim();
      }
    }
    if (current.trim()) out.push(current);
    return finalizeEntries(out);
  }

  const authorYearOut = splitAuthorYear(lines);
  if (authorYearOut.length >= 4) return finalizeEntries(authorYearOut);

  const flat = cleaned.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const inlineNumberedRe =
    /(?:^|[\.\)\s])(?:\[(\d{1,3})\]|(\d{1,3})\.)(?=\s+[A-Z][a-zA-Z'\-]+(?:,|\s+[A-Z]))/g;
  const matches = [...flat.matchAll(inlineNumberedRe)];
  if (matches.length >= 4) {
    const out: string[] = [];
    for (let i = 0; i < matches.length; i += 1) {
      const start = matches[i].index ?? 0;
      const end = i + 1 < matches.length ? matches[i + 1].index ?? flat.length : flat.length;
      out.push(
        fixSplitDoi(
          flat.slice(start, end).replace(/^[\.\)\s]*/, "").replace(lineHeadRe, "").trim(),
        ),
      );
    }
    return finalizeEntries(out);
  }

  const blocks = cleaned
    .split(/\n{2,}/)
    .map((b) => fixSplitDoi(b.replace(/\n/g, " ").replace(/\s+/g, " ").trim()));
  return finalizeEntries(blocks);
}

// Common post-processing: for each candidate entry, run recursive split on
// embedded author-year boundaries (catches concatenations the outer
// splitter missed), then drop entries that don't look like references at
// all. Without this filter, body text from un-trimmed appendix sections
// can leak through whenever it happens to contain a 4-digit year.
function finalizeEntries(entries: string[]): string[] {
  const expanded: string[] = [];
  for (const entry of entries) {
    const cleaned = fixSplitDoi(entry.replace(/\s+/g, " ").trim());
    if (cleaned.length <= 25) continue;
    for (const piece of recursiveSplitOverlong(cleaned)) {
      expanded.push(piece);
    }
  }
  return expanded.filter(isLikelyReference);
}

function splitAuthorYear(rawLines: string[]): string[] {
  const lines = rawLines
    .map((l) =>
      l
        .replace(/^\s*(?:References?|REFERENCES|Bibliography|参考文献)[\d\s.:;,()\-]*$/i, "")
        .replace(/(\d{1,4})\s*$/, "")
        .trim(),
    )
    .filter(Boolean);

  const isAuthorStart = (l: string): boolean => {
    if (l.length < 8) return false;
    if (/^\[(?:\d{1,3}|[A-Za-z][A-Za-z+\-]{0,12}\d{2,4}[a-z]?)\]\s+/.test(l)) return true;
    if (/^[A-Z][a-zA-Z'\-]+,\s+[A-Z]\.?/.test(l)) return true;
    if (/^[A-Z][a-zA-Z'\-]+,\s*[A-Z][a-z]?\.\s*[A-Z]?\.?,/.test(l)) return true;
    if (/^[A-Z][a-z]+\s+[A-Z][a-zA-Z'\-]+(?:,|\s+and\s+|\s+et\s+al)/.test(l)) return true;
    if (/^[A-Z][a-z]+\s+[A-Z][a-zA-Z'\-]+\.\s/.test(l)) return true;
    if (/^[\u4e00-\u9fff]{2,4}[,，\s]/.test(l)) return true;
    // Reversed-order initials-first: "W. U. Ahmad, S. Narenthiran, ..."
    if (/^(?:[A-Z]\.\s*){1,3}[A-Z][a-zA-Z'\-]+,\s+(?:[A-Z]\.\s*){1,3}[A-Z]/.test(l)) return true;
    return false;
  };

  const out: string[] = [];
  let current = "";
  for (const l of lines) {
    if (isAuthorStart(l) && current.trim()) {
      out.push(current.trim());
      current = l;
    } else {
      current = current ? current + " " + l : l;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out
    .map((s) => fixSplitDoi(s.replace(/\s+/g, " ").trim()))
    .filter((s) => s.length > 30 && /\d{4}/.test(s));
}

function fixSplitDoi(text: string): string {
  return text.replace(
    /(10\.\d{4,9}\/[\w./-]*?)\s+([a-z0-9][\w./-]*)/gi,
    (full, head: string, tail: string) => {
      if (/\s/.test(tail)) return full;
      if (head.length + tail.length > 120) return full;
      return head + tail;
    },
  );
}

export function regexStructure(refs: RawReference[]): {
  structured: StructuredReference[];
  unresolved: RawReference[];
} {
  const structured: StructuredReference[] = [];
  const unresolved: RawReference[] = [];
  for (const ref of refs) {
    const doi = extractDoi(ref.raw);
    const pmid = extractPmid(ref.raw);
    if (doi || pmid) {
      structured.push(structureReferenceHeuristic(ref, doi ? "regex_doi" : "regex_pmid"));
    } else {
      unresolved.push(ref);
    }
  }
  return { structured, unresolved };
}

export function heuristicStructureReferences(refs: RawReference[]): StructuredReference[] {
  return refs.map((ref) => structureReferenceHeuristic(ref, "regex_text"));
}

function structureReferenceHeuristic(
  ref: RawReference,
  source: "regex_doi" | "regex_pmid" | "regex_text",
): StructuredReference {
  return {
    raw: ref.raw,
    title: heuristicTitle(ref.raw),
    authors: heuristicAuthors(ref.raw),
    year: extractYear(ref.raw),
    doi: extractDoi(ref.raw),
    pmid: extractPmid(ref.raw),
    journal: heuristicJournal(ref.raw),
    source,
  };
}

function heuristicTitle(text: string): string | null {
  const yearMatch = text.match(YEAR_REGEX);
  let after = text;
  if (yearMatch && yearMatch.index !== undefined) {
    let offset = yearMatch.index + yearMatch[0].length;
    if (/^[a-z](?=[)\]\.,:;])/i.test(text.slice(offset))) {
      offset += 1;
    }
    after = text.slice(offset);
  }
  after = after.replace(/^[\s\)\]\.,:;]+/, "");
  const firstChunk = after.split(/[\.\?]\s+(?=[A-Z一-鿿])/)[0] ?? after;
  const cleaned = firstChunk.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  // Reject metadata-noise candidates ("57(6): 365-88", "1-4.", etc.) so the
  // downstream Crossref title-search step doesn't waste a request on garbage.
  // The LLM merge step will fill in a real title later when one is available.
  if (looksLikeMetadataNoise(cleaned)) return null;
  return cleaned.length > 250 ? cleaned.slice(0, 250) : cleaned;
}

function heuristicAuthors(text: string): string[] {
  const yearMatch = text.match(YEAR_REGEX);
  let head = text;
  if (yearMatch && yearMatch.index !== undefined) {
    head = text.slice(0, yearMatch.index);
  }
  head = head.replace(/^\s*\[\d+\]\s*/, "").replace(/[\s(\[]+$/, "").trim();
  if (!head) return [];
  const parts = head
    .split(/,\s+|;\s+|\band\s+|&\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1 && p.length < 80);
  const names: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (/^\s*[A-Z]\.?(?:\s*[A-Z]\.?)*\s*$/.test(part) && names.length > 0) {
      names[names.length - 1] = `${names[names.length - 1]} ${part}`.trim();
    } else if (/[A-Za-z一-鿿]/.test(part)) {
      names.push(part);
    }
    if (names.length >= 8) break;
  }
  return names;
}

function heuristicJournal(text: string): string | null {
  const titleStart = heuristicTitle(text);
  if (!titleStart) return null;
  const idx = text.indexOf(titleStart);
  if (idx < 0) return null;
  const after = text.slice(idx + titleStart.length);
  const m = after.match(/[\.\?]\s*([A-Z][^\.,;]{3,80})[\.,]/);
  return m ? m[1].trim() : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Header-less fallback: when `findReferencesStart` failed (typical for
 * double-column PDFs whose "References" header was eaten by column-reading
 * order), scan the trailing portion of the document for a sustained
 * numbered-reference marker pattern and return its starting offset.
 *
 * Conservatism guards:
 *  - Only the last 50% of the document is considered (refs are always at the
 *    end; biasing here avoids matching e.g. "[1]" inside the introduction's
 *    own citations).
 *  - Requires ≥3 markers numbered roughly monotonically within a 4 KB window
 *    (so a single stray bracket doesn't qualify).
 */
export function findReferencesByMarker(text: string): number {
  if (text.length < 400) return -1;
  const tailStart = Math.floor(text.length * 0.5);
  const tail = text.slice(tailStart);

  const markerRe = /(?:^|[\s\)\]\.])(?:\[(\d{1,3})\]|(\d{1,3})\.)\s+(?=[A-Z一-鿿])/g;
  type Hit = { idx: number; n: number };
  const hits: Hit[] = [];
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(tail)) !== null) {
    const n = Number(match[1] ?? match[2]);
    if (Number.isFinite(n) && n >= 1 && n <= 999) {
      hits.push({ idx: match.index, n });
    }
  }
  if (hits.length < 3) return -1;

  // Find the first hit that begins a monotonically-increasing run of ≥3
  // markers within a 4 KB window. Allow some tolerance: numbering may skip
  // (e.g. "1, 3, 4" if pdf reading dropped a line), but must overall ascend.
  for (let i = 0; i + 2 < hits.length; i += 1) {
    const a = hits[i];
    const b = hits[i + 1];
    const c = hits[i + 2];
    if (c.idx - a.idx > 4000) continue;
    if (a.n < b.n && b.n < c.n && a.n <= 5) {
      // anchored on a small starting number (1–5) so we don't latch onto a
      // citation cluster like "[34], [35], [36]" inside the discussion.
      return tailStart + a.idx;
    }
  }
  return -1;
}

/**
 * Pre-processing step before `splitEntries` runs: when unpdf returns the
 * References section as a single line with no internal `\n`, the line-based
 * splitter paths can't find boundaries. Insert a `\n` before each `<digit>.`
 * or `[<digit>]` marker that's followed by a capital letter.
 *
 * Only triggers when the block is "obviously a blob": >3 KB long, near-zero
 * newline density, and ≥5 numbered markers detectable. Otherwise pass through.
 */
export function unwrapBlobReferences(block: string): string {
  if (block.length < 3000) return block;
  const newlines = (block.match(/\n/g) ?? []).length;
  if (newlines / block.length > 0.001) return block;
  const markerRe = / (\d{1,3}\.\s+|\[\d+\]\s+)(?=[A-Z一-鿿])/g;
  const matches = block.match(markerRe);
  if (!matches || matches.length < 5) return block;
  return block.replace(markerRe, (m) => "\n" + m.trimStart());
}
