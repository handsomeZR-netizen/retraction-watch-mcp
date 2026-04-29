#!/usr/bin/env node
// Compare two pipeline runs over the same corpus — typically legacy
// (RW_USE_ENRICHED_PIPELINE unset) versus enriched (RW_USE_ENRICHED_PIPELINE=1).
//
// Each run-pipeline.mjs invocation writes per-paper JSON to a different
// `parsed/` directory; this script reads both, lines them up by manuscript
// slug, and reports:
//   - DOI fill rate per side (refs with a non-null DOI / total refs)
//   - DOI ground-truth hit rate per side (when the manifest has the canonical DOI)
//   - Title-jaccard against ground truth per side
//   - Aggregate network call counts (LLM, Crossref, EPMC, cache hits)
//   - Per-paper deltas where the two sides disagree on what they extracted.
//
// Usage:
//   node scripts/test-corpus/diff-pipelines.mjs \
//     --legacy test-corpus/parsed \
//     --enriched test-corpus/parsed-v2 \
//     --reports test-corpus/reports
//
// The script does NOT run the pipelines itself; it only diffs already-written
// outputs. Re-run run-pipeline.mjs twice with different --parsed dirs first.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

function parseArgs() {
  const args = {
    manifest: "test-corpus/manifest.json",
    legacy: "test-corpus/parsed",
    enriched: "test-corpus/parsed-v2",
    reports: "test-corpus/reports",
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--manifest") (args.manifest = v, i++);
    else if (k === "--legacy") (args.legacy = v, i++);
    else if (k === "--enriched") (args.enriched = v, i++);
    else if (k === "--reports") (args.reports = v, i++);
  }
  return args;
}

function entryId(entry) {
  return entry.id ?? entry.doi ?? entry.pmcid ?? entry.arxivId ?? null;
}

function slugForEntry(entry) {
  const id = entryId(entry);
  if (!id) throw new Error(`manifest entry missing id/doi: ${JSON.stringify(entry).slice(0, 200)}`);
  return id.replace(/[^A-Za-z0-9]/g, "_");
}

