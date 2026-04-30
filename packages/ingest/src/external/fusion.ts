import { normalizeTitle } from "@rw/core";

/**
 * Thresholds for accepting an external metadata match (Crossref / EPMC) over
 * a local extraction. From the plan §6:
 *   - normalized-title Levenshtein ratio ≥ 0.92
 *   - year within ±1
 * Both conditions are required; missing year disqualifies the match.
 */
export const TITLE_FUSION_THRESHOLD = 0.92;
export const YEAR_FUSION_TOLERANCE = 1;

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function levenshteinRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

export function normalizedTitleRatio(a: string, b: string): number {
  return levenshteinRatio(normalizeTitle(a), normalizeTitle(b));
}

export function acceptFusionMatch(
  local: { title: string | null; year: number | null },
  external: { title: string | null; year: number | null },
): { accept: boolean; titleRatio: number; yearDelta: number | null; reason?: string } {
  if (!local.title || !external.title) {
    return { accept: false, titleRatio: 0, yearDelta: null, reason: "missing_title" };
  }
  const titleRatio = normalizedTitleRatio(local.title, external.title);
  if (titleRatio < TITLE_FUSION_THRESHOLD) {
    return { accept: false, titleRatio, yearDelta: null, reason: "title_below_threshold" };
  }
  if (local.year == null || external.year == null) {
    return { accept: false, titleRatio, yearDelta: null, reason: "missing_year" };
  }
  const yearDelta = Math.abs(local.year - external.year);
  if (yearDelta > YEAR_FUSION_TOLERANCE) {
    return { accept: false, titleRatio, yearDelta, reason: "year_above_tolerance" };
  }
  return { accept: true, titleRatio, yearDelta };
}
