// Layout-aware PDF text reader. Reads each page's TextItems with bbox info
// (via pdfjs `getTextContent`) and re-emits text in column-major order,
// instead of unpdf's default left-to-right-top-to-bottom flow which mangles
// double-column papers (the "References" header gets eaten by reading
// order, columns interleave mid-paragraph, etc.).
//
// Single-column pages fall through unchanged so we don't risk regressions
// on the dominant case. Double-column detection is conservative: only
// triggers when there are ≥ 2 well-separated clusters on the x-axis with
// substantial mass on each side.
//
// This is a *targeted* fix — only call this when the regular splitter has
// signaled trouble (`needsLlmFallback`, or fewer refs than expected). For
// the dominant single-column case unpdf's flat extractor is fine.

import { getDocumentProxy } from "unpdf";
import type { ExtractedDocument, ExtractedPage } from "./types.js";

interface PdfTextItem {
  str: string;
  // pdfjs transform: [a, b, c, d, e, f] — 2D affine. e = x, f = y in PDF
  // coordinates (origin bottom-left, y increases upward).
  transform: number[];
  width: number;
  height: number;
}

interface PageItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const COLUMN_GAP_RATIO = 0.08; // gap between columns ≥ 8% of page width
const LINE_BREAK_RATIO = 0.6; // y-jump > 0.6× line height ⇒ newline
const PARAGRAPH_BREAK_RATIO = 1.6; // y-jump > 1.6× ⇒ blank line

export async function extractPdfLayoutAware(
  buffer: Buffer,
): Promise<ExtractedDocument | null> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const warnings: string[] = [];
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(data);
    const pageCount = pdf.numPages ?? 0;
    if (pageCount === 0) return null;
    const pages: ExtractedPage[] = [];
    for (let i = 1; i <= pageCount; i++) {
      try {
        const page = await pdf.getPage(i);
        const view = page.view as number[]; // [x0, y0, x1, y1]
        const pageWidth = Math.max(1, (view?.[2] ?? 0) - (view?.[0] ?? 0));
        const tc = await page.getTextContent();
        const items: PageItem[] = [];
        for (const raw of tc.items as PdfTextItem[]) {
          if (typeof raw?.str !== "string" || raw.str.length === 0) continue;
          const transform = raw.transform;
          if (!Array.isArray(transform) || transform.length < 6) continue;
          items.push({
            str: raw.str,
            x: transform[4],
            y: transform[5],
            width: raw.width ?? 0,
            height: raw.height ?? Math.abs(transform[3] ?? 12),
          });
        }
        if (items.length === 0) {
          pages.push({ index: i, text: "" });
          continue;
        }
        const columns = detectColumns(items, pageWidth);
        const text = renderPageItems(items, columns);
        pages.push({ index: i, text: cleanPageText(text) });
      } catch (err) {
        warnings.push(`pdf-layout page ${i} failed: ${describe(err)}`);
        pages.push({ index: i, text: "" });
      }
    }
    const fullText = pages.map((p) => p.text).join("\n\n");
    return {
      fullText,
      pages,
      metadata: {},
      source: "pdf",
      ocrUsed: false,
      warnings,
    };
  } catch (err) {
    return null;
  } finally {
    await pdf?.destroy?.();
  }
}

interface ColumnInfo {
  count: 1 | 2;
  splitX?: number; // left/right boundary in PDF coords
}

/**
 * Detect 1- vs 2-column layout by looking at the distribution of item.x
 * positions. Walks consecutive (xs[i], xs[i+1]) pairs and picks the largest
 * gap whose midpoint sits in the central band [pageWidth*0.3, pageWidth*0.7].
 * Requires the gap ≥ COLUMN_GAP_RATIO of pageWidth and ≥ 25% of items on
 * each side of the split.
 */
function detectColumns(items: PageItem[], pageWidth: number): ColumnInfo {
  if (items.length < 30) return { count: 1 };
  const xs = items.map((it) => it.x).sort((a, b) => a - b);
  const lo = pageWidth * 0.3;
  const hi = pageWidth * 0.7;
  let bestSplit: number | null = null;
  let bestGap = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const x = xs[i];
    const next = xs[i + 1];
    const mid = (x + next) / 2;
    if (mid < lo || mid > hi) continue;
    const gap = next - x;
    if (gap > bestGap) {
      bestGap = gap;
      bestSplit = mid;
    }
  }
  if (bestSplit === null || bestGap < pageWidth * COLUMN_GAP_RATIO) {
    return { count: 1 };
  }
  // Sanity: ≥ 25% of items on each side
  const leftCount = items.filter((it) => it.x < bestSplit!).length;
  const rightCount = items.length - leftCount;
  if (
    leftCount < items.length * 0.25 ||
    rightCount < items.length * 0.25
  ) {
    return { count: 1 };
  }
  return { count: 2, splitX: bestSplit };
}

function renderPageItems(items: PageItem[], cols: ColumnInfo): string {
  if (cols.count === 1) {
    return renderColumn([...items]);
  }
  const splitX = cols.splitX!;
  const left: PageItem[] = [];
  const right: PageItem[] = [];
  for (const it of items) {
    if (it.x < splitX) left.push(it);
    else right.push(it);
  }
  // Concatenate columns top-to-bottom: left column first, then right column.
  return `${renderColumn(left)}\n\n${renderColumn(right)}`;
}

function renderColumn(items: PageItem[]): string {
  if (items.length === 0) return "";
  // Sort by y-desc (top of page first), then x-asc.
  items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const out: string[] = [];
  let prev: PageItem | null = null;
  for (const it of items) {
    if (prev) {
      const dy = prev.y - it.y;
      const lineHeight = Math.max(prev.height, it.height, 8);
      if (dy > lineHeight * PARAGRAPH_BREAK_RATIO) {
        out.push("\n\n");
      } else if (dy > lineHeight * LINE_BREAK_RATIO) {
        out.push("\n");
      } else {
        // Same line — pdfjs TextItems often arrive without trailing space.
        // Add a space if the previous fragment didn't end with one.
        const last = out[out.length - 1] ?? "";
        const lastChar = last.slice(-1);
        if (lastChar && !/\s/.test(lastChar)) out.push(" ");
      }
    }
    out.push(it.str);
    prev = it;
  }
  return out.join("").replace(/[ \t]{2,}/g, " ").trim();
}

function cleanPageText(text: string): string {
  return text
    .replace(/[     ]/g, " ")
    .replace(/\r/g, "")
    .replace(/-\n([a-z一-鿿])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Exported for unit tests so we can sanity-check the detector without
// constructing a real PDF.
export const _internal = { detectColumns, renderColumn };
