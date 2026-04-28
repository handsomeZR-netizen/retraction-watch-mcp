import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FileType, ManuscriptScreenResult } from "@rw/core";
import { getDataDir } from "./config";

/**
 * Atomic JSON write: write to a sibling `.tmp` then rename. Rename is atomic
 * on POSIX and on Windows (when the target exists, it's replaced atomically
 * since Node 14). This prevents readers from seeing half-written JSON if the
 * process crashes mid-write.
 */
async function writeJsonAtomic(targetPath: string, payload: unknown): Promise<void> {
  const tmp = `${targetPath}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2));
  await fs.rename(tmp, targetPath);
}

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

/**
 * Reject a path that resolves outside `baseDir`. Defends against
 * path-traversal attacks where a stored filename or upload.json refers to
 * `..` segments or absolute paths pointing outside the manuscript dir.
 *
 * Lexical check only — does NOT follow symlinks. Use `assertNoSymlinkLeak`
 * before reading/writing the actual file when symlink attacks are in scope.
 */
export function assertWithinDir(targetPath: string, baseDir: string): string {
  const resolvedBase = path.resolve(baseDir) + path.sep;
  const resolvedTarget = path.resolve(targetPath);
  // resolvedTarget === resolvedBase (without trailing sep) is the dir itself —
  // never a file; reject as well.
  if (
    resolvedTarget !== path.resolve(baseDir) &&
    !resolvedTarget.startsWith(resolvedBase)
  ) {
    throw new Error(`path traversal: ${targetPath} not within ${baseDir}`);
  }
  return resolvedTarget;
}

/**
 * Verify the *real* (post-symlink-resolution) parent dir of `targetPath` is
 * inside `baseDir` AND that the leaf is not itself a symlink. Use after the
 * lexical assertWithinDir check to defend against attacks where the manuscript
 * dir contains a symlink leaf pointing outside.
 */
export async function assertNoSymlinkLeak(
  targetPath: string,
  baseDir: string,
): Promise<void> {
  const realBase = await fs.realpath(baseDir);
  const parent = path.dirname(targetPath);
  const realParent = await fs.realpath(parent).catch(() => parent);
  const realBaseSep = realBase + path.sep;
  if (realParent !== realBase && !realParent.startsWith(realBaseSep)) {
    throw new Error(`symlink escape: ${targetPath} parent resolves to ${realParent}`);
  }
  // If the leaf already exists, ensure it's not a symlink.
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`symlink leaf rejected: ${targetPath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // Leaf doesn't exist yet — fine, we're about to create it.
  }
}

/**
 * Sanitize a user-provided filename to a safe basename. Strips any path
 * separators, drive letters, and `..` segments. The result is always a single
 * leaf name suitable for joining onto a directory.
 */
export function sanitizeUploadFileName(fileName: string): string {
  // Take only the trailing component, even if the user submitted a path-like
  // string. Then replace anything that's not a letter/digit/dot/dash/underscore
  // or CJK character with underscore. Reject empty results.
  const leaf = path.basename(fileName.replace(/\\/g, "/"));
  const cleaned = leaf
    .replace(/^\.+/, "_") // leading dots
    .replace(/[^A-Za-z0-9._一-鿿-]+/g, "_")
    .slice(0, 200);
  return cleaned || "upload.bin";
}

export async function saveUpload(input: {
  manuscriptId: string;
  fileName: string;
  fileType: FileType;
  body: Buffer | ReadableStream<Uint8Array>;
}): Promise<UploadRecord> {
  const dir = manuscriptDir(input.manuscriptId);
  await fs.mkdir(dir, { recursive: true });
  const safeName = sanitizeUploadFileName(input.fileName);
  const filePath = assertWithinDir(path.join(dir, safeName), dir);
  await assertNoSymlinkLeak(filePath, dir);

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
    fileName: safeName,
    fileType: input.fileType,
    bytes,
    uploadedAt: new Date().toISOString(),
    filePath,
    sha256,
  };
  await writeJsonAtomic(path.join(dir, "upload.json"), record);
  return record;
}

export async function getUpload(manuscriptId: string): Promise<UploadRecord | null> {
  try {
    const dir = manuscriptDir(manuscriptId);
    const text = await fs.readFile(path.join(dir, "upload.json"), "utf8");
    const record = JSON.parse(text) as UploadRecord;
    // upload.json is written by us, but defend against tampering / accidental
    // path drift: refuse to expose a record whose filePath escapes the
    // manuscript's own directory.
    try {
      assertWithinDir(record.filePath, dir);
    } catch {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export async function saveResult(manuscriptId: string, result: ManuscriptScreenResult): Promise<void> {
  await writeJsonAtomic(path.join(manuscriptDir(manuscriptId), "result.json"), result);
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

// Conservative UUID-ish guard; manuscript IDs are randomUUID strings. Reject
// anything else so a poisoned listing/DB row can't trick us into rm-rf'ing a
// directory outside the data dir.
const MANUSCRIPT_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

/**
 * Tear down an upload directory. Used when a dedup decision orphans a freshly
 * staged file, so we don't leak disk space across repeated identical uploads.
 */
export async function deleteUpload(manuscriptId: string): Promise<void> {
  if (!/^[0-9a-fA-F-]{8,64}$/.test(manuscriptId)) return;
  const base = await ensureDataDir();
  const target = assertWithinDir(path.join(base, manuscriptId), base);
  await fs.rm(target, { recursive: true, force: true });
}

export async function deleteOldUploads(
  olderThanHours: number,
  options: { isInProgress?: (id: string) => boolean } = {},
): Promise<number> {
  const dir = await ensureDataDir();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const cutoff = Date.now() - olderThanHours * 3600_000;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!MANUSCRIPT_ID_RE.test(entry.name)) continue;
    if (options.isInProgress?.(entry.name)) continue;
    const upload = await getUpload(entry.name);
    if (!upload) continue;
    if (Date.parse(upload.uploadedAt) < cutoff) {
      const target = assertWithinDir(path.join(dir, entry.name), dir);
      await fs.rm(target, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}
