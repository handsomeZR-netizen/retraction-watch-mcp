// API-level end-to-end test for the running dev server (port 3210).
//
// Flow:
//   1. Register a fresh ephemeral user (deterministic suffix per run).
//   2. Upload each fixture in exam/, trigger parse, wait for done.
//   3. Fetch /api/result/{id} and assert verdict + hit counts.
//
// Usage: node scripts/e2e-fixtures.mjs [base-url]

import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3210";
const STAMP = Date.now().toString(36).slice(-6);
const USER = { username: `rwtest_${STAMP}`, password: "RwTestPass123!", displayName: "RW Test" };

const FIXTURES = [
  {
    file: "exam/exam_retracted_refs.tex",
    expect: { verdict: "FAIL", refsConfirmedMin: 3, authorsHitMax: 0 },
  },
  {
    file: "exam/exam_retracted_author.tex",
    expect: { verdict: "REVIEW", refsConfirmedMin: 0, authorsHitMin: 2 },
  },
  {
    file: "exam/exam_clean_control.tex",
    expect: { verdict: "PASS", refsConfirmedMin: 0, authorsHitMax: 0 },
  },
];

let cookieJar = "";

async function api(pathname, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (cookieJar) headers.set("Cookie", cookieJar);
  const res = await fetch(BASE + pathname, { ...init, headers });
  // Capture set-cookie for future requests
  const sc = res.headers.get("set-cookie");
  if (sc) {
    // crude jar: keep only key=value pair
    const pair = sc.split(";")[0];
    cookieJar = pair;
  }
  return res;
}

async function postJson(pathname, body) {
  return api(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postForm(pathname, formData) {
  return api(pathname, { method: "POST", body: formData });
}

function logPass(msg) {
  console.log(`  \u2713 ${msg}`);
}
function logFail(msg) {
  console.log(`  \u2717 ${msg}`);
}

async function register() {
  const res = await postJson("/api/auth/register", USER);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`register failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function uploadFixture(absPath) {
  const buf = fs.readFileSync(absPath);
  const fileName = path.basename(absPath);
  const fd = new FormData();
  // .tex is utf-8 plain text
  fd.append("file", new Blob([buf], { type: "application/x-tex" }), fileName);
  const res = await postForm("/api/upload", fd);
  const body = await res.json();
  if (!res.ok) throw new Error(`upload ${fileName} failed: ${res.status} ${JSON.stringify(body)}`);
  return body; // { manuscriptId, ... } or { manuscriptId, deduped: true }
}

async function startParse(manuscriptId) {
  const res = await postJson("/api/parse/start", { manuscriptId });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`parse/start failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function pollResult(manuscriptId, deadlineMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const res = await api(`/api/result/${manuscriptId}`);
    if (res.ok) return res.json();
    // 404 means parse is still in flight or failed; keep waiting.
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`parse timeout after ${deadlineMs}ms`);
}

let passed = 0;
let failed = 0;

async function runFixture(spec) {
  console.log(`\n[fixture] ${spec.file}`);
  const abs = path.resolve(spec.file);
  const t0 = Date.now();
  const upload = await uploadFixture(abs);
  if (!upload.deduped) await startParse(upload.manuscriptId);
  const result = await pollResult(upload.manuscriptId);
  const elapsed = Date.now() - t0;
  console.log(`  parsed in ${elapsed}ms — verdict=${result.verdict} authors=${result.metadata.authors.length} refs=${result.totals.references}`);

  // Assertions
  const checks = [];
  checks.push(["verdict", result.verdict === spec.expect.verdict, `expected ${spec.expect.verdict}, got ${result.verdict}`]);

  const refsConfirmed = result.totals.confirmed;
  if (typeof spec.expect.refsConfirmedMin === "number") {
    checks.push([
      "refs.confirmed >= " + spec.expect.refsConfirmedMin,
      refsConfirmed >= spec.expect.refsConfirmedMin,
      `got ${refsConfirmed}`,
    ]);
  }

  const authorsHit =
    result.totals.authorsConfirmed + result.totals.authorsLikely + result.totals.authorsPossible;
  if (typeof spec.expect.authorsHitMin === "number") {
    checks.push([
      "authors hit >= " + spec.expect.authorsHitMin,
      authorsHit >= spec.expect.authorsHitMin,
      `got ${authorsHit}`,
    ]);
  }
  if (typeof spec.expect.authorsHitMax === "number") {
    checks.push([
      "authors hit <= " + spec.expect.authorsHitMax,
      authorsHit <= spec.expect.authorsHitMax,
      `got ${authorsHit}`,
    ]);
  }

  for (const [name, ok, detail] of checks) {
    if (ok) {
      logPass(name);
      passed += 1;
    } else {
      logFail(`${name} — ${detail}`);
      failed += 1;
    }
  }

  // Print top hits for visual sanity
  for (const r of result.screenedReferences ?? []) {
    if (r.result.verdict !== "no_match") {
      const t = (r.reference.title ?? r.reference.raw ?? "").slice(0, 70);
      console.log(`    ref [${r.result.verdict}]: ${t}`);
    }
  }
  for (const a of result.screenedAuthors ?? []) {
    if (a.verdict !== "no_match") {
      const rec = a.matchedRecord
        ? `→ #${a.matchedRecord.recordId} ${a.matchedRecord.title.slice(0, 50)}`
        : "";
      console.log(`    author [${a.verdict}]: ${a.author.name} ${rec}`);
    }
  }
}

(async () => {
  console.log(`E2E target: ${BASE}`);
  console.log(`Test user:  ${USER.username}`);

  const reg = await register();
  console.log(`registered as ${reg.user?.username} (role=${reg.user?.role})`);

  for (const spec of FIXTURES) {
    try {
      await runFixture(spec);
    } catch (err) {
      logFail(`${spec.file}: ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
