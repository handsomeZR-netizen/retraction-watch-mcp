import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { inferFileType } from "@rw/core";
import { requireUser } from "@/lib/auth/guard";
import { activeScope } from "@/lib/auth/scope";
import { writeAudit } from "@/lib/db/audit";
import {
  findDoneManuscriptBySha256,
  insertManuscript,
} from "@/lib/db/manuscripts";
import { getRequestIp } from "@/lib/auth/validate";
import { saveUpload } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { user } = auth;

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
  const scope = activeScope(user);

  if (record.sha256) {
    const existing = findDoneManuscriptBySha256(scope, record.sha256);
    if (existing) {
      writeAudit({
        userId: user.id,
        action: "upload",
        detail: {
          manuscriptId: existing.id,
          deduped: true,
          fileName: safeName,
          sha256: record.sha256,
          workspaceId: scope.workspaceId,
        },
        ip: getRequestIp(req.headers),
        userAgent: req.headers.get("user-agent"),
      });
      return NextResponse.json({
        ...record,
        manuscriptId: existing.id,
        deduped: true,
      });
    }
  }

  insertManuscript({
    id: manuscriptId,
    userId: user.id,
    workspaceId: scope.workspaceId,
    fileName: safeName,
    fileType,
    bytes: record.bytes,
    sha256: record.sha256,
  });
  writeAudit({
    userId: user.id,
    action: "upload",
    detail: {
      manuscriptId,
      fileName: safeName,
      fileType,
      bytes: record.bytes,
      sha256: record.sha256,
      workspaceId: scope.workspaceId,
    },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json(record);
}
