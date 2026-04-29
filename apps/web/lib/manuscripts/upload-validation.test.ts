import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  validateUploadFile,
  type UploadFileLike,
} from "./upload-validation";

const VALID_PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n9\n%%EOF");

function fileLike(
  name: string,
  bytes: Uint8Array,
  type = "application/octet-stream",
): File {
  return new File([arrayBufferCopy(bytes)], name, { type });
}

function hugeFileLike(
  name: string,
  size: number,
  head: Uint8Array,
  tail: Uint8Array,
): UploadFileLike {
  return {
    name,
    size,
    slice(start = 0, end = size) {
      const out = new Uint8Array(Math.max(0, end - start));
      if (start === 0) {
        out.set(head.slice(0, out.length));
      }
      const tailStart = size - tail.length;
      const overlapStart = Math.max(start, tailStart);
      const overlapEnd = Math.min(end, size);
      if (overlapStart < overlapEnd) {
        out.set(
          tail.slice(overlapStart - tailStart, overlapEnd - tailStart),
          overlapStart - start,
        );
      }
      return new Blob([arrayBufferCopy(out)]);
    },
  };
}

describe("manuscript upload validation", () => {
  it("accepts a PDF exactly at the configured size cap", async () => {
    const result = await validateUploadFile(
      hugeFileLike("paper.pdf", MAX_UPLOAD_BYTES, Buffer.from("%PDF-1.7\n"), VALID_PDF),
    );

    expect(result).toMatchObject({
      ok: true,
      fileName: "paper.pdf",
      fileType: "pdf",
    });
  });

  it("accepts a mid-size PDF whose %%EOF lives past the head sniff window", async () => {
    // 442 KB — between HEAD_SNIFF_BYTES (256 KB) and TAIL_SNIFF_BYTES (1 MB).
    // The boundary that broke real OA PDFs in the 0.4.x series: the validator
    // reused `head` as the "tail" buffer when tailStart was 0, which it always
    // was for files <= 1 MB, so the actual file end (where %%EOF lives) was
    // never sniffed.
    const size = 442_139;
    const head = Buffer.from("%PDF-1.7\n" + "x".repeat(2048));
    const tail = Buffer.from("startxref\n421660\n%%EOF\n");
    const result = await validateUploadFile(hugeFileLike("paper.pdf", size, head, tail));
    expect(result).toMatchObject({ ok: true, fileType: "pdf" });
  });

  it("rejects a file over the configured size cap before reading slices", async () => {
    const result = await validateUploadFile({
      name: "paper.pdf",
      size: MAX_UPLOAD_BYTES + 1,
      slice() {
        throw new Error("should not read an oversized file");
      },
    });

    expect(result).toEqual({
      ok: false,
      status: 413,
      error: "file too large (>50MB)",
    });
  });

  it("sanitizes path-like filenames to a safe basename", async () => {
    const result = await validateUploadFile(
      fileLike("..\\..//evil.pdf", VALID_PDF, "application/pdf"),
    );

    expect(result).toMatchObject({
      ok: true,
      fileName: "evil.pdf",
      fileType: "pdf",
    });
  });

  it("rejects plain text even when the filename and MIME type claim PDF", async () => {
    const result = await validateUploadFile(
      fileLike("paper.pdf", Buffer.from("not actually a PDF"), "application/pdf"),
    );

    expect(result).toEqual({
      ok: false,
      status: 415,
      error: "unsupported file type",
    });
  });

  it("rejects a PDF missing the EOF marker", async () => {
    const result = await validateUploadFile(
      fileLike("paper.pdf", Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj")),
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "malformed PDF: missing EOF marker",
    });
  });

  it("rejects encrypted PDFs", async () => {
    const result = await validateUploadFile(
      fileLike(
        "paper.pdf",
        Buffer.from("%PDF-1.7\ntrailer\n<</Encrypt 2 0 R>>\nstartxref\n9\n%%EOF"),
      ),
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "encrypted PDF is not supported",
    });
  });

  it("rejects PDFs with corrupted xref pointers", async () => {
    const result = await validateUploadFile(
      fileLike(
        "paper.pdf",
        Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n999999\n%%EOF"),
      ),
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "malformed PDF: corrupted xref pointer",
    });
  });

  it("sniffs DOCX content instead of trusting the client MIME type", async () => {
    const docxish = Buffer.from(
      "PK\u0003\u0004[Content_Types].xml application/vnd.openxmlformats-officedocument word/document.xml word/",
      "latin1",
    );

    const result = await validateUploadFile(
      fileLike("paper.bin", docxish, "text/plain"),
    );

    expect(result).toMatchObject({
      ok: true,
      fileName: "paper.bin",
      fileType: "docx",
    });
  });
});

function arrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
