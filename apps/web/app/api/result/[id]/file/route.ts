import fs from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { canAccessManuscript } from "@/lib/auth/scope";
import { getManuscript } from "@/lib/db/manuscripts";
import { getUpload } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  tex: "text/x-tex; charset=utf-8",
  zip: "application/zip",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = getManuscript(id);
  if (!row || !canAccessManuscript(auth.user, row)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const upload = await getUpload(id);
  if (!upload) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let size = 0;
  let mtimeMs = 0;
  try {
    const st = await stat(upload.filePath);
    size = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ETag: prefer sha256 (stable across rebuilds, immutable per manuscript).
  // Fall back to size+mtime when the upload predates sha256 capture.
  const etag = upload.sha256
    ? `"sha256-${upload.sha256}"`
    : `"sm-${size}-${Math.floor(mtimeMs)}"`;
  const contentType = CONTENT_TYPES[row.file_type] ?? "application/octet-stream";
  const safeName = encodeURIComponent(upload.fileName);

  // Conditional GET: return 304 when the client already has this exact body.
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        // The file is content-addressed (sha256 ETag) and a manuscript's upload
    // is immutable for its lifetime. `immutable` skips revalidation entirely
    // until the cache expires; long max-age + private keeps it per-user.
    "Cache-Control": "private, max-age=31536000, immutable",
        "Accept-Ranges": "bytes",
      },
    });
  }

  // Range support: pdf.js fetches small slices (header + xref + per-page) so it
  // can render page 1 before the full file finishes downloading. Without this
  // the browser must buffer the entire PDF first.
  const rangeHeader = req.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, size) : null;
  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${size}`,
        "Accept-Ranges": "bytes",
        ETag: etag,
      },
    });
  }

  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename*=UTF-8''${safeName}`,
    // The file is content-addressed (sha256 ETag) and a manuscript's upload
    // is immutable for its lifetime. `immutable` skips revalidation entirely
    // until the cache expires; long max-age + private keeps it per-user.
    "Cache-Control": "private, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    ETag: etag,
  };

  if (range) {
    const { start, end } = range;
    const length = end - start + 1;
    const stream = fs.createReadStream(upload.filePath, { start, end });
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(length),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
    });
  }

  const stream = fs.createReadStream(upload.filePath);
  const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}

/**
 * Parse a single-range RFC 7233 `Range: bytes=…` header. Multipart byte
 * ranges are intentionally unsupported — pdf.js only uses single ranges and
 * the multipart response format would double the route's complexity for no
 * practical benefit.
 *
 * Returns `null` when the range is malformed, multi-range, or unsatisfiable
 * (caller should send 416).
 */
function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  if (size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const startStr = match[1];
  const endStr = match[2];
  let start: number;
  let end: number;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    // Suffix range: last N bytes.
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    if (!Number.isFinite(start) || start < 0 || start >= size) return null;
    if (endStr === "") {
      end = size - 1;
    } else {
      end = Number(endStr);
      if (!Number.isFinite(end) || end < start) return null;
      if (end >= size) end = size - 1;
    }
  }
  return { start, end };
}
