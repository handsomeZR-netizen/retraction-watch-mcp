#!/usr/bin/env node
// Compare RW Screen's parse output against manifest ground truth (NCBI /
// arXiv metadata) to surface ingest-pipeline bugs.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

function parseArgs() {
  const args = {
    manifest: "test-corpus/manifest.json",
    parsed: "test-corpus/parsed",
    reports: "test-corpus/reports",
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--manifest") (args.manifest = v, i++);
    else if (k === "--parsed") (args.parsed = v, i++);
    else if (k === "--reports") (args.reports = v, i++);
  }
  return args;
}

function entryId(entry) {
  return entry.id ?? entry.doi ?? entry.pmcid ?? entry.arxivId ?? null;
}

function slugForEntry(entry) {
  const id = entryId(entry);
  if (!id) throw new Error(`manifest entry is missing id/doi: ${JSON.stringify(entry).slice(0, 200)}`);
  return id.replace(/[^A-Za-z0-9]/g, "_");
}

function normalize(s) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s) {
  return new Set(normalize(s).split(" ").filter(Boolean));
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function compareTitle(manifestTitle, parsedTitle) {
  const j = jaccard(tokenSet(manifestTitle), tokenSet(parsedTitle));
  return { score: j, manifest: manifestTitle, parsed: parsedTitle };
}

function compareAuthors(manifestAuthors, parsedAuthors) {
  const expected = manifestAuthors ?? [];
  const got = parsedAuthors ?? [];
  // Manifest comes from two different sources with two different conventions:
  // NCBI ESummary returns "Liu Y" (family first, initial last), so the
  // longest token is the family name. arXiv Atom returns "Yi Liu" (family
  // last). Combine both candidates per-author so the comparison is robust.
  const expectedFamilies = new Set();
  for (const a of expected) {
    const f = normalize(a.family ?? "");
    if (f) expectedFamilies.add(f);
    const g = normalize(a.given ?? "");
    if (g) expectedFamilies.add(g);
  }
  // RW Screen output is "First Last" Latin or "Surname Given" CJK — accept
  // both ends of the name string as candidate family.
  const gotFamilies = new Set();
  for (const a of got) {
    const tokens = normalize(a.name ?? "").split(" ").filter(Boolean);
    if (tokens.length === 0) continue;
    gotFamilies.add(tokens[tokens.length - 1]);
    if (tokens.length > 1) gotFamilies.add(tokens[0]);
  }
  // Filter trivial single-letter "names" (NCBI's initial-only tokens) from
  // both sides so the match metric isn't gamed by them.
  for (const s of [expectedFamilies, gotFamilies]) {
    for (const v of [...s]) if (v.length <= 1) s.delete(v);
  }
  const found = [...expectedFamilies].filter((f) => gotFamilies.has(f));
  return {
    expectedCount: expected.length,
    parsedCount: got.length,
    expectedFamilies: [...expectedFamilies],
    parsedFamilies: [...gotFamilies],
    foundFamilies: found,
    missingFamilies: [...expectedFamilies].filter((f) => !gotFamilies.has(f)),
  };
}

function compareReferences(parsed) {
  const refs = parsed?.screenedReferences ?? [];
  let withDoi = 0;
  let suspiciouslyLong = 0;
  let byVerdict = { confirmed: 0, likely_match: 0, possible_match: 0, no_match: 0 };
  for (const r of refs) {
    if (r?.reference?.doi) withDoi++;
    const text = r?.reference?.rawText ?? r?.reference?.title ?? "";
    if (text.length > 800) suspiciouslyLong++;
    const v = r?.match?.verdict ?? "no_match";
    if (byVerdict[v] !== undefined) byVerdict[v]++;
  }
  return {
    refCount: refs.length,
    withDoi,
    suspiciouslyLong,
    byVerdict,
  };
}

async function main() {
  const args = parseArgs();
  const manifestPath = path.resolve(ROOT, args.manifest);
  const parsedDir = path.resolve(ROOT, args.parsed);
  const reportsDir = path.resolve(ROOT, args.reports);
  await fs.mkdir(reportsDir, { recursive: true });

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const diffs = [];

  for (const entry of manifest) {
    const id = entryId(entry);
    const slug = slugForEntry(entry);
    const parsedPath = path.join(parsedDir, `${entry.layout}_${slug}.json`);
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(parsedPath, "utf8"));
    } catch {
      diffs.push({ id, layout: entry.layout, status: "no-parsed-file" });
      continue;
    }
    if (parsed.status !== "done") {
      diffs.push({ id, layout: entry.layout, status: parsed.status, err: parsed.error });
      continue;
    }

    const report = parsed.report;
    const titleCmp = compareTitle(entry.title, report?.metadata?.title);
    const authorCmp = compareAuthors(entry.crossrefAuthors, report?.metadata?.authors);
    const refCmp = compareReferences(report);

    const findings = [];
    if (titleCmp.score < 0.6) findings.push({ kind: "title-mismatch", score: titleCmp.score });
    if (authorCmp.expectedCount > 0 && authorCmp.parsedCount < authorCmp.expectedCount * 0.5) {
      findings.push({ kind: "authors-undercounted", expected: authorCmp.expectedCount, parsed: authorCmp.parsedCount });
    }
    if (authorCmp.expectedCount > 0 && authorCmp.parsedCount > authorCmp.expectedCount * 1.5) {
      findings.push({ kind: "authors-overcounted", expected: authorCmp.expectedCount, parsed: authorCmp.parsedCount });
    }
    if (authorCmp.missingFamilies.length > authorCmp.expectedFamilies.length * 0.3) {
      findings.push({
        kind: "authors-missing",
        missing: authorCmp.missingFamilies.slice(0, 5),
        ratio: authorCmp.missingFamilies.length / authorCmp.expectedFamilies.length,
      });
    }
    if (refCmp.suspiciouslyLong > refCmp.refCount * 0.1 && refCmp.refCount > 0) {
      findings.push({ kind: "references-too-long", count: refCmp.suspiciouslyLong, total: refCmp.refCount });
    }
    if (refCmp.refCount === 0) findings.push({ kind: "no-references-extracted" });

    diffs.push({
      id,
      layout: entry.layout,
      status: "done",
      verdict: parsed.verdict,
      title: titleCmp,
      authors: authorCmp,
      refs: refCmp,
      findings,
    });
  }

  await fs.writeFile(path.join(reportsDir, "diff.json"), JSON.stringify(diffs, null, 2));

  // Markdown summary
  const md = [];
  md.push("# Test Corpus Diff Report");
  md.push("");
  md.push(`Total manuscripts: ${diffs.length}`);
  md.push(`- Parsed OK: ${diffs.filter((d) => d.status === "done").length}`);
  md.push(`- Errored: ${diffs.filter((d) => d.status === "error").length}`);
  md.push(`- Missing parsed file: ${diffs.filter((d) => d.status === "no-parsed-file").length}`);
  md.push("");
  md.push("## By layout");
  for (const layout of ["single", "double"]) {
    const subset = diffs.filter((d) => d.layout === layout && d.status === "done");
    if (subset.length === 0) continue;
    md.push(`### ${layout}-column (${subset.length} parsed)`);
    md.push("");
    const titleScores = subset.map((d) => d.title.score);
    const avgTitle = titleScores.reduce((a, b) => a + b, 0) / titleScores.length;
    md.push(`- Title-jaccard avg: ${avgTitle.toFixed(2)}`);
    const findingsByKind = {};
    for (const d of subset) for (const f of d.findings) findingsByKind[f.kind] = (findingsByKind[f.kind] || 0) + 1;
    md.push(`- Findings: ${Object.entries(findingsByKind).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);
    md.push("");
  }
  md.push("## Per-paper");
  for (const d of diffs) {
    md.push(`### ${d.id} (${d.layout})`);
    if (d.status !== "done") {
      md.push(`- Status: **${d.status}** ${d.err ? "— " + d.err : ""}`);
      md.push("");
      continue;
    }
    md.push(`- Verdict: ${d.verdict}`);
    md.push(`- Title jaccard: ${d.title.score.toFixed(2)}`);
    md.push(`  - manifest: \`${d.title.manifest?.slice(0, 100)}\``);
    md.push(`  - parsed:   \`${(d.title.parsed ?? "(null)").slice(0, 100)}\``);
    md.push(`- Authors: expected ${d.authors.expectedCount}, parsed ${d.authors.parsedCount}; missing families: ${d.authors.missingFamilies.slice(0, 5).join(", ") || "(none)"}`);
    md.push(`- Refs: ${d.refs.refCount} (with-doi=${d.refs.withDoi}, too-long=${d.refs.suspiciouslyLong})`);
    if (d.findings.length) {
      md.push(`- ⚠️ Findings: ${d.findings.map((f) => f.kind).join(", ")}`);
    }
    md.push("");
  }
  await fs.writeFile(path.join(reportsDir, "summary.md"), md.join("\n"));
  process.stdout.write(`Wrote diff.json + summary.md to ${args.reports.replace(/\\/g, "/")}/\n`);

  // Print top-level summary to stdout
  const allFindings = {};
  for (const d of diffs) for (const f of d.findings ?? []) allFindings[f.kind] = (allFindings[f.kind] || 0) + 1;
  process.stdout.write(`\n=== Findings across ${diffs.length} manuscripts ===\n`);
  for (const [k, v] of Object.entries(allFindings).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${k}: ${v}\n`);
  }
  if (Object.keys(allFindings).length === 0) process.stdout.write("  (none)\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
