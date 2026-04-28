import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ManuscriptScreenResult } from "@rw/core";
import type { Database as DB } from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Logs from "./screening-logs";

let db: DB;
let logs: typeof Logs;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-logs-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  process.env.RW_DATA_KEY = "a".repeat(64);
  const appDb = await import("./app-db");
  logs = await import("./screening-logs");
  db = appDb.getAppDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM screening_logs").run();
  db.prepare("DELETE FROM users").run();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at) VALUES
       ('user-1', 'u1', 'h', 'user', ?),
       ('user-2', 'u2', 'h', 'user', ?)`,
  ).run(now, now);
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeResult(overrides: Partial<ManuscriptScreenResult> = {}): ManuscriptScreenResult {
  return {
    manuscriptId: "m-x",
    fileName: "x.pdf",
    fileType: "pdf",
    metadata: {
      title: "Test paper",
      authors: [
        { name: "Alice", email: "a@x.com", affiliation: "Lab", orcid: null },
      ],
      doi: null,
      abstract: null,
    },
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
    consequentialUseWarning: "",
    generatedAt: new Date().toISOString(),
    sourceVersion: null,
    policyVersion: "test",
    ...overrides,
  };
}

function insertAt(id: string, createdAt: string, overrides: Partial<ManuscriptScreenResult> = {}): void {
  // Use writeScreeningLog for the canonical write path, then patch created_at to control ordering.
  logs.writeScreeningLog({
    result: makeResult({ manuscriptId: id, ...overrides }),
    userId: (overrides as Partial<{ user_id: string }>).user_id ?? "user-1",
    workspaceId: null,
    bytes: 1234,
    sha256: null,
  });
  db.prepare("UPDATE screening_logs SET created_at = ? WHERE id = ?").run(createdAt, id);
}

describe("screening-logs ordering and pagination", () => {
  it("orders by created_at DESC, id DESC and paginates by cursor", () => {
    insertAt("a-1", "2026-04-01T00:00:00.000Z");
    insertAt("a-2", "2026-04-02T00:00:00.000Z");
    insertAt("a-3", "2026-04-03T00:00:00.000Z");
    insertAt("a-4", "2026-04-04T00:00:00.000Z");
    insertAt("a-5", "2026-04-05T00:00:00.000Z");

    const page1 = logs.listScreeningLogsPage({ limit: 2 });
    expect(page1.items.map((r) => r.id)).toEqual(["a-5", "a-4"]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = logs.listScreeningLogsPage({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((r) => r.id)).toEqual(["a-3", "a-2"]);

    const page3 = logs.listScreeningLogsPage({ limit: 2, cursor: page2.nextCursor! });
    expect(page3.items.map((r) => r.id)).toEqual(["a-1"]);
    expect(page3.nextCursor).toBeNull();
  });

  it("breaks ties on identical created_at by id DESC", () => {
    const ts = "2026-04-10T00:00:00.000Z";
    insertAt("z", ts);
    insertAt("m", ts);
    insertAt("a", ts);

    const all = logs.listScreeningLogs({ limit: 50 });
    expect(all.map((r) => r.id)).toEqual(["z", "m", "a"]);
  });
});

describe("screening-logs filters", () => {
  it("filters by multiple verdicts simultaneously", () => {
    insertAt("p1", "2026-04-01T00:00:00.000Z", { verdict: "PASS" });
    insertAt("r1", "2026-04-02T00:00:00.000Z", { verdict: "REVIEW" });
    insertAt("f1", "2026-04-03T00:00:00.000Z", { verdict: "FAIL" });

    const hits = logs.listScreeningLogs({ verdict: ["FAIL", "REVIEW"], limit: 50 });
    expect(hits.map((r) => r.id).sort()).toEqual(["f1", "r1"]);

    expect(logs.countScreeningLogs({ verdict: ["FAIL", "REVIEW"] })).toBe(2);
    expect(logs.countScreeningLogs({ verdict: ["PASS"] })).toBe(1);
  });

  it("scopeUserId restricts to a single user's logs", () => {
    db.prepare(
      `INSERT INTO screening_logs (id, user_id, workspace_id, scope, file_name, file_type, bytes, sha256, title, authors_json, affiliations_json, emails_json, verdict, refs_total, refs_confirmed, refs_likely, refs_possible, authors_confirmed, authors_likely, authors_possible, hit_summary_json, llm_calls, policy_version, created_at)
       VALUES ('mine', 'user-1', NULL, 'personal', 'm.pdf', 'pdf', 1, NULL, NULL, '[]', NULL, NULL, 'PASS', 0,0,0,0,0,0,0,NULL,0,'p','2026-04-01T00:00:00Z'),
              ('theirs', 'user-2', NULL, 'personal', 't.pdf', 'pdf', 1, NULL, NULL, '[]', NULL, NULL, 'PASS', 0,0,0,0,0,0,0,NULL,0,'p','2026-04-02T00:00:00Z')`,
    ).run();

    const mine = logs.listScreeningLogs({ scopeUserId: "user-1", limit: 50 });
    expect(mine.map((r) => r.id)).toEqual(["mine"]);
    expect(logs.countScreeningLogs({ scopeUserId: "user-1" })).toBe(1);
  });

  it("filters by search across file_name, title, authors_json", () => {
    insertAt("pdfA", "2026-04-01T00:00:00.000Z");
    db.prepare("UPDATE screening_logs SET file_name = ? WHERE id = ?").run("apple.pdf", "pdfA");
    insertAt("pdfB", "2026-04-02T00:00:00.000Z");
    db.prepare("UPDATE screening_logs SET title = ? WHERE id = ?").run("Banana paper", "pdfB");
    insertAt("pdfC", "2026-04-03T00:00:00.000Z");
    db.prepare("UPDATE screening_logs SET authors_json = ? WHERE id = ?").run(
      JSON.stringify([{ name: "Cherry Author" }]),
      "pdfC",
    );

    expect(logs.listScreeningLogs({ search: "apple", limit: 50 }).map((r) => r.id)).toEqual(["pdfA"]);
    expect(logs.listScreeningLogs({ search: "Banana", limit: 50 }).map((r) => r.id)).toEqual(["pdfB"]);
    expect(logs.listScreeningLogs({ search: "Cherry", limit: 50 }).map((r) => r.id)).toEqual(["pdfC"]);
  });
});

describe("screening-logs stats", () => {
  it("aggregates total + per-verdict + last30d", () => {
    const now = Date.now();
    const old = new Date(now - 60 * 86400_000).toISOString();
    const recent = new Date(now - 5 * 86400_000).toISOString();

    insertAt("old1", old, { verdict: "PASS" });
    insertAt("new1", recent, { verdict: "PASS" });
    insertAt("new2", recent, { verdict: "REVIEW" });
    insertAt("new3", recent, { verdict: "FAIL" });

    const stats = logs.getScreeningLogStats({});
    expect(stats.total).toBe(4);
    expect(stats.pass).toBe(2);
    expect(stats.review).toBe(1);
    expect(stats.fail).toBe(1);
    expect(stats.last30d).toBe(3);
  });
});

describe("screening-logs writeScreeningLog", () => {
  it("hides authors with verdict=no_match from hit_summary", () => {
    logs.writeScreeningLog({
      result: makeResult({
        manuscriptId: "h1",
        verdict: "FAIL",
        screenedAuthors: [
          {
            author: { name: "Bad", email: null, affiliation: null, orcid: null },
            verdict: "confirmed",
            score: 1,
            matchedRecord: null,
            evidence: [],
            matchedFields: [],
          },
          {
            author: { name: "Good", email: null, affiliation: null, orcid: null },
            verdict: "no_match",
            score: 0,
            matchedRecord: null,
            evidence: [],
            matchedFields: [],
          },
        ],
      }),
      userId: "user-1",
      workspaceId: null,
      bytes: 100,
      sha256: null,
    });

    const row = db.prepare("SELECT hit_summary_json FROM screening_logs WHERE id = 'h1'").get() as
      | { hit_summary_json: string | null }
      | undefined;
    expect(row?.hit_summary_json).not.toBeNull();
    const summary = JSON.parse(row!.hit_summary_json!) as Array<{ kind: string; name?: string }>;
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ kind: "author", name: "Bad" });
  });
});
