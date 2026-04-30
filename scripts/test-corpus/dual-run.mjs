#!/usr/bin/env node
// Run every manifest entry through both the legacy and the enriched pipeline
// in-process (no web server required), and save the per-paper JSON to two
// separate directories so `diff-pipelines.mjs` can compare them.
//
// Usage:
//   # Build packages first so dist/ is current.
//   npm -w @rw/core run build && npm -w @rw/ingest run build
//
//   # Then run:
//   node scripts/test-corpus/dual-run.mjs \
//     --manifest test-corpus/manifest.json \
//     --legacy-out test-corpus/parsed \
//     --enriched-out test-corpus/parsed-v2 \
//     --concurrency 2
//
// Env knobs (all optional — script runs with what it gets):
//   RW_MCP_DB_PATH      Retraction Watch sqlite (default ./data/retraction-watch.sqlite)
//   RW_LLM_BASE_URL     LLM base URL (off if unset; both paths skip LLM)
//   RW_LLM_API_KEY      LLM API key (required to enable LLM)
//   RW_LLM_MODEL        LLM model id
//   RW_CONTACT_EMAIL    mailto for Crossref polite pool (required to enable
//                       Crossref / EPMC; without it the enriched run still
//                       attaches provenance metadata but does no external
//                       enrichment, so the diff will reflect only structural
//                       changes — not real Crossref/EPMC gains).
//
// The script does NOT delete the existing parsed/ directories — re-runs are
// idempotent (overwrites per-paper JSON) but won't clobber unrelated files.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RetractionWatchRepository } from "@rw/core";
import { screenManuscript } from "@rw/ingest/screen";
import { inferFileType } from "@rw/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

function parseArgs() {
  const args = {
    manifest: "test-corpus/manifest.json",
    legacyOut: "test-corpus/parsed",
    enrichedOut: "test-corpus/parsed-v2",
    concurrency: 2,
    only: null,
    skipLegacy: false,
    skipEnriched: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--manifest") (args.manifest = v, i++);
    else if (k === "--legacy-out") (args.legacyOut = v, i++);
    else if (k === "--enriched-out") (args.enrichedOut = v, i++);
    else if (k === "--concurrency") (args.concurrency = Number(v), i++);
    else if (k === "--only") (args.only = v, i++);
    else if (k === "--skip-legacy") args.skipLegacy = true;
    else if (k === "--skip-enriched") args.skipEnriched = true;
  }
  return args;
}

function entryId(entry) {
  return entry.id ?? entry.doi ?? entry.pmcid ?? entry.arxivId ?? null;
}

function slugForEntry(entry) {
  const id = entryId(entry);
  if (!id) throw new Error(`manifest entry missing id: ${JSON.stringify(entry).slice(0, 200)}`);
  return id.replace(/[^A-Za-z0-9]/g, "_");
}

function buildLlmConfig() {
  const apiKey = process.env.RW_LLM_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: process.env.RW_LLM_BASE_URL ?? "https://api.deepseek.com/v1",
    apiKey,
    model: process.env.RW_LLM_MODEL ?? "deepseek-chat",
  };
}

function shouldEnrichExternally() {
  return Boolean(process.env.RW_CONTACT_EMAIL);
}

