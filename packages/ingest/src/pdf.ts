import { extractText, getDocumentProxy, getMeta } from "unpdf";
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

  let pages: ExtractedPage[] = [];
  let text = "";
  let metadata: Record<string, unknown> = {};

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(data);
    const [textResult, metaResult] = await Promise.allSettled([
      extractText(pdf, { mergePages: false }),
      getMeta(pdf),
    ]);

    if (textResult.status === "fulfilled") {
      const raw = textResult.value.text;
      const pageTexts = Array.isArray(raw) ? raw : [String(raw ?? "")];
      pages = pageTexts.map((t, idx) => ({ index: idx + 1, text: cleanPageText(t) }));
      text = pages.map((p) => p.text).join("\n\n");
    } else {
      warnings.push(`unpdf extractText failed: ${describe(textResult.reason)}`);
    }

    if (metaResult.status === "fulfilled") {
      metadata = (metaResult.value?.info as Record<string, unknown>) ?? {};
    } else {
      warnings.push(`unpdf getMeta failed: ${describe(metaResult.reason)}`);
    }
  } catch (err) {
    warnings.push(`unpdf open failed: ${describe(err)}`);
  } finally {
    await pdf?.destroy?.();
  }

  let ocrUsed = false;
  if (text.replace(/\s+/g, "").length < 200 && options.ocrFallback) {
    const fallback = await options.ocrFallback(buffer).catch(() => null);
    if (fallback) {
      warnings.push(...fallback.warnings);
      if (fallback.fullText.replace(/\s+/g, "").length > 0) {
        ocrUsed = true;
        pages = fallback.pages.length > 0 ? fallback.pages : pages;
        text = fallback.fullText || text;
        warnings.push("Used OCR fallback because direct text extraction returned little text.");
      }
    }
  }
  if (text.replace(/\s+/g, "").length < 200) {
    warnings.push("text_extraction_empty");
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
    .replace(/[\u00A0\u202F\u2007\u2009\u200A]/g, " ")
    .replace(/\r/g, "")
    .replace(/-\n([a-z\u4e00-\u9fff])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
