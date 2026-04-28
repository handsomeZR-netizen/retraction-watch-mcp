/**
 * Strip Elsevier preprint preambles (Highlights, Graphical Abstract, Article Info)
 * that appear before the actual title page.
 *
 * Elsevier preprints typically start with a Highlights page that contains:
 *   - "Highlights" header
 *   - Repeat of the title (one-line)
 *   - Repeat of the author list (no footnote markers)
 *   - 4-8 bullet points summarizing key contributions
 * The real title page (with footnote-marked authors and affiliation list) follows.
 *
 * If we naively strip only up to the first title-like resume, we keep the bullet
 * block + author summary, which leaks bullet text into name parsing. The fix:
 * skip past the bullets and find the *second* title-like resume.
 */

const PREAMBLE_HEADERS_RE =
  /^(highlights?|graphical abstract|graphical-abstract|article info(?:rmation)?|article history)\b\s*[:：]?\s*$/i;
const BULLET_LINE_RE = /^[•◦▪●○■□–—\-*]\s/;

export interface PreambleStripResult {
  /** Lines with the preamble removed; original lines if no preamble detected. */
  lines: string[];
  /** True if a preamble was found and stripped. */
  stripped: boolean;
}

export function stripPreambleSentinels(lines: string[]): PreambleStripResult {
  const horizon = Math.min(lines.length, 30);
  let preambleStart = -1;
  for (let i = 0; i < horizon; i += 1) {
    if (PREAMBLE_HEADERS_RE.test(lines[i])) {
      preambleStart = i;
      break;
    }
  }
  if (preambleStart < 0) return { lines, stripped: false };

  // Phase 1: find the first title-like resume after the Highlights header.
  const t1 = findNextTitleResume(lines, preambleStart + 1);
  if (t1 < 0) return { lines, stripped: false };

  // Phase 2: skip all bullet lines + their lowercase-prefixed continuation
  // lines that follow the highlights summary title/author. End when we either
  // run out of bullets or hit another preamble header.
  let cursor = t1 + 1;
  const sawBullet = (i: number) => i < lines.length && BULLET_LINE_RE.test(lines[i]);
  const bulletContinuation = (i: number) =>
    i < lines.length &&
    /^[a-z]/.test(lines[i]) &&
    !/^[a-z]+\s+[A-Z]/.test(lines[i]);
  while (cursor < lines.length) {
    if (sawBullet(cursor) || bulletContinuation(cursor)) {
      cursor += 1;
      continue;
    }
    // 1-2 short non-bullet lines may sit between bullets; peek ahead — if we
    // still see a bullet within 2 lines, skip them.
    if (
      cursor + 1 < lines.length &&
      (sawBullet(cursor + 1) || sawBullet(cursor + 2))
    ) {
      cursor += 1;
      continue;
    }
    break;
  }

  // Phase 3: find the next title-like line *after* the bullet block. That's
  // where the real article header begins. If no second title is found, fall
  // back to t1 (current behavior — at least we got past the Highlights header).
  const t2 = findNextTitleResume(lines, cursor);
  const startAt = t2 >= 0 ? t2 : t1;

  if (startAt >= lines.length) return { lines, stripped: false };
  return { lines: lines.slice(startAt), stripped: true };
}

function findNextTitleResume(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i += 1) {
    if (looksLikeTitleResume(lines[i], lines, i)) return i;
  }
  return -1;
}

function looksLikeTitleResume(line: string, all: string[], idx: number): boolean {
  if (!line) return false;
  if (BULLET_LINE_RE.test(line)) return false;
  if (line.length < 6) return false;
  if (PREAMBLE_HEADERS_RE.test(line)) return false;
  if (/^[a-z]/.test(line) && !/^[a-z]+\s+[A-Z]/.test(line)) return false;
  if (/^[a-z][A-Z]/.test(line)) return false;
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  const prev = all[idx - 1];
  if (prev && BULLET_LINE_RE.test(prev) && /^[a-z]/.test(line)) return false;
  return true;
}
