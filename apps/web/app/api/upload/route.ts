import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { inferFileType } from "@rw/core";
import { saveUpload } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file too large (>50MB)" }, { status: 413 });
  }
  const fileType = inferFileType(file.name);
  if (fileType === "unknown") {
    return NextResponse.json({ error: "unsupported file type" }, { status: 415 });
  }
  const manuscriptId = randomUUID();
  const safeName = file.name.replace(/[^A-Za-z0-9._一-鿿-]+/g, "_");
  const record = await saveUpload({
    manuscriptId,
    fileName: safeName,
    fileType,
    body: file.stream(),
  });
  return NextResponse.json(record);
}
