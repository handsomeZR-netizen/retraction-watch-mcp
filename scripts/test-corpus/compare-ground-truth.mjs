#!/usr/bin/env node
// Compare parsed RW Screen output against authority metadata gathered from
// PMC/Europe PMC/Crossref.
//
// Usage:
//   node scripts/test-corpus/compare-ground-truth.mjs \
//     --manifest test-corpus/elsevier-oa/manifest-single-100.json \
//     --ground-truth test-corpus/elsevier-oa/ground-truth-single-100.json \
//     --parsed test-corpus/elsevier-oa/parsed-local-single-100-rerun \
//     --out test-corpus/elsevier-oa/compare-single-100-rerun

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

function parseArgs() {
  const args = {
    manifest: "test-corpus/elsevier-oa/manifest.json",
    groundTruth: "test-corpus/elsevier-oa/ground-truth.json",
    parsed: "test-corpus/elsevier-oa/parsed",
    out: "test-corpus/elsevier-oa/compare",
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--manifest") (args.manifest = v, i += 1);
    else if (k === "--ground-truth") (args.groundTruth = v, i += 1);
    else if (k === "--parsed") (args.parsed = v, i += 1);
    else if (k === "--out") (args.out = v, i += 1);
  }
  return args;
}

function entryId(entry) {
  return (entry.id ?? entry.doi ?? "").toLowerCase();
}

function slugForEntry(entry) {
  return entryId(entry).replace(/[^A-Za-z0-9]/g, "_");
}

function normalize(s) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return new Set(normalize(s).split(" ").filter(Boolean));
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function titleScore(expected, parsed) {
  return jaccard(tokens(expected), tokens(parsed));
}

function authorKeys(authors) {
  const out = new Set();
  for (const a of authors ?? []) {
    const full = normalize(a.fullName ?? a.name ?? [a.given, a.family].filter(Boolean).join(" "));
    const family = normalize(a.family ?? "");
    if (family && family.length > 1) out.add(family);
    const parts = full.split(" ").filter(Boolean);
    if (parts.length > 0) {
      out.add(parts[parts.length - 1]);
      if (parts.length > 1) out.add(parts[0]);
    }
  }
  for (const v of [...out]) if (v.length <= 1) out.delete(v);
  return out;
}

function authorStats(gtAuthors, parsedAuthors) {
  const expected = authorKeys(gtAuthors);
  const got = authorKeys(parsedAuthors);
  const found = [...expected].filter((v) => got.has(v));
  return {
    expectedCount: gtAuthors?.length ?? 0,
    parsedCount: parsedAuthors?.length ?? 0,
    expectedFamilies: [...expected],
    parsedFamilies: [...got],
    foundFamilies: found,
    missingFamilies: [...expected].filter((v) => !got.has(v)),
    recall: expected.size === 0 ? 1 : found.length / expected.size,
  };
}

function parsedReferenceDois(report) {
  const out = new Set();
  for (const row of report?.screenedReferences ?? []) {
    const doi = normalizeDoi(row?.reference?.doi ?? row?.reference?.DOI ?? "");
    if (doi) out.add(doi);
  }
  return out;
}

function normalizeDoi(doi) {
  return (doi ?? "")
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .replace(/[),.;\s]+$/g, "")
    .trim();
}

function doiStats(gtReferenceDois, report) {
  const expected = new Set((gtReferenceDois ?? []).map(normalizeDoi).filter(Boolean));
  const got = parsedReferenceDois(report);
  const found = [...expected].filter((doi) => got.has(doi));
  return {
    expectedCount: expected.size,
    parsedCount: got.size,
    foundCount: found.length,
    recall: expected.size === 0 ? 1 : found.length / expected.size,
    extraCount: [...got].filter((doi) => !expected.has(doi)).length,
  };
}

function findingKinds(row) {
  const out = [];
  if (row.status !== "done") out.push(`status:${row.status}`);
  if (row.titleScore < 0.8) out.push("title-mismatch");
  if (row.author.recall < 0.8) out.push("authors-low-recall");
  if (row.author.parsedCount < row.author.expectedCount * 0.7) out.push("authors-undercounted");
  if (row.references.expectedCount > 0 && row.references.recall < 0.6) out.push("refs-doi-low-recall");
  if (row.references.parsedCount === 0) out.push("no-references-extracted");
  return out;
}

