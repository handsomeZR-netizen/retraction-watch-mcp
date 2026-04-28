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
  if (line.split(/\s+/).length < 2) return false;
  if (/^[a-z]/.test(line) && !/^[a-z]+\s+[A-Z]/.test(line)) return false;
  return true;
}

export function shouldMergeTitleContinuation(curr: string, next: string): boolean {
  if (TITLE_NOISE_RE.test(next)) return false;
  if (next.length > 100) return false;
  if (/^abstract$/i.test(next)) return false;
  if (curr.endsWith("-")) {
    return !looksLikeAuthorListLine(next);
  }
  if (looksLikeAuthorListLine(next)) return false;
  if (AFFILIATION_RE.test(next) && next.split(/\s+/).length <= 6) return false;
  if (/\b(of|for|and|with|to|in|on|via|using|under|over|by)$/i.test(curr)) {
    return next.length <= 80;
  }
  const noTerminal = !/[.!?]$/.test(curr);
  const nextLooksTitle = /^[A-Z\p{Lu}]/u.test(next) && next.split(/\s+/).length <= 8;
  const currMostlyCap = mostlyCapitalized(curr);
  return noTerminal && nextLooksTitle && currMostlyCap && next.length <= 60;
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
