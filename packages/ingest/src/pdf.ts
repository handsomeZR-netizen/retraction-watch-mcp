import { extractText, getMeta } from "unpdf";
import type { ExtractedDocument, ExtractedPage } from "./types.js";

export interface PdfExtractOptions {
  ocrFallback?: (buffer: Buffer) => Promise<ExtractedDocument | null>;
}

export async function extractPdf(
  buffer: Buffer,
  options: PdfExtractOptions = {},
): Promise<ExtractedDocument> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const warnings: string[] = [];

  const [textResult, metaResult] = await Promise.allSettled([
    extractText(data, { mergePages: false }),
    getMeta(data),
  ]);

  let pages: ExtractedPage[] = [];
  let text = "";
  if (textResult.status === "fulfilled") {
    const raw = textResult.value.text;
    const pageTexts = Array.isArray(raw) ? raw : [String(raw ?? "")];
    pages = pageTexts.map((t, idx) => ({ index: idx + 1, text: cleanPageText(t) }));
    text = pages.map((p) => p.text).join("\n\n");
  } else {
    warnings.push(`unpdf extractText failed: ${describe(textResult.reason)}`);
  }

  let metadata: Record<string, unknown> = {};
  if (metaResult.status === "fulfilled") {
    metadata = (metaResult.value?.info as Record<string, unknown>) ?? {};
  } else {
    warnings.push(`unpdf getMeta failed: ${describe(metaResult.reason)}`);
  }

  let ocrUsed = false;
  if (text.replace(/\s+/g, "").length < 200 && options.ocrFallback) {
    const fallback = await options.ocrFallback(buffer).catch(() => null);
    if (fallback) {
      ocrUsed = true;
      pages = fallback.pages.length > 0 ? fallback.pages : pages;
      text = fallback.fullText || text;
      warnings.push("Used OCR fallback because direct text extraction returned little text.");
    }
  }

  return {
    fullText: text,
    pages,
    metadata,
    source: ocrUsed ? "ocr" : "pdf",
    ocrUsed,
    warnings,
  };
}

function cleanPageText(text: string): string {
  return text
    .replace(/ /g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
