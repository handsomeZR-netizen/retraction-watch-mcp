/**
 * Title detection: pick the first plausible title-like line in the (preamble-stripped)
 * header, optionally merging a hyphen-wrapped or function-word-broken continuation.
 */

import { AFFILIATION_RE } from "./affiliations.js";

export const TITLE_NOISE_RE =
  /(permission|attribution|copyright|all rights reserved|license|hereby grants|©|arxiv:|preprint|under review|in press|reuse guidelines|sagepub\.com|^doi:)/i;

// Article-class banners that frequently appear above the real title in
// journal templates: "Research Article", "Methods Article", "Brief
// Communication", "Technical Report", "Review Article", etc. These are
// short fixed phrases so a regex match is safer than the letter-spacing
// heuristic. (Wiley uses both letter-spaced "R E S E A R C H..." and the
// concatenated "Research Article" depending on the journal.)
const TITLE_BANNER_PHRASE_RE =
  /^\s*(?:research|methods?|review|technical|brief|original|short|case|news|editorial|perspective|commentary|letter|rapid|systematic\s+review)\s+(?:article|report|communication|note|paper|method)s?\s*$/i;

// Journal-name banners — short standalone lines like "International Journal
// of Architectural Computing" or "Frontiers in Radiology" that sit above the
// real title in some PMC PDFs. Anchored to common journal-name openers; we
// only reject them when they're standalone short lines (no subtitle / no
// punctuation), so they can't shadow real titles that quote a journal name.
const TITLE_JOURNAL_BANNER_RE =
  /^\s*(?:(?:International|National|Annual|Proceedings\s+of\s+the)\s+)?(?:Journal|Frontiers|Reviews|Letters|Bulletin|Acta|Annals|Archives|Transactions|Studies|Reports)\s+(?:of|in|on)\s+[A-Z][\w\s&,'\-]{3,80}\s*$/;

// Volume / issue / page-range bibliographic lines that some templates print
// just below the journal banner: "2025, Vol. 23(1) 5–26" / "Vol. 14, No. 3"
// / "pp. 1–12". Match a few common patterns.
const TITLE_VOLUME_ISSUE_RE =
  /^\s*(?:\d{4}[,.]?\s*)?(?:Vol(?:\.|ume)?\s*\d|No\.?\s*\d|Issue\s*\d|pp?\.\s*\d|\d+\s*\(\s*\d+\s*\)\s*[\d,\s–\-]+)/i;

export function extractTitle(lines: string[]): string | null {
  const horizon = Math.min(lines.length, 25);
  for (let i = 0; i < horizon; i += 1) {
    let candidate = lines[i];
    if (!candidateLooksLikeTitle(candidate)) continue;

    // Reject journal-name banner that's split across two PDF lines —
    // "International Journal of" + "Architectural Computing" looks innocent
    // line-by-line but joins into a banner. Check both the previous-line
    // join and the candidate-on-its-own.
    if (i > 0) {
      const prev = (lines[i - 1] ?? "").trim();
      const joined = `${prev} ${candidate}`.replace(/\s+/g, " ").trim();
      if (TITLE_JOURNAL_BANNER_RE.test(joined)) continue;
    }
    const lookahead = (lines[i + 1] ?? "").trim();
    if (lookahead) {
      const joined = `${candidate} ${lookahead}`.replace(/\s+/g, " ").trim();
      if (TITLE_JOURNAL_BANNER_RE.test(joined)) continue;
    }

    // Try up to 2 wrap merges. Some titles span 3 PDF lines, e.g.
    // "Teacher Forcing as Generalized Bayes: Optimization Geometry / Mismatch
    // in Switching Surrogates / for Chaotic Dynamics".
    for (let wrap = 0; wrap < 2; wrap += 1) {
      const next = lines[i + 1 + wrap];
      if (!next || !shouldMergeTitleContinuation(candidate, next)) break;
      candidate = candidate.endsWith("-")
        ? candidate.slice(0, -1) + next
        : `${candidate} ${next}`;
    }

    if (TITLE_BANNER_PHRASE_RE.test(candidate)) continue;
    if (TITLE_JOURNAL_BANNER_RE.test(candidate)) continue;

    if (candidate.length >= 6 && candidate.length <= 250) {
      return candidate;
    }
  }
  return null;
}

export function candidateLooksLikeTitle(line: string): boolean {
  if (line.length < 6 || line.length > 250) return false;
  if (TITLE_NOISE_RE.test(line)) return false;
  if (TITLE_BANNER_PHRASE_RE.test(line)) return false;
  if (TITLE_JOURNAL_BANNER_RE.test(line)) return false;
  if (TITLE_VOLUME_ISSUE_RE.test(line)) return false;
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
  // Sentence-final period or exclamation mark is a real boundary; question
  // mark is NOT — academic titles routinely use "?" plus a descriptive
  // subtitle ("How Fast Should a Model Commit to Supervision? Training
  // Reasoning Models on the Tsallis Loss Continuum"). Only block merging
  // when next itself looks like a fresh question.
  const endsWithFinal = /[.!]$/.test(curr);
  const endsWithQuestion = /\?$/.test(curr);
  const nextLooksLikeQuestion = /\?$/.test(next);
  if (endsWithFinal) return false;
  if (endsWithQuestion && nextLooksLikeQuestion) return false;
  // After a colon ("…: Opportunities in a rapidly growing housing stock") or
  // a question ("…Supervision? Training Reasoning Models on the Tsallis Loss
  // Continuum"), a long descriptive subtitle is the norm — allow up to 10
  // continuation tokens. Unmarked wraps stay capped at 6 to avoid pulling in
  // an affiliation line by mistake.
  const endsWithColon = /:$/.test(curr);
  const nextTokens = next.split(/\s+/).filter(Boolean);
  // Cap is 10 after a colon/question (subtitle-style wraps), 8 otherwise.
  // The previous 6 was too tight for legitimate noun-phrase continuations
  // like "Mismatch in Switching Surrogates for Chaotic Dynamics" (7 tokens).
  const maxNextTokens = (endsWithColon || endsWithQuestion) ? 10 : 8;
  // Allow continuation lines that start with a lower-case connector word
  // ("for Chaotic Dynamics", "in Switching Surrogates", "and proposal for…")
  // since those are common 2nd / 3rd line patterns in long wrapped titles.
  const startsWithConnector = /^(?:for|of|in|on|to|by|via|with|under|over|and|the|using|toward|towards|across|against|from|into|about)\s/i.test(next);
  // Short noun-phrase continuations (≤3 tokens) commonly start in lowercase
  // because they're a continuation of a title like "…between greenhouse" +
  // "gas emissions". Allow them through regardless of casing.
  const isShortContinuation = nextTokens.length > 0 && nextTokens.length <= 3;
  const nextLooksTitle =
    (/^[A-Z\p{Lu}]/u.test(next) || startsWithConnector || isShortContinuation) &&
    nextTokens.length <= maxNextTokens;
  const currTokens = curr.split(/\s+/).filter(Boolean).length;
  // 4 tokens (was 6) so titles like "DV-World: Benchmarking Data Visualization"
  // still pick up the wrap. The previous mostlyCapitalized() guard was too
  // strict — academic titles like "Tradeoffs and synergy between material
  // cycles..." are mostly lowercase content words, so we only require the
  // first character to be capitalized. Author-byline filtering above already
  // covers the false-positive merge risk.
  const currLooksLikeTitle = currTokens >= 4 && /^[A-Z\p{Lu}]/u.test(curr);
  return nextLooksTitle && currLooksLikeTitle && next.length <= 120;
}

export function looksLikeAuthorListLine(line: string): boolean {
  const tokens = line.split(/\s+/);
  const caps = tokens.filter((t) => /^[A-Z\p{Lu}]/u.test(t)).length;
  const hasFootnote = /[∗*†‡§¶○●]/u.test(line);
  // Cell / J Ind Ecol style numeric superscripts: "Nolan1", "Morasae2",
  // "Michael3" — i.e. a lowercase letter immediately followed by a digit
  // inside a token. Distinguishes author bylines from titles like "Vitamin
  // B12 deficiency", where the letter before the digit is uppercase.
  const hasDigitFootnote = /\b\w*[a-z]\d+\b/.test(line);
  const hasComma = /,/.test(line);
  const hasAnd = /\s+and\s+[A-Z]/.test(line);
  if (caps >= 2 && (hasFootnote || hasDigitFootnote || hasComma || hasAnd)) return true;
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