async function pool(items, n, worker) {
  const queue = [...items];
  const results = [];
  const inflight = [];
  while (queue.length || inflight.length) {
    while (inflight.length < n && queue.length) {
      const item = queue.shift();
      const p = (async () => {
        try {
          results.push(await worker(item));
        } catch (err) {
          results.push({ item, error: err instanceof Error ? err.message : String(err) });
        }
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

async function runOne(repo, entry, mode, outPath) {
  const pdfAbs = path.resolve(ROOT, entry.pdfPath);
  const buffer = await fs.readFile(pdfAbs);
  const fileType = inferFileType(entry.pdfPath);
  const llm = buildLlmConfig();
  const enriched = mode === "enriched";
  const options = {
    llm: llm ?? undefined,
    llmHeader: false,
    enrichedPipeline: enriched,
    enrichmentContact: enriched && shouldEnrichExternally() ? process.env.RW_CONTACT_EMAIL : undefined,
    enrichmentCachePath: enriched ? path.resolve(ROOT, ".local-app-db", "external-cache.sqlite") : undefined,
  };

  const t0 = Date.now();
  let result = null;
  let error = null;
  try {
    result = await screenManuscript(repo, {
      fileName: path.basename(pdfAbs),
      fileType,
      buffer,
    }, options);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const elapsedMs = Date.now() - t0;

  const summary = {
    id: entryId(entry),
    layout: entry.layout,
    title: entry.title,
    manuscriptId: result?.manuscriptId ?? null,
    status: error ? "pipeline-error" : "done",
    verdict: result?.verdict ?? null,
    error,
    totals: result?.totals ?? null,
    report: result,
    elapsedMs,
    mode,
  };
  await fs.writeFile(outPath, JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  const args = parseArgs();
  const manifestPath = path.resolve(ROOT, args.manifest);
  const legacyDir = path.resolve(ROOT, args.legacyOut);
  const enrichedDir = path.resolve(ROOT, args.enrichedOut);
  await fs.mkdir(legacyDir, { recursive: true });
  await fs.mkdir(enrichedDir, { recursive: true });

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  let entries = manifest;
  if (args.only) {
    entries = manifest.filter((e) => entryId(e) === args.only);
    if (entries.length === 0) {
      console.error(`No manifest entry matched --only=${args.only}`);
      process.exit(2);
    }
  }

  const dbPath = process.env.RW_MCP_DB_PATH ?? path.resolve(ROOT, "data", "retraction-watch.sqlite");
  process.stdout.write(`RW DB: ${dbPath}\n`);
  const repo = await RetractionWatchRepository.open(dbPath);

  const llm = buildLlmConfig();
  const enrichExt = shouldEnrichExternally();
  process.stdout.write(`Manifest: ${entries.length} entries\n`);
  process.stdout.write(`LLM: ${llm ? `enabled (${llm.model})` : "disabled"}\n`);
  process.stdout.write(
    `External enrichment: ${enrichExt ? `enabled (mailto:${process.env.RW_CONTACT_EMAIL})` : "disabled — set RW_CONTACT_EMAIL to exercise Crossref/EPMC"}\n`,
  );

  if (!args.skipLegacy) {
    process.stdout.write(`\n== Legacy pipeline ==\n`);
    const t0 = Date.now();
    const results = await pool(entries, args.concurrency, async (entry) => {
      const slug = slugForEntry(entry);
      const out = path.join(legacyDir, `${entry.layout}_${slug}.json`);
      const r = await runOne(repo, entry, "legacy", out);
      process.stdout.write(`  legacy ${r.id} ${r.status} ${r.verdict ?? "-"} (${(r.elapsedMs / 1000).toFixed(1)}s)\n`);
      return r;
    });
    const ok = results.filter((r) => r.status === "done").length;
    process.stdout.write(`Legacy done=${ok}/${results.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  }

  if (!args.skipEnriched) {
    process.stdout.write(`\n== Enriched pipeline ==\n`);
    const t0 = Date.now();
    const results = await pool(entries, args.concurrency, async (entry) => {
      const slug = slugForEntry(entry);
      const out = path.join(enrichedDir, `${entry.layout}_${slug}.json`);
      const r = await runOne(repo, entry, "enriched", out);
      process.stdout.write(`  enriched ${r.id} ${r.status} ${r.verdict ?? "-"} (${(r.elapsedMs / 1000).toFixed(1)}s)\n`);
      return r;
    });
    const ok = results.filter((r) => r.status === "done").length;
    process.stdout.write(`Enriched done=${ok}/${results.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  }

  process.stdout.write(`\nNow run: node scripts/test-corpus/diff-pipelines.mjs --legacy ${args.legacyOut} --enriched ${args.enrichedOut}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
