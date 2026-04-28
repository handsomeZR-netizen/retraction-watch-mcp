import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DB } from "better-sqlite3";

const mocks = vi.hoisted(() => ({
  screenManuscript: vi.fn(),
  getRepository: vi.fn(async () => ({
    getSourceSnapshot: () => null,
  })),
}));

vi.mock("@rw/ingest", () => ({
  screenManuscript: mocks.screenManuscript,
}));

vi.mock("@/lib/repository", () => ({
  getRepository: mocks.getRepository,
}));

let tmpDir: string;
let db: DB;
let manuscripts: typeof import("./db/manuscripts");
let store: typeof import("./store");
let parseRunner: typeof import("./parse-runner");

const user = {
  id: "user-parse",
  username: "parse-user",
  displayName: null,
  role: "user" as const,
};

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-web-parse-runner-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  process.env.RW_SCREEN_DATA_DIR = path.join(tmpDir, "uploads");
  process.env.RW_SCREEN_CONFIG_DIR = path.join(tmpDir, "config");
  process.env.RW_DATA_KEY = "b".repeat(64);

  const appDb = await import("./db/app-db");
  manuscripts = await import("./db/manuscripts");
  store = await import("./store");
  parseRunner = await import("./parse-runner");
  db = appDb.getAppDb();
});

beforeEach(async () => {
  mocks.screenManuscript.mockReset();
  db.prepare("DELETE FROM screening_logs").run();
  db.prepare("DELETE FROM manuscripts").run();
  db.prepare("DELETE FROM users").run();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, role, created_at)
     VALUES (?, ?, 'hash', NULL, 'user', ?)`,
  ).run(user.id, user.username, new Date().toISOString());
  await fsp.rm(process.env.RW_SCREEN_DATA_DIR!, { recursive: true, force: true });
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe.sequential("manuscript parse queue", () => {
  it("marks a throwing job failed and keeps accepting later jobs", async () => {
    await createQueuedManuscript("11111111-1111-4111-8111-111111111111");
    await createQueuedManuscript("22222222-2222-4222-8222-222222222222");
    mocks.screenManuscript
      .mockRejectedValueOnce(new Error("parser exploded"))
      .mockImplementationOnce(async (_repo, input) => sampleResult(input));

    const first = parseRunner.startParseJob({
      manuscriptId: "11111111-1111-4111-8111-111111111111",
      user,
    });
    expect(first.ok).toBe(true);
    await waitForStatus("11111111-1111-4111-8111-111111111111", "error");
    expect(
      manuscripts.getManuscript("11111111-1111-4111-8111-111111111111")?.error,
    ).toContain("parser exploded");

    const second = parseRunner.startParseJob({
      manuscriptId: "22222222-2222-4222-8222-222222222222",
      user,
    });
    expect(second.ok).toBe(true);
    await waitForStatus("22222222-2222-4222-8222-222222222222", "done");
  });

  it("rejects a second job for the same manuscript row", async () => {
    await createQueuedManuscript("33333333-3333-4333-8333-333333333333");
    const release = deferred<void>();
    mocks.screenManuscript.mockImplementationOnce(async (_repo, input) => {
      await release.promise;
      return sampleResult(input);
    });

    const first = parseRunner.startParseJob({
      manuscriptId: "33333333-3333-4333-8333-333333333333",
      user,
    });
    const second = parseRunner.startParseJob({
      manuscriptId: "33333333-3333-4333-8333-333333333333",
      user,
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({
      ok: false,
      status: 409,
      error: "manuscript is already parsing",
    });
    release.resolve();
    await waitForStatus("33333333-3333-4333-8333-333333333333", "done");
  });

  it("drains the in-flight job on graceful shutdown and refuses new work", async () => {
    await createQueuedManuscript("44444444-4444-4444-8444-444444444444");
    await createQueuedManuscript("55555555-5555-4555-8555-555555555555");
    const started = deferred<void>();
    const release = deferred<void>();
    mocks.screenManuscript.mockImplementationOnce(async (_repo, input) => {
      started.resolve();
      await release.promise;
      return sampleResult(input);
    });

    const running = parseRunner.startParseJob({
      manuscriptId: "44444444-4444-4444-8444-444444444444",
      user,
    });
    expect(running.ok).toBe(true);
    await started.promise;

    const drain = parseRunner.gracefulDrain(1_000);
    const refused = parseRunner.startParseJob({
      manuscriptId: "55555555-5555-4555-8555-555555555555",
      user,
    });
    expect(refused).toEqual({
      ok: false,
      status: 503,
      error: "server is shutting down",
    });

    release.resolve();
    await drain;
    expect(
      manuscripts.getManuscript("44444444-4444-4444-8444-444444444444")?.status,
    ).toBe("done");
  });
});

async function createQueuedManuscript(id: string): Promise<void> {
  await store.saveUpload({
    manuscriptId: id,
    fileName: `${id}.pdf`,
    fileType: "pdf",
    body: Buffer.from("%PDF-1.7\n%%EOF"),
  });
  manuscripts.insertManuscript({
    id,
    userId: user.id,
    workspaceId: null,
    fileName: `${id}.pdf`,
    fileType: "pdf",
    bytes: 14,
    sha256: id,
  });
}

async function waitForStatus(
  manuscriptId: string,
  status: "done" | "error",
): Promise<void> {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const row = manuscripts.getManuscript(manuscriptId);
    if (row?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${manuscriptId} to become ${status}`);
}

function sampleResult(input: {
  manuscriptId?: string;
  fileName: string;
  fileType: "pdf" | "docx" | "latex" | "unknown";
}) {
  return {
    manuscriptId: input.manuscriptId ?? "generated",
    fileName: input.fileName,
    fileType: input.fileType,
    metadata: { title: null, doi: null, authors: [], abstract: null },
    screenedReferences: [],
    screenedAuthors: [],
    verdict: "PASS",
    totals: {
      references: 0,
      confirmed: 0,
      likely: 0,
      possible: 0,
      clean: 0,
      authorsConfirmed: 0,
      authorsLikely: 0,
      authorsPossible: 0,
    },
    warnings: [],
    network: { deepseekCalls: 0, crossrefCalls: 0, cloudOcrCalls: 0 },
    consequentialUseWarning: "test",
    generatedAt: new Date().toISOString(),
    sourceVersion: null,
    policyVersion: "test-policy",
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
} {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = (value) => r(value as T | PromiseLike<T>);
  });
  return { promise, resolve };
}