async function main() {
  const args = parseArgs();
  const manifest = JSON.parse(await fs.readFile(path.resolve(ROOT, args.manifest), "utf8"));
  const groundTruth = JSON.parse(await fs.readFile(path.resolve(ROOT, args.groundTruth), "utf8"));
  const gtById = new Map(groundTruth.map((entry) => [entryId(entry), entry]));
  const parsedDir = path.resolve(ROOT, args.parsed);
  const outDir = path.resolve(ROOT, args.out);
  await fs.mkdir(outDir, { recursive: true });

  const rows = [];
  for (const entry of manifest) {
    const id = entryId(entry);
    const gt = gtById.get(id);
    const parsedPath = path.join(parsedDir, `${entry.layout}_${slugForEntry(entry)}.json`);
    let parsed = null;
    try {
      parsed = JSON.parse(await fs.readFile(parsedPath, "utf8"));
    } catch {
      rows.push({
        id,
        layout: entry.layout,
        status: "missing-parsed",
        titleScore: 0,
        expectedTitle: gt?.title ?? entry.title ?? null,
        parsedTitle: null,
        author: authorStats(gt?.authors ?? entry.crossrefAuthors, []),
        references: doiStats(gt?.referenceDois ?? [], null),
        findings: ["status:missing-parsed"],
      });
      continue;
    }

    const report = parsed.report;
    const row = {
      id,
      layout: entry.layout,
      status: parsed.status,
      verdict: parsed.verdict ?? null,
      manuscriptId: parsed.manuscriptId ?? null,
      expectedTitle: gt?.title ?? entry.title ?? null,
      parsedTitle: report?.metadata?.title ?? null,
      titleScore: titleScore(gt?.title ?? entry.title, report?.metadata?.title),
      author: authorStats(gt?.authors ?? entry.crossrefAuthors, report?.metadata?.authors),
      references: doiStats(gt?.referenceDois ?? [], report),
      elapsedMs: parsed.elapsedMs ?? null,
    };
    row.findings = findingKinds(row);
    rows.push(row);
  }

  await fs.writeFile(path.join(outDir, "compare.json"), JSON.stringify(rows, null, 2));

  const done = rows.filter((r) => r.status === "done");
  const avg = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const findings = {};
  for (const row of rows) for (const f of row.findings) findings[f] = (findings[f] ?? 0) + 1;

  const md = [];
  md.push("# Ground Truth Comparison");
  md.push("");
  md.push(`Total: ${rows.length}`);
  md.push(`Done: ${done.length}`);
  md.push(`Avg title score: ${avg(done.map((r) => r.titleScore)).toFixed(2)}`);
  md.push(`Avg author recall: ${avg(done.map((r) => r.author.recall)).toFixed(2)}`);
  md.push(`Avg ref DOI recall: ${avg(done.map((r) => r.references.recall)).toFixed(2)}`);
  md.push("");
  md.push("## Findings");
  for (const [k, v] of Object.entries(findings).sort((a, b) => b[1] - a[1])) {
    md.push(`- ${k}: ${v}`);
  }
  md.push("");
  md.push("## Worst Title Scores");
  for (const row of done.toSorted((a, b) => a.titleScore - b.titleScore).slice(0, 20)) {
    md.push(`- ${row.id} (${row.layout}) score=${row.titleScore.toFixed(2)}`);
    md.push(`  expected: ${row.expectedTitle ?? "(null)"}`);
    md.push(`  parsed: ${row.parsedTitle ?? "(null)"}`);
  }
  md.push("");
  md.push("## Worst Reference DOI Recall");
  for (const row of done
    .filter((r) => r.references.expectedCount > 0)
    .toSorted((a, b) => a.references.recall - b.references.recall)
    .slice(0, 20)) {
    md.push(`- ${row.id} (${row.layout}) recall=${row.references.recall.toFixed(2)} expected=${row.references.expectedCount} parsed=${row.references.parsedCount}`);
  }

  await fs.writeFile(path.join(outDir, "summary.md"), md.join("\n"));
  process.stdout.write(`Wrote comparison to ${args.out.replace(/\\/g, "/")}\n`);
  process.stdout.write(`done=${done.length}/${rows.length} avgTitle=${avg(done.map((r) => r.titleScore)).toFixed(2)} avgAuthorRecall=${avg(done.map((r) => r.author.recall)).toFixed(2)} avgRefDoiRecall=${avg(done.map((r) => r.references.recall)).toFixed(2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
