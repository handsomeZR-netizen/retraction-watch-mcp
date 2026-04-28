import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DB } from "better-sqlite3";
import type * as Manuscripts from "./manuscripts";
import type * as Users from "./users";

let db: DB;
let manuscripts: typeof Manuscripts;
let users: typeof Users;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-web-db-"));
  process.env.RW_APP_DB_DIR = tmpDir;
  process.env.RW_DATA_KEY = "a".repeat(64);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-28T00:00:00.000Z"));

  const appDb = await import("./app-db");
  manuscripts = await import("./manuscripts");
  users = await import("./users");
  db = appDb.getAppDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM manuscripts").run();
  db.prepare("DELETE FROM users").run();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, role, created_at)
     VALUES ('user-1', 'user1', 'hash', NULL, 'user', ?)`,
  ).run(new Date().toISOString());
});

afterAll(() => {
  vi.useRealTimers();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("manuscript parse leases", () => {
  it("rejects a second parser and only lets the lease holder write terminal state", () => {
    manuscripts.insertManuscript({
      id: "m-lease",
      userId: "user-1",
      workspaceId: null,
      fileName: "paper.pdf",
      fileType: "pdf",
      bytes: 123,
      sha256: "sha-lease",
    });

    expect(manuscripts.acquireParseLease("m-lease", "job-a")).toBe(true);
    expect(manuscripts.acquireParseLease("m-lease", "job-b")).toBe(false);
    expect(
      manuscripts.markManuscriptDone({
        id: "m-lease",
        parseJobId: "job-b",
        verdict: "PASS",
        totals: { references: 0 },
        metadataTitle: null,
        policyVersion: "test",
        resultPath: tmpDir,
        generatedAt: new Date().toISOString(),
      }),
    ).toBe(false);

    let row = manuscripts.getManuscript("m-lease");
    expect(row?.status).toBe("parsing");
    expect(row?.parse_job_id).toBe("job-a");

    expect(
      manuscripts.markManuscriptDone({
        id: "m-lease",
        parseJobId: "job-a",
        verdict: "PASS",
        totals: { references: 0 },
        metadataTitle: null,
        policyVersion: "test",
        resultPath: tmpDir,
        generatedAt: new Date().toISOString(),
      }),
    ).toBe(true);

    row = manuscripts.getManuscript("m-lease");
    expect(row?.status).toBe("done");
    expect(row?.parse_job_id).toBeNull();
  });
});

describe("manuscript sha256 dedup", () => {
  it("reuses a done manuscript inside the create transaction", () => {
    manuscripts.insertManuscript({
      id: "m-existing",
      userId: "user-1",
      workspaceId: null,
      fileName: "existing.pdf",
      fileType: "pdf",
      bytes: 100,
      sha256: "same-sha",
    });
    db.prepare("UPDATE manuscripts SET status = 'done' WHERE id = 'm-existing'").run();

    const created = manuscripts.createManuscriptOrFindDuplicate({
      id: "m-new",
      userId: "user-1",
      workspaceId: null,
      fileName: "new.pdf",
      fileType: "pdf",
      bytes: 100,
      sha256: "same-sha",
    });

    expect(created).toMatchObject({
      manuscriptId: "m-existing",
      deduped: true,
    });
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM manuscripts WHERE sha256 = 'same-sha'")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("listManuscriptsByUser archived defaults", () => {
  it("hides archived manuscripts unless explicitly requested", () => {
    manuscripts.insertManuscript({
      id: "m-visible",
      userId: "user-1",
      workspaceId: null,
      fileName: "visible.pdf",
      fileType: "pdf",
      bytes: 100,
      sha256: "sha-visible",
    });
    manuscripts.insertManuscript({
      id: "m-archived",
      userId: "user-1",
      workspaceId: null,
      fileName: "archived.pdf",
      fileType: "pdf",
      bytes: 100,
      sha256: "sha-archived",
    });
    manuscripts.setManuscriptArchived("m-archived", true);

    expect(manuscripts.listManuscriptsByUser("user-1").map((m) => m.id)).toEqual([
      "m-visible",
    ]);
    expect(
      manuscripts.listManuscriptsByUser("user-1", { archived: true }).map((m) => m.id),
    ).toEqual(["m-archived"]);
  });
});

describe("user LLM settings encryption", () => {
  it("stores apiKey encrypted and reads it back decrypted", () => {
    users.setUserLlmSettings("user-1", {
      enabled: true,
      baseUrl: "https://api.example.test/v1",
      model: "model-a",
      apiKey: "sk-test-secret",
    });

    const stored = db
      .prepare("SELECT llm_settings_json FROM users WHERE id = 'user-1'")
      .get() as { llm_settings_json: string };
    const raw = JSON.parse(stored.llm_settings_json) as { apiKey: string };
    expect(raw.apiKey.startsWith("enc:v1:")).toBe(true);
    expect(raw.apiKey).not.toContain("sk-test-secret");

    const user = users.findUserById("user-1");
    expect(user).not.toBeNull();
    expect(users.getUserLlmSettings(user!)?.apiKey).toBe("sk-test-secret");
  });
});