function normalizeTitle(s) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s) {
  return new Set(normalizeTitle(s).split(" ").filter(Boolean));
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function refStats(parsed) {
  const refs = parsed?.report?.screenedReferences ?? [];
  let withDoi = 0;
  let withTitle = 0;
  let withYear = 0;
  for (const r of refs) {
    if (r?.reference?.doi) withDoi += 1;
    if (r?.reference?.title) withTitle += 1;
    if (r?.reference?.year != null) withYear += 1;
  }
  return {
    refCount: refs.length,
    withDoi,
    withTitle,
    withYear,
    fillRate: refs.length === 0 ? 0 : withDoi / refs.length,
  };
}

function networkStats(parsed) {
  const n = parsed?.report?.network ?? {};
  return {
    llmCalls: n.llmCalls ?? n.deepseekCalls ?? 0,
    crossrefCalls: n.crossrefCalls ?? 0,
    epmcCalls: n.epmcCalls ?? 0,
    cacheHits: n.cacheHits ?? 0,
    enrichmentFailures: n.enrichmentFailures ?? 0,
  };
}

function loadParsed(dir, layout, slug) {
  const p = path.join(dir, `${layout}_${slug}.json`);
  return fs
    .readFile(p, "utf8")
    .then(JSON.parse)
    .catch(() => null);
}

function aggregate(side) {
  const sum = {
    parsed: 0,
    refCount: 0,
    withDoi: 0,
    withTitle: 0,
    withYear: 0,
    titleJaccardSum: 0,
    titleJaccardCount: 0,
    groundTruthDoiHit: 0,
    groundTruthDoiTotal: 0,
    llmCalls: 0,
    crossrefCalls: 0,
    epmcCalls: 0,
    cacheHits: 0,
    enrichmentFailures: 0,
    pipelineErrors: 0,
  };
  for (const row of side) {
    if (row.parsed?.status !== "done") {
      if (row.parsed?.status === "pipeline-error" || row.parsed?.status === "error") {
        sum.pipelineErrors += 1;
      }
      continue;
    }
    sum.parsed += 1;
    const stats = refStats(row.parsed);
    sum.refCount += stats.refCount;
    sum.withDoi += stats.withDoi;
    sum.withTitle += stats.withTitle;
    sum.withYear += stats.withYear;

    if (row.entry.title && row.parsed.report?.metadata?.title) {
      sum.titleJaccardSum += jaccard(
        tokenSet(row.entry.title),
        tokenSet(row.parsed.report.metadata.title),
      );
      sum.titleJaccardCount += 1;
    }
    if (row.entry.doi) {
      sum.groundTruthDoiTotal += 1;
      const refs = row.parsed.report?.screenedReferences ?? [];
      const docDoi = (row.parsed.report?.metadata?.doi ?? "").toLowerCase();
      const expected = row.entry.doi.toLowerCase();
      if (docDoi === expected || refs.some((r) => (r?.reference?.doi ?? "").toLowerCase() === expected)) {
        sum.groundTruthDoiHit += 1;
      }
    }

    const net = networkStats(row.parsed);
    sum.llmCalls += net.llmCalls;
    sum.crossrefCalls += net.crossrefCalls;
    sum.epmcCalls += net.epmcCalls;
    sum.cacheHits += net.cacheHits;
    sum.enrichmentFailures += net.enrichmentFailures;
  }
  return sum;
}

function fmtRate(num, denom) {
  if (denom === 0) return "n/a";
  return `${((num / denom) * 100).toFixed(1)}% (${num}/${denom})`;
}

async function main() {
  const args = parseArgs();
  const manifestPath = path.resolve(ROOT, args.manifest);
  const legacyDir = path.resolve(ROOT, args.legacy);
  const enrichedDir = path.resolve(ROOT, args.enriched);
  const reportsDir = path.resolve(ROOT, args.reports);
  await fs.mkdir(reportsDir, { recursive: true });

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  const rowsLegacy = [];
  const rowsEnriched = [];
  const perPaper = [];
  for (const entry of manifest) {
    const slug = slugForEntry(entry);
    const legacy = await loadParsed(legacyDir, entry.layout, slug);
    const enriched = await loadParsed(enrichedDir, entry.layout, slug);
    rowsLegacy.push({ entry, parsed: legacy });
    rowsEnriched.push({ entry, parsed: enriched });

    if (legacy?.status === "done" && enriched?.status === "done") {
      const lStats = refStats(legacy);
      const eStats = refStats(enriched);
      const lNet = networkStats(legacy);
      const eNet = networkStats(enriched);
      perPaper.push({
        id: entryId(entry),
        layout: entry.layout,
        legacy: { ...lStats, ...lNet },
        enriched: { ...eStats, ...eNet },
        delta: {
          dois: eStats.withDoi - lStats.withDoi,
          refs: eStats.refCount - lStats.refCount,
          llmCalls: eNet.llmCalls - lNet.llmCalls,
          crossrefCalls: eNet.crossrefCalls - lNet.crossrefCalls,
          epmcCalls: eNet.epmcCalls - lNet.epmcCalls,
        },
      });
    }
  }

  const aggLegacy = aggregate(rowsLegacy);
  const aggEnriched = aggregate(rowsEnriched);

  const md = [];
  md.push("# Pipeline diff (legacy vs enriched)");
  md.push("");
  md.push(`- Manifest entries: ${manifest.length}`);
  md.push(`- Legacy parsed OK: ${aggLegacy.parsed} (errors=${aggLegacy.pipelineErrors})`);
  md.push(`- Enriched parsed OK: ${aggEnriched.parsed} (errors=${aggEnriched.pipelineErrors})`);
  md.push("");
  md.push("## Reference fields populated");
  md.push("");
  md.push("| Metric | Legacy | Enriched | Δ |");
  md.push("| --- | --- | --- | --- |");
  md.push(
    `| DOI fill rate | ${fmtRate(aggLegacy.withDoi, aggLegacy.refCount)} | ${fmtRate(aggEnriched.withDoi, aggEnriched.refCount)} | ${aggEnriched.withDoi - aggLegacy.withDoi} |`,
  );
  md.push(
    `| Title fill rate | ${fmtRate(aggLegacy.withTitle, aggLegacy.refCount)} | ${fmtRate(aggEnriched.withTitle, aggEnriched.refCount)} | ${aggEnriched.withTitle - aggLegacy.withTitle} |`,
  );
  md.push(
    `| Year fill rate | ${fmtRate(aggLegacy.withYear, aggLegacy.refCount)} | ${fmtRate(aggEnriched.withYear, aggEnriched.refCount)} | ${aggEnriched.withYear - aggLegacy.withYear} |`,
  );
  md.push("");
  md.push("## Document-level title accuracy (vs manifest)");
  md.push("");
  md.push(
    `- Legacy avg title-jaccard: ${(aggLegacy.titleJaccardCount === 0 ? 0 : aggLegacy.titleJaccardSum / aggLegacy.titleJaccardCount).toFixed(3)} (n=${aggLegacy.titleJaccardCount})`,
  );
  md.push(
    `- Enriched avg title-jaccard: ${(aggEnriched.titleJaccardCount === 0 ? 0 : aggEnriched.titleJaccardSum / aggEnriched.titleJaccardCount).toFixed(3)} (n=${aggEnriched.titleJaccardCount})`,
  );
  md.push("");
  md.push("## Document-level DOI ground-truth hit");
  md.push("");
  md.push(`- Legacy: ${fmtRate(aggLegacy.groundTruthDoiHit, aggLegacy.groundTruthDoiTotal)}`);
  md.push(`- Enriched: ${fmtRate(aggEnriched.groundTruthDoiHit, aggEnriched.groundTruthDoiTotal)}`);
  md.push("");
  md.push("## Network calls (sum across corpus)");
  md.push("");
  md.push("| Counter | Legacy | Enriched |");
  md.push("| --- | --- | --- |");
  md.push(`| LLM calls | ${aggLegacy.llmCalls} | ${aggEnriched.llmCalls} |`);
  md.push(`| Crossref calls | ${aggLegacy.crossrefCalls} | ${aggEnriched.crossrefCalls} |`);
  md.push(`| EPMC calls | ${aggLegacy.epmcCalls} | ${aggEnriched.epmcCalls} |`);
  md.push(`| Cache hits | ${aggLegacy.cacheHits} | ${aggEnriched.cacheHits} |`);
  md.push(`| Enrichment failures | ${aggLegacy.enrichmentFailures} | ${aggEnriched.enrichmentFailures} |`);
  md.push("");
  md.push("## Per-paper Δ (top changes by DOI delta)");
  md.push("");
  perPaper.sort((a, b) => Math.abs(b.delta.dois) - Math.abs(a.delta.dois));
  md.push("| ID | Layout | Refs L→E | DOI L→E | LLM Δ | Crossref Δ | EPMC Δ |");
  md.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const p of perPaper.slice(0, 30)) {
    md.push(
      `| ${p.id} | ${p.layout} | ${p.legacy.refCount}→${p.enriched.refCount} | ${p.legacy.withDoi}→${p.enriched.withDoi} | ${p.delta.llmCalls} | ${p.delta.crossrefCalls} | ${p.delta.epmcCalls} |`,
    );
  }

  const summaryPath = path.join(reportsDir, "diff-pipelines.md");
  await fs.writeFile(summaryPath, md.join("\n"));
  await fs.writeFile(
    path.join(reportsDir, "diff-pipelines.json"),
    JSON.stringify({ aggLegacy, aggEnriched, perPaper }, null, 2),
  );

  process.stdout.write(`Wrote ${path.relative(ROOT, summaryPath)}\n`);
  process.stdout.write(`\nLegacy DOI fill: ${fmtRate(aggLegacy.withDoi, aggLegacy.refCount)}\n`);
  process.stdout.write(`Enriched DOI fill: ${fmtRate(aggEnriched.withDoi, aggEnriched.refCount)}\n`);
  process.stdout.write(`Δ DOI: ${aggEnriched.withDoi - aggLegacy.withDoi}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
