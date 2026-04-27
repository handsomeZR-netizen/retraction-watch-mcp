import type { ExtractedDocument } from "./types.js";

export async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  const mammoth = await import("mammoth");
  const warnings: string[] = [];
  let text = "";
  try {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value ?? "";
    for (const m of result.messages ?? []) {
      warnings.push(`mammoth: ${m.type}: ${m.message}`);
    }
  } catch (e) {
    warnings.push(`mammoth.extractRawText failed: ${describe(e)}`);
  }

  return {
    fullText: text.trim(),
    pages: [{ index: 1, text: text.trim() }],
    metadata: {},
    source: "docx",
    ocrUsed: false,
    warnings,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
