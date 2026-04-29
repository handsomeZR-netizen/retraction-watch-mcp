#!/usr/bin/env node
// Upload every PDF in the manifest to the local RW Screen dev server,
// kick off parsing, poll until done, and store the per-paper result.
//
// Usage:
//   node scripts/test-corpus/run-pipeline.mjs
//   node scripts/test-corpus/run-pipeline.mjs --concurrency 2
//
// Env:
//   RW_BASE   default http://localhost:3210
//   RW_USER   default admin
//   RW_PASS   default devpw1234

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Blob } from "node:buffer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const BASE = process.env.RW_BASE ?? "http://localhost:3210";
const USER = process.env.RW_USER ?? "admin";
const PASS = process.env.RW_PASS ?? "devpw1234";
const USER_POOL = process.env.RW_USER_POOL ?? "";

function parseArgs() {
  const args = { concurrency: 2, manifest: "test-corpus/manifest.json", parsed: "test-corpus/parsed" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--concurrency") (args.concurrency = Number(v), i++);
    else if (k === "--manifest") (args.manifest = v, i++);
    else if (k === "--parsed") (args.parsed = v, i++);
  }
  return args;
}

function parseUserPool() {
  const raw = USER_POOL.trim();
  if (!raw) return [{ username: USER, password: PASS }];
  const users = raw.split(",").map((part) => {
    const [username, ...passwordParts] = part.split(":");
    const password = passwordParts.join(":");
    if (!username || !password) throw new Error(`invalid RW_USER_POOL entry: ${part}`);
    return { username, password };
  });
  if (users.length === 0) throw new Error("RW_USER_POOL did not contain any users");
  return users;
}

function entryId(entry) {
  return entry.id ?? entry.doi ?? entry.pmcid ?? entry.arxivId ?? null;
}

function slugForEntry(entry) {
  const id = entryId(entry);
  if (!id) throw new Error(`manifest entry is missing id/doi: ${JSON.stringify(entry).slice(0, 200)}`);
  return id.replace(/[^A-Za-z0-9]/g, "_");
}

async function login(username = USER, password = PASS) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}: ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/rw_screen_session=([^;]+)/);
  if (!m) throw new Error("no session cookie in login response");
  return `rw_screen_session=${m[1]}`;
}

async function fetchWithRetry(makeReq, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await makeReq();
    } catch (err) {
      if (i >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function uploadAndParse(cookie, pdfPath) {
  const buf = await fs.readFile(pdfPath);
  const up = await fetchWithRetry(async () => {
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: "application/pdf" }), path.basename(pdfPath));
    const res = await fetch(`${BASE}/api/upload`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: BASE },
      body: fd,
    });
    return res;
  });
  if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`);
  const { manuscriptId } = await up.json();
  let lastPollError = null;

  const start = await fetchWithRetry(async () => fetch(`${BASE}/api/parse/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE },
    body: JSON.stringify({ manuscriptId }),
  }), 3);
  if (!start.ok) throw new Error(`parse-start ${start.status}: ${await start.text()}`);

  // Poll. The list endpoint gives us status + verdict + totals.
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const list = await fetchWithRetry(async () => fetch(`${BASE}/api/manuscripts?limit=200`, {
        headers: { Cookie: cookie },
      }), 2);
      if (!list.ok) {
        lastPollError = `list ${list.status}: ${await list.text()}`;
        continue;
      }
      const j = await list.json();
      const m = (j.items ?? []).find((it) => it.id === manuscriptId);
      if (m && (m.status === "done" || m.status === "error")) return { manuscriptId, status: m.status, verdict: m.verdict, error: m.error, totals: m.totals };
    } catch (err) {
      lastPollError = err instanceof Error ? err.message : String(err);
    }
  }
  return { manuscriptId, status: "timeout", verdict: null, error: lastPollError };
}

async function fetchFullResult(cookie, manuscriptId) {
  // The result page is server-rendered, so we get its data via the JSON
  // export endpoint instead of scraping HTML.
  const res = await fetchWithRetry(async () => fetch(`${BASE}/api/report/${manuscriptId}?format=download`, {
    headers: { Cookie: cookie },
  }));
  if (!res.ok) return null;
  return res.json();
}

async function pool(items, n, worker) {
  const queue = [...items];
  const results = [];
  const inflight = [];
  while (queue.length || inflight.length) {
    while (inflight.length < n && queue.length) {
      const item = queue.shift();
      const p = (async () => {
        try { results.push(await worker(item)); }
        catch (err) { results.push({ item, error: err.message }); }
      })();
      inflight.push(p);
      p.finally(() => {
        const i = inflight.indexOf(p);
        if (i >= 0) inflight.splice(i, 1);
      });
    }
    if (inflight.length) await Promise.race(inflight);
  }
  return results;
}

async function main() {
  const args = parseArgs();
  const manifestPath = path.resolve(ROOT, args.manifest);
  const parsedDir = path.resolve(ROOT, args.parsed);
  await fs.mkdir(parsedDir, { recursive: true });

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  process.stdout.write(`Manifest: ${manifest.length} entries\n`);

  // Skip those already parsed (idempotent re-runs)
  const todo = [];
  for (const e of manifest) {
    const slug = slugForEntry(e);
    const out = path.join(parsedDir, `${e.layout}_${slug}.json`);
    try {
      const parsed = JSON.parse(await fs.readFile(out, "utf8"));
      if (parsed.status === "done") continue;
    } catch {}
    todo.push({ ...e, parsedPath: out, __todoIndex: todo.length });
  }
  process.stdout.write(`Already parsed: ${manifest.length - todo.length}, to do: ${todo.length}\n`);

  const users = parseUserPool();
  const sessions = [];
  for (const user of users) {
    sessions.push({ ...user, cookie: await login(user.username, user.password) });
  }
  process.stdout.write(`Logged in ${sessions.length} user${sessions.length === 1 ? "" : "s"}.\n`);

  const t0 = Date.now();
  const results = await pool(todo, args.concurrency, async (entry) => {
    const t1 = Date.now();
    const pdfAbs = path.resolve(ROOT, entry.pdfPath);
    const id = entryId(entry);
    const session = sessions[entry.__todoIndex % sessions.length];
    process.stdout.write(`[start ${id}]\n`);
    let head = null;
    let report = null;
    let pipelineError = null;
    try {
      head = await uploadAndParse(session.cookie, pdfAbs);
      if (head.status === "done") report = await fetchFullResult(session.cookie, head.manuscriptId);
    } catch (err) {
      pipelineError = err.message;
    }
    const summary = {
      id,
      layout: entry.layout,
      title: entry.title,
      manuscriptId: head?.manuscriptId ?? null,
      status: pipelineError ? "pipeline-error" : head?.status,
      verdict: head?.verdict ?? null,
      error: pipelineError ?? head?.error ?? null,
      totals: head?.totals ?? null,
      report,
      elapsedMs: Date.now() - t1,
    };
    await fs.writeFile(entry.parsedPath, JSON.stringify(summary, null, 2));
    process.stdout.write(`  ${summary.status} ${id} verdict=${summary.verdict ?? "-"} ${pipelineError ? "ERR=" + pipelineError : ""} (${(summary.elapsedMs / 1000).toFixed(1)}s)\n`);
    return summary;
  });

  process.stdout.write(`\nFinished ${results.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  const ok = results.filter((r) => r.status === "done").length;
  const err = results.filter((r) => r.status === "error" || r.error).length;
  const timeout = results.filter((r) => r.status === "timeout").length;
  process.stdout.write(`done=${ok} error=${err} timeout=${timeout}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
