import { EMAIL_REGEX, ORCID_REGEX, extractDoi } from "@rw/core";
import type {
  ExtractMetadataInput,
  ManuscriptAuthor,
  ManuscriptHeaderMeta,
} from "./types.js";

const TITLE_NOISE_RE = /(permission|attribution|copyright|all rights reserved|license|hereby grants|©|arxiv:|preprint|under review|in press)/i;
const AFFILIATION_RE = /\b(University|Institute|College|Hospital|Laborator(y|ies)|Department|School|Center|Centre|Faculty|大学|学院|医院|研究所|研究院|实验室|系)\b/i;
const ABSTRACT_BOUNDARY_RE = /^(abstract|摘要|关键词|keywords?|introduction|1\s+introduction|引言)$/i;
const NAME_TOKEN_RE = /^([A-Z][\p{L}'.\-]*\.?)$/u;

export function extractHeaderMetadata(input: ExtractMetadataInput): ManuscriptHeaderMeta {
  const text = headerSlice(input);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const title = extractTitle(lines);
  const doi = extractDoi(text);
  const authors = extractAuthors(lines, text);

  return {
    title,
    doi,
    authors,
    abstract: extractAbstract(input.fullText),
  };
}

function headerSlice(input: ExtractMetadataInput): string {
  if (input.pages.length > 0) {
    return input.pages.slice(0, 2).map((p) => p.text).join("\n");
  }
  return input.fullText.slice(0, 8000);
}

function extractTitle(lines: string[]): string | null {
  const horizon = Math.min(lines.length, 20);
  for (let i = 0; i < horizon; i += 1) {
    let candidate = lines[i];
    if (!candidateLooksLikeTitle(candidate)) continue;

    // Merge with next line if title is hyphenated (e.g. "LARGE LAN-" + "GUAGE MODELS")
    // or if the current line is title-cased without terminal punctuation and next line continues it.
    const next = lines[i + 1];
    if (next && shouldMergeTitleContinuation(candidate, next)) {
      const merged = candidate.endsWith("-")
        ? candidate.slice(0, -1) + next
        : `${candidate} ${next}`;
      candidate = merged;
    }

    if (candidate.length >= 6 && candidate.length <= 250) {
      return candidate;
    }
  }
  return null;
}

function candidateLooksLikeTitle(line: string): boolean {
  if (line.length < 6 || line.length > 250) return false;
  if (TITLE_NOISE_RE.test(line)) return false;
  if (/^abstract$/i.test(line)) return false;
  if (/^doi[: ]/i.test(line)) return false;
  if (/^https?:\/\//i.test(line)) return false;
  if (AFFILIATION_RE.test(line) && line.split(/\s+/).length < 8) return false;
  if (line.split(/\s+/).length < 2) return false;
  // Reject lines that look like sentences (e.g. start with lowercase or contain mid-line periods + lowercase)
  if (/^[a-z]/.test(line) && !/^[a-z]+\s+[A-Z]/.test(line)) return false;
  return true;
}

function shouldMergeTitleContinuation(curr: string, next: string): boolean {
  if (TITLE_NOISE_RE.test(next)) return false;
  if (next.length > 100) return false;
  if (/^abstract$/i.test(next)) return false;
  // Hyphen-wrap (LoRA: "LARGE LAN-" + "GUAGE MODELS")
  if (curr.endsWith("-")) {
    return !looksLikeAuthorListLine(next);
  }
  // Don't merge into a likely author list (multiple caps tokens + footnote/comma signals).
  if (looksLikeAuthorListLine(next)) return false;
  // Don't merge into a pure affiliation line.
  if (AFFILIATION_RE.test(next) && next.split(/\s+/).length <= 6) return false;
  // Title broken on a function word: "BERT: ... Transformers for" + "Language Understanding"
  if (/\b(of|for|and|with|to|in|on|via|using|under|over|by)$/i.test(curr)) {
    return next.length <= 80;
  }
  // Title-cased line without terminal punctuation, followed by a short continuation.
  const noTerminal = !/[.!?]$/.test(curr);
  const nextLooksTitle = /^[A-Z\p{Lu}]/u.test(next) && next.split(/\s+/).length <= 8;
  const currMostlyCap = mostlyCapitalized(curr);
  return noTerminal && nextLooksTitle && currMostlyCap && next.length <= 60;
}

function looksLikeAuthorListLine(line: string): boolean {
  const tokens = line.split(/\s+/);
  const caps = tokens.filter((t) => /^[A-Z\p{Lu}]/u.test(t)).length;
  const hasFootnote = /[∗*†‡§¶○●]/u.test(line);
  const hasComma = /,/.test(line);
  const hasAnd = /\s+and\s+[A-Z]/.test(line);
  // Footnote/comma/and signals.
  if (caps >= 2 && (hasFootnote || hasComma || hasAnd)) return true;
  // Space-separated multi-name pattern: 6+ tokens all starting with a capital,
  // arranged as pairs (likely 3+ "Firstname Lastname" pairs).
  if (tokens.length >= 6 && caps === tokens.length && tokens.length % 2 === 0) {
    return true;
  }
  return false;
}

function mostlyCapitalized(s: string): boolean {
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const caps = tokens.filter((t) => /^[A-Z\p{Lu}]/u.test(t)).length;
  return caps / tokens.length >= 0.5;
}

function extractAuthors(lines: string[], rawText: string): ManuscriptAuthor[] {
  const emails = unique(rawText.match(EMAIL_REGEX) ?? []);
  const orcids = unique(extractAllOrcids(rawText));

  const block = sliceAuthorBlock(lines);
  const names = parseNames(block);

  if (names.length === 0) {
    return emails.map((email) => ({
      name: email.split("@")[0],
      email,
      affiliation: null,
      orcid: orcids[0] ?? null,
    }));
  }

  return names.map((name, idx) => ({
    name,
    email: emails[idx] ?? null,
    orcid: orcids[idx] ?? null,
    affiliation: guessAffiliation(block, name),
  }));
}

function sliceAuthorBlock(lines: string[]): string[] {
  // Find title's last line (skip noise lines), then collect until Abstract / Introduction / numbered section.
  let titleStart = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i += 1) {
    if (candidateLooksLikeTitle(lines[i])) {
      titleStart = i;
      break;
    }
  }
  if (titleStart < 0) return lines.slice(0, 30);

  let titleEnd = titleStart;
  // Allow up to 2 continuation lines for title
  while (
    titleEnd < titleStart + 2 &&
    lines[titleEnd + 1] &&
    shouldMergeTitleContinuation(lines[titleEnd], lines[titleEnd + 1])
  ) {
    titleEnd += 1;
  }

  const block: string[] = [];
  for (let i = titleEnd + 1; i < Math.min(lines.length, titleEnd + 60); i += 1) {
    const line = lines[i];
    if (ABSTRACT_BOUNDARY_RE.test(line)) break;
    if (/^\d+\s+[A-Z][a-z]/.test(line)) break; // "1 Introduction"
    block.push(line);
  }
  return block;
}

function parseNames(blockLines: string[]): string[] {
  const collected: string[] = [];
  for (const rawLine of blockLines) {
    if (rawLine.length < 4 || rawLine.length > 400) continue;
    if (rawLine.includes("@")) continue;
    if (/^https?:\/\//i.test(rawLine)) continue;
    if (/^doi[: ]/i.test(rawLine)) continue;
    // Skip pure affiliation/department/company lines (≤4 tokens AND matches institution pattern).
    if (AFFILIATION_RE.test(rawLine) && rawLine.split(/\s+/).length <= 5) continue;
    // Skip lines that are clearly metadata, not names.
    if (/^\(.*\)$/.test(rawLine)) continue; // "(Version 2)"
    if (/^\d/.test(rawLine)) continue;       // page numbers, version codes
    if (/^[A-Z][a-z]+\s+(Brain|Research|Labs?|Inc\.?|Corp(\.|oration)?|AI)$/i.test(rawLine)) continue;
    if (/^(Microsoft|Google|Meta|Apple|IBM|Mistral|OpenAI|Anthropic|Amazon|Nvidia)\b/i.test(rawLine)) continue;

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
  return unique(collected);
}

function splitNameSegments(line: string): string[] {
  // Stage 1: comma / semicolon / "and" / "&" / "·" delimited segments
  const primary = line
    .split(/,| ; | and (?=[A-Z])| & |·|；/i)
    .map((s) => s.trim())
    .filter(Boolean);
  // Stage 2: each primary segment may still hold space-separated multi-author runs
  // (e.g. "Edward Hu Yelong Shen Phillip Wallis"). Detect by counting capitalized
  // tokens — if there are 4+ caps, re-split into 2-token name pairs.
  const out: string[] = [];
  for (const seg of primary) {
    out.push(...splitSpaceSeparatedNames(seg));
  }
  return out;
}

function splitSpaceSeparatedNames(seg: string): string[] {
  const tokens = seg.split(/\s+/).filter(Boolean);
  if (tokens.length <= 3) return [seg];

  // Strip footnote markers from each token before classification
  const stripped = tokens.map((t) => t.replace(/[\d∗*†‡§¶○●]+$/u, ""));
  const isCap = stripped.map((t) => /^[A-Z\p{Lu}]/u.test(t));
  const allCap = isCap.every(Boolean);
  if (!allCap) return [seg];

  // Group consecutive cap-starting tokens into name groups of 2-3 tokens.
  // Heuristic: if a token contains a hyphen or is short (initial like "M."),
  // it stays attached to the next; otherwise each pair = (first last).
  const groups: string[] = [];
  let i = 0;
  while (i < stripped.length) {
    const t = stripped[i];
    // Initial like "M." or "Y." → consume next token too as first name follow-up
    if (/^[A-Z]\.?$/.test(t) && i + 1 < stripped.length) {
      groups.push([t, stripped[i + 1]].join(" "));
      i += 2;
      continue;
    }
    // Compound surname: hyphenated → just one token
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
    .replace(/[\d∗*†‡§¶○●⁺⁻⁰-⁹]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeNameLine(line: string): boolean {
  const tokens = line.split(/\s+/);
  if (tokens.length < 2) return false;
  const stripped = tokens.map((t) => t.replace(/[\d∗*†‡§¶○●,;.]+$/u, "").replace(/^,/, "").trim());
  const lettersOnly = stripped.filter((t) => /^[A-Z\p{Lu}][\p{L}'.\-]*$/u.test(t)).length;
  if (lettersOnly >= 2) return true;
  if (/[一-鿿]{2,}/.test(line)) return true;
  return false;
}

function isPlausibleName(name: string): boolean {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  if (tokens.length > 6) return false;
  if (name.length < 3 || name.length > 80) return false;
  if (TITLE_NOISE_RE.test(name)) return false;
  if (AFFILIATION_RE.test(name)) return false;
  // At least one token must look like a capitalized word with ≥2 letters.
  return tokens.some((t) => /^[A-Z\p{Lu}][\p{L}'.\-]{1,}$/u.test(t)) || /[一-鿿]{2,}/.test(name);
}

function guessAffiliation(blockLines: string[], name: string): string | null {
  for (let i = 0; i < blockLines.length; i += 1) {
    if (blockLines[i].includes(name.split(/\s+/)[0])) {
      // Look at the next 1-3 lines for an affiliation signature
      for (let j = i + 1; j <= Math.min(i + 3, blockLines.length - 1); j += 1) {
        if (AFFILIATION_RE.test(blockLines[j])) return blockLines[j];
      }
    }
  }
  // Fallback: first affiliation-like line in the block
  for (const l of blockLines) {
    if (AFFILIATION_RE.test(l)) return l;
  }
  return null;
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

function extractAbstract(fullText: string): string | null {
  const m = fullText.match(/abstract\s*[\.:\-]?\s*\n?([\s\S]{20,2000}?)(?:\n\s*\n|introduction\s*\n|keywords?\s*[:：])/i);
  return m ? m[1].trim() : null;
}
