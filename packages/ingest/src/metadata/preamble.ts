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
// Lines that are obviously license / permission / copyright noise — these
// often pile up at the top of conference-style PDFs as a 5-10 line preamble.
const NOISE_LINE_RE =
  /(permission to make digital|to copy otherwise|all rights reserved|copyright\s+©|©\s*\d{4}|hereby grants?|under (?:a )?creative commons|conference[' ]s?\s+author|licensed under|preprint|under review|in press|corresponding author|e-mail address|email address|creative\s*commons\.org\/licenses|creativecommons\.org\/licenses|since january 2020 elsevier has created|covid-19 resource centre|free information in english|novel coronavirus covid-19|elsevier connect|public news and information|covid-19-related|research content|immediately available in pubmed central|publicly funded repositories|who covid database|unrestricted research re-use|acknowledg(?:e)?ment of the original source|granted for free by elsevier|remains active|^\s*science\s*direct\s*$|^\s*sciencedirect\s*$|sciencedirect\s*available online|available online at www\.sciencedirect\.com|www\.elsevier\.com\/locate|peer-review under responsibility|open access article under|published by elsevier|procedia computer science|^\s*procedia\s*$|^\s*10\.\d{4,9}\/|^\s*\d{4}-\d{3,4}|\bscientific meeting\b|\b(?:international|national|annual|world|global|ieee|acm|ifac|european|asian|american)\s+(?:conference|congress|symposium|workshop|forum|meeting|summit|seminar)\b|^\s*(?:(?:the\s+)?\d+\s*(?:st|nd|rd|th)?\s+)?(?:conference|congress|symposium|workshop|forum|meeting|summit|seminar)\b|^\s*(?:the\s+)?\d+\s*(?:st|nd|rd|th)?\s+.*\b(?:conference|meeting)\b|^\s*\([A-Z][A-Z0-9\- ]+\s+20\d{2}\)\s*$|^\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:\s*[–-]\s*\d{1,2})?,?\s+\d{4}\b|^\s*on\s+.+(?:information systems|technologies)\s+20\d{2}\s*$|^\s*(?:and\s+)?(?:information systems and technologies|health and social care information systems and technologies|social care information systems and technologies|computational intelligence|intelligence|engineering|technologies)\s+20\d{2}\s*$|^\s*(?:data engineering|quantitative management|(?:intelligent\s+)?information\s*&\s*engineering systems\s*\(kes\s+20\d{2}\)|systems\s*\(kes\s+20\d{2}\)|technologies and application|systems and applications[\"”]?|and applications|sciences innovation|information systems|scientific meeting[\"”]?)\s*$)/i;

export interface PreambleStripResult {
  /** Lines with the preamble removed; original lines if no preamble detected. */
  lines: string[];
  /** True if a preamble was found and stripped. */
  stripped: boolean;
}

export function stripPreambleSentinels(lines: string[]): PreambleStripResult {
  // First pass: skip any leading run of license/permission/copyright noise
  // lines. Conference-paper PDFs sometimes carry a 5-50 line preamble of
  // boilerplate before the real title; if we don't strip it the title
  // detector runs out of horizon and returns null.
  let firstReal = 0;
  while (
    firstReal < lines.length &&
    firstReal < 200 &&
    (NOISE_LINE_RE.test(lines[firstReal]) || lines[firstReal].length < 4)
  ) {
    firstReal += 1;
  }
  // If we skipped at least 3 obvious-noise lines, treat that as a strip.
  const noiseStripped = firstReal >= 3;
  let workingLines = noiseStripped ? lines.slice(firstReal) : lines;

  const horizon = Math.min(workingLines.length, 30);
  let preambleStart = -1;
  for (let i = 0; i < horizon; i += 1) {
    if (PREAMBLE_HEADERS_RE.test(workingLines[i])) {
      preambleStart = i;
      break;
    }
  }
  if (preambleStart < 0) {
    return { lines: workingLines, stripped: noiseStripped };
  }
  // Some Elsevier final PDFs put the real title at the very top and a
  // "Graphical Abstract" section later on the first page. In that shape the
  // section header is not a preamble, so preserve the already-seen title page.
  const earlierTitle = findNextTitleResume(workingLines, 0);
  if (earlierTitle >= 0 && earlierTitle < preambleStart) {
    return { lines: workingLines, stripped: noiseStripped };
  }
  // Re-bind for the existing Highlights logic below.
  lines = workingLines;

  // Phase 1: find the first title-like resume after the Highlights header.
  const t1 = findNextTitleResume(lines, preambleStart + 1);
  if (t1 < 0) return { lines, stripped: noiseStripped };

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
