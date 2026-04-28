import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let store: typeof import("./store");

const NOW = new Date("2026-04-28T00:00:00.000Z");

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rw-web-retention-"));
  process.env.RW_SCREEN_DATA_DIR = tmpDir;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  store = await import("./store");
});

beforeEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  vi.useRealTimers();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("manuscript upload retention", () => {
  it("deletes uploads exactly at the keepHours boundary", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    await store.saveUpload({
      manuscriptId: id,
      fileName: "paper.pdf",
      fileType: "pdf",
      body: Buffer.from("%PDF-1.7\n%%EOF"),
    });
    await rewriteUploadedAt(id, new Date(NOW.getTime() - 24 * 3600_000).toISOString());

    const removed = await store.deleteOldUploads(24);

    expect(removed).toBe(1);
    await expect(fs.stat(path.join(tmpDir, id))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps uploads just inside the retention window", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    await store.saveUpload({
      manuscriptId: id,
      fileName: "paper.pdf",
      fileType: "pdf",
      body: Buffer.from("%PDF-1.7\n%%EOF"),
    });
    await rewriteUploadedAt(
      id,
      new Date(NOW.getTime() - 24 * 3600_000 + 1).toISOString(),
    );

    const removed = await store.deleteOldUploads(24);

    expect(removed).toBe(0);
    await expect(fs.stat(path.join(tmpDir, id))).resolves.toBeTruthy();
  });
});

async function rewriteUploadedAt(id: string, uploadedAt: string): Promise<void> {
  const uploadJson = path.join(tmpDir, id, "upload.json");
  const record = JSON.parse(await fs.readFile(uploadJson, "utf8")) as {
    uploadedAt: string;
  };
  record.uploadedAt = uploadedAt;
  await fs.writeFile(uploadJson, JSON.stringify(record, null, 2));
}
