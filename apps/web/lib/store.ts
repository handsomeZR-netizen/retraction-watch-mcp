import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FileType, ManuscriptScreenResult } from "@rw/core";
import { getDataDir } from "./config";

export interface UploadRecord {
  manuscriptId: string;
  fileName: string;
  fileType: FileType;
  bytes: number;
  uploadedAt: string;
  filePath: string;
  sha256: string | null;
}

export async function ensureDataDir(): Promise<string> {
  const dir = getDataDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function manuscriptDir(id: string): string {
  return path.join(getDataDir(), id);
}

export async function saveUpload(input: {
  manuscriptId: string;
  fileName: string;
  fileType: FileType;
  body: Buffer | ReadableStream<Uint8Array>;
}): Promise<UploadRecord> {
  const dir = manuscriptDir(input.manuscriptId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, input.fileName);

  const hash = createHash("sha256");
  let bytes = 0;
  if (Buffer.isBuffer(input.body)) {
    hash.update(input.body);
    await fs.writeFile(filePath, input.body);
    bytes = input.body.byteLength;
  } else {
    const out = createWriteStream(filePath);
    const tee = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(input.body as unknown as NodeReadableStream<Uint8Array>),
      tee,
      out,
    );
    bytes = (await fs.stat(filePath)).size;
  }
  const sha256 = hash.digest("hex");

  const record: UploadRecord = {
    manuscriptId: input.manuscriptId,
    fileName: input.fileName,
    fileType: input.fileType,
    bytes,
    uploadedAt: new Date().toISOString(),
    filePath,
    sha256,
  };
  await fs.writeFile(path.join(dir, "upload.json"), JSON.stringify(record, null, 2));
  return record;
}

export async function getUpload(manuscriptId: string): Promise<UploadRecord | null> {
  try {
    const text = await fs.readFile(path.join(manuscriptDir(manuscriptId), "upload.json"), "utf8");
    return JSON.parse(text) as UploadRecord;
  } catch {
    return null;
  }
}

export async function saveResult(manuscriptId: string, result: ManuscriptScreenResult): Promise<void> {
  await fs.writeFile(
    path.join(manuscriptDir(manuscriptId), "result.json"),
    JSON.stringify(result, null, 2),
  );
}

export async function getResult(manuscriptId: string): Promise<ManuscriptScreenResult | null> {
  try {
    const text = await fs.readFile(path.join(manuscriptDir(manuscriptId), "result.json"), "utf8");
    return JSON.parse(text) as ManuscriptScreenResult;
  } catch {
    return null;
  }
}

export async function listManuscripts(limit = 20): Promise<UploadRecord[]> {
  const dir = await ensureDataDir();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: UploadRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const upload = await getUpload(entry.name);
    if (upload) out.push(upload);
  }
  return out
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    .slice(0, limit);
}

export async function deleteOldUploads(olderThanHours: number): Promise<number> {
  const dir = await ensureDataDir();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const cutoff = Date.now() - olderThanHours * 3600_000;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const upload = await getUpload(entry.name);
    if (!upload) continue;
    if (Date.parse(upload.uploadedAt) < cutoff) {
      await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}
