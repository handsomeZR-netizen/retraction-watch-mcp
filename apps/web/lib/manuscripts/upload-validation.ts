import { inferFileType, type FileType } from "@rw/core";
import { sanitizeUploadFileName } from "@/lib/store";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const HEAD_SNIFF_BYTES = 256 * 1024;
const TAIL_SNIFF_BYTES = 1024 * 1024;

export interface UploadFileLike {
  name: string;
  size: number;
  slice(start?: number, end?: number): Blob;
}

export type UploadValidationResult =
  | { ok: true; fileName: string; fileType: Exclude<FileType, "unknown"> }
  | { ok: false; status: number; error: string };

export async function validateUploadFile(
  file: UploadFileLike,
): Promise<UploadValidationResult> {
  if (file.size <= 0) {
    return { ok: false, status: 400, error: "empty file" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: "file too large (>50MB)" };
  }

  const head = await readSlice(file, 0, Math.min(file.size, HEAD_SNIFF_BYTES));
  const tailStart = Math.max(0, file.size - TAIL_SNIFF_BYTES);
  const tail = tailStart === 0 ? head : await readSlice(file, tailStart, file.size);
  const sniffed = sniffManuscriptType(file.name, head, tail, file.size);
  if (!sniffed.ok) return sniffed;

  return {
    ok: true,
    fileName: sanitizeUploadFileName(file.name),
    fileType: sniffed.fileType,
  };
}

async function readSlice(
  file: UploadFileLike,
  start: number,
  end: number,
): Promise<Uint8Array> {
  const bytes = await file.slice(start, end).arrayBuffer();
  return new Uint8Array(bytes);
}

function sniffManuscriptType(
  fileName: string,
  head: Uint8Array,
  tail: Uint8Array,
  size: number,
): UploadValidationResult {
  const declared = inferFileType(fileName);
  const headText = latin1(head);
  const tailText = latin1(tail);
  const sampledText = `${headText}\n${tailText}`;

  if (headText.startsWith("%PDF-")) {
    const pdfError = validatePdfSample(sampledText, tailText, size);
    if (pdfError) return { ok: false, status: 400, error: pdfError };
    return { ok: true, fileName: sanitizeUploadFileName(fileName), fileType: "pdf" };
  }

  if (looksLikeDocx(head, sampledText)) {
    return { ok: true, fileName: sanitizeUploadFileName(fileName), fileType: "docx" };
  }

  if (declared === "latex" && looksLikeLatex(fileName, head, sampledText)) {
    return { ok: true, fileName: sanitizeUploadFileName(fileName), fileType: "latex" };
  }

  return { ok: false, status: 415, error: "unsupported file type" };
}

function validatePdfSample(
  sampledText: string,
  tailText: string,
  size: number,
): string | null {
  if (!tailText.includes("%%EOF")) {
    return "malformed PDF: missing EOF marker";
  }
  if (/\/Encrypt\b/.test(sampledText)) {
    return "encrypted PDF is not supported";
  }

  const xrefs = [...tailText.matchAll(/startxref\s+(\d+)/g)];
  const lastXref = xrefs.at(-1)?.[1];
  if (lastXref) {
    const offset = Number(lastXref);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) {
      return "malformed PDF: corrupted xref pointer";
    }
  }
  return null;
}

function looksLikeDocx(head: Uint8Array, sampledText: string): boolean {
  return (
    hasZipLocalHeader(head) &&
    sampledText.includes("[Content_Types].xml") &&
    sampledText.includes("word/")
  );
}

function looksLikeLatex(fileName: string, head: Uint8Array, sampledText: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) {
    return hasZipLocalHeader(head);
  }
  if (!lower.endsWith(".tex")) {
    return false;
  }
  if (head.includes(0)) {
    return false;
  }
  return /\\(?:documentclass|begin|title|author|bibliography)\b/.test(sampledText);
}

function hasZipLocalHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}
