import type { ExtractedDocument } from "./types.js";

export interface OcrOptions {
  language?: string;
  pages?: number;
  cloudEnabled?: boolean;
}

export async function ocrFallback(
  buffer: Buffer,
  options: OcrOptions = {},
): Promise<ExtractedDocument | null> {
  if (!isImageBuffer(buffer)) {
    return {
      fullText: "",
      pages: [],
      metadata: {},
      source: "ocr",
      ocrUsed: false,
      warnings: [
        "OCR fallback skipped: input is not a raw image. PDF rasterization fallback is not enabled in this build (install pdf-to-img or similar to enable).",
      ],
    };
  }

  try {
    const Tesseract = (await import("tesseract.js")).default;
    const language = options.language ?? "eng+chi_sim";
    const result = await Tesseract.recognize(buffer, language);
    const text = result.data?.text ?? "";
    return {
      fullText: text.trim(),
      pages: [{ index: 1, text: text.trim() }],
      metadata: {},
      source: "ocr",
      ocrUsed: true,
      warnings: [],
    };
  } catch (e) {
    return {
      fullText: "",
      pages: [],
      metadata: {},
      source: "ocr",
      ocrUsed: false,
      warnings: [`tesseract.js failed: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

function isImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  const sig = buffer.subarray(0, 8);
  if (sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff) return true;
  if (
    sig[0] === 0x89 &&
    sig[1] === 0x50 &&
    sig[2] === 0x4e &&
    sig[3] === 0x47
  ) {
    return true;
  }
  return false;
}
