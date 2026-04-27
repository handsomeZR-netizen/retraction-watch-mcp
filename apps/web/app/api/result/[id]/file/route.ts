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
  _req: Request,
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
  try {
    size = (await stat(upload.filePath)).size;
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const stream = fs.createReadStream(upload.filePath);
  const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  const contentType = CONTENT_TYPES[row.file_type] ?? "application/octet-stream";
  const safeName = encodeURIComponent(upload.fileName);
  return new Response(webStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Content-Disposition": `inline; filename*=UTF-8''${safeName}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
