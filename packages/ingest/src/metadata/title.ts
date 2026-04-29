/**
 * Title detection: pick the first plausible title-like line in the (preamble-stripped)
 * header, optionally merging a hyphen-wrapped or function-word-broken continuation.
 */

import { AFFILIATION_RE } from "./affiliations.js";

export const TITLE_NOISE_RE =
  /(permission|attribution|copyright|all rights reserved|license|hereby grants|©|arxiv:|preprint|under review|in press)/i;

export function extractTitle(lines: string[]): string | null {
  const horizon = Math.min(lines.length, 25);
  for (let i = 0; i < horizon; i += 1) {
    let candidate = lines[i];
    if (!candidateLooksLikeTitle(candidate)) continue;

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

export function candidateLooksLikeTitle(line: string): boolean {
  if (line.length < 6 || line.length > 250) return false;
  if (TITLE_NOISE_RE.test(line)) return false;
  if (/^abstract$/i.test(line)) return false;
  if (/^doi[: ]/i.test(line)) return false;
  if (/^https?:\/\//i.test(line)) return false;
  if (AFFILIATION_RE.test(line) && line.split(/\s+/).length < 8) return false;
  // CJK-dominant lines (no whitespace tokenization) of plausible title length
  // are accepted directly. The Latin "≥2 tokens" rule below would otherwise
  // reject Chinese titles like "深度学习中的对抗鲁棒性" and the next-line
  // author byline would get promoted to title by mistake.
  const cjkChars = (line.match(/[\u3400-\u9fff]/g) ?? []).length;
  if (cjkChars >= 4 && cjkChars / line.length >= 0.5) {
    return true;
  }
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  // Letter-spaced banner text such as "R E S E A R C H  A R T I C L E" or
  // "M E T H O D S  A R T I C L E" appears verbatim near the top of many
  // single-column journal templates (J Ind Ecol, Wiley, etc.) and used to
  // get promoted to the title because it satisfies all the other gates.
  const singleCharTokens = tokens.filter((t) => t.length === 1).length;
  if (tokens.length >= 4 && singleCharTokens / tokens.length >= 0.6) return false;
  if (/^[a-z]/.test(line) && !/^[a-z]+\s+[A-Z]/.test(line)) return false;
  return true;
}

export function shouldMergeTitleContinuation(curr: string, next: string): boolean {
  if (TITLE_NOISE_RE.test(next)) return false;
  if (next.length > 100) return false;
  if (/^abstract$/i.test(next)) return false;
  // Hyphen-wrap is unambiguous evidence the title continues.
  if (curr.endsWith("-")) {
    return !looksLikeAuthorListLine(next);
  }
  if (looksLikeAuthorListLine(next)) return false;
  if (AFFILIATION_RE.test(next) && next.split(/\s+/).length <= 6) return false;
  // Title broken on a function word: "BERT: ... Transformers for" + "Language Understanding".
  if (/\b(of|for|and|with|to|in|on|via|using|under|over|by)$/i.test(curr)) {
    return next.length <= 80;
  }
  // Title-cased + no-terminal-punct case. To avoid merging an author byline
  // ("Actual Research Title" + "Alice Smith"), require BOTH:
  //   - curr is a long-ish title (≥6 tokens) — short titles followed by short
  //     capitalized lines are almost always the author byline pattern
  //   - next is a clear title continuation (≤4 tokens, no person-name shape)
  // This still merges real wraps like "Learnable Graph ODE Networks for
  // Anomaly Detection in CAN-FD" + "Vehicle Networks".
  const noTerminal = !/[.!?]$/.test(curr);
  const nextTokens = next.split(/\s+/).filter(Boolean);
  const nextLooksTitle = /^[A-Z\p{Lu}]/u.test(next) && nextTokens.length <= 4;
  const currTokens = curr.split(/\s+/).filter(Boolean).length;
  const currLongTitle = currTokens >= 6 && mostlyCapitalized(curr);
  return noTerminal && nextLooksTitle && currLongTitle && next.length <= 60;
}

export function looksLikeAuthorListLine(line: string): boolean {
  const tokens = line.split(/\s+/);
  const caps = tokens.filter((t) => /^[A-Z\p{Lu}]/u.test(t)).length;
  const hasFootnote = /[∗*†‡§¶○●]/u.test(line);
  const hasComma = /,/.test(line);
  const hasAnd = /\s+and\s+[A-Z]/.test(line);
  if (caps >= 2 && (hasFootnote || hasComma || hasAnd)) return true;
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
