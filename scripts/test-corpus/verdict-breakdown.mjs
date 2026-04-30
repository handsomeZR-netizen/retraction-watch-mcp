#!/usr/bin/env node
// Aggregate ref-level verdict / source / DOI-presence stats from a directory
// of `dual-run.mjs` outputs. Use it to compare two pipeline runs (e.g. before
// and after `enrichedPipeline` was flipped on by default).
//
// Usage:
//   # Single-dir summary
//   node scripts/test-corpus/verdict-breakdown.mjs --dir test-corpus/elsevier-oa/parsed-double-50-v0.5
//
//   # Two-dir comparison
//   node scripts/test-corpus/verdict-breakdown.mjs \
//     --before test-corpus/elsevier-oa/parsed-double-50-v0.5 \
//     --after  test-corpus/elsevier-oa/parsed-double-50-enriched
//
//   # Save report JSON
//   node scripts/test-corpus/verdict-breakdown.mjs --dir <path> --out report.json
//
// Reads every *.json in the given directory(ies) — they must be the per-paper
// summary objects that `dual-run.mjs` writes. Each summary is expected to have
// `report.screenedReferences[].{reference, result}` and `report.network`.

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs() {
  const args = { dir: null, before: null, after: null, out: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--dir") (args.dir = v, i++);
    else if (k === "--before") (args.before = v, i++);
    else if (k === "--after") (args.after = v, i++);
    else if (k === "--out") (args.out = v, i++);
    else if (k === "--help" || k === "-h") {
      console.log("Usage: verdict-breakdown.mjs --dir <path> [--out file.json]");
      console.log("       verdict-breakdown.mjs --before <a> --after <b> [--out file.json]");
      process.exit(0);
    }
  }
  if (!args.dir && !(args.before && args.after)) {
    console.error("error: pass either --dir <path>, or both --before and --after");
    process.exit(2);
  }
  return args;
}

async function loadDir(dir) {
  const abs = path.resolve(dir);
  const entries = await fs.readdir(abs);
  const summaries = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const text = await fs.readFile(path.join(abs, name), "utf8");
    try {
      summaries.push({ file: name, ...JSON.parse(text) });
    } catch (err) {
      console.error(`skip ${name}: ${err.message}`);
    }
  }
  return summaries;
}

function emptyDist() {
  return { confirmed: 0, likely_match: 0, possible_match: 0, no_match: 0 };
}

function aggregate(summaries) {
  const out = {
    papers: summaries.length,
    layouts: {},
    refTotals: 0,
    refVerdicts: emptyDist(),
    refSources: {},
    refDoiPresent: 0,
    refTitlePresent: 0,
    refAuthorsPresent: 0,
    refYearPresent: 0,
    authorTotals: 0,
    authorVerdicts: emptyDist(),
    network: {
      llmCalls: 0,
      crossrefCalls: 0,
      epmcCalls: 0,
      cacheHits: 0,
      enrichmentFailures: 0,
      deepseekCalls: 0,
      openalexCalls: 0,
      openalexResolved: 0,
    },
    pipelineVariants: {},
    perPaper: [],
  };

  for (const s of summaries) {
    const layout = s.layout ?? "unknown";
    out.layouts[layout] = (out.layouts[layout] ?? 0) + 1;
    const report = s.report ?? {};
    const variant = report.pipelineVariant ?? "unknown";
    out.pipelineVariants[variant] = (out.pipelineVariants[variant] ?? 0) + 1;

    const refs = report.screenedReferences ?? [];
    out.refTotals += refs.length;
    for (const item of refs) {
      const v = item?.result?.verdict ?? "no_match";
      if (v in out.refVerdicts) out.refVerdicts[v] += 1;
      else out.refVerdicts.no_match += 1;
      const src = item?.reference?.source ?? "unknown";
      out.refSources[src] = (out.refSources[src] ?? 0) + 1;
      const ref = item?.reference ?? {};
      if (ref.doi) out.refDoiPresent += 1;
      if (ref.title) out.refTitlePresent += 1;
      if (Array.isArray(ref.authors) && ref.authors.length > 0) out.refAuthorsPresent += 1;
      if (ref.year) out.refYearPresent += 1;
    }

    const authors = report.screenedAuthors ?? [];
    out.authorTotals += authors.length;
    for (const a of authors) {
      const v = a?.verdict ?? "no_match";
      if (v in out.authorVerdicts) out.authorVerdicts[v] += 1;
      else out.authorVerdicts.no_match += 1;
    }

    const net = report.network ?? {};
    out.network.llmCalls += net.llmCalls ?? 0;
    out.network.crossrefCalls += net.crossrefCalls ?? 0;
    out.network.epmcCalls += net.epmcCalls ?? 0;
    out.network.cacheHits += net.cacheHits ?? 0;
    out.network.enrichmentFailures += net.enrichmentFailures ?? 0;
    out.network.deepseekCalls += net.deepseekCalls ?? 0;
    out.network.openalexCalls += net.openalexCalls ?? 0;
    out.network.openalexResolved += net.openalexResolved ?? 0;

    out.perPaper.push({
      id: s.id,
      layout,
      verdict: s.verdict,
      refs: refs.length,
      doiPresent: refs.filter((r) => r?.reference?.doi).length,
      confirmed: refs.filter((r) => r?.result?.verdict === "confirmed").length,
      likely: refs.filter((r) => r?.result?.verdict === "likely_match").length,
      llmCalls: net.llmCalls ?? 0,
      crossrefCalls: net.crossrefCalls ?? 0,
      elapsedMs: s.elapsedMs ?? null,
    });
  }

  return out;
}

function pct(n, d) {
  if (!d) return "  -- ";
  return ((n / d) * 100).toFixed(1).padStart(5) + "%";
}

function printSummary(label, agg) {
  console.log(`\n=== ${label} ===`);
  console.log(`papers:           ${agg.papers}`);
  console.log(`layouts:          ${JSON.stringify(agg.layouts)}`);
  console.log(`pipeline variants:${JSON.stringify(agg.pipelineVariants)}`);
  console.log(`refs total:       ${agg.refTotals}`);
  console.log(`  doi present:    ${agg.refDoiPresent} (${pct(agg.refDoiPresent, agg.refTotals)})`);
  console.log(`  title present:  ${agg.refTitlePresent} (${pct(agg.refTitlePresent, agg.refTotals)})`);
  console.log(`  authors:        ${agg.refAuthorsPresent} (${pct(agg.refAuthorsPresent, agg.refTotals)})`);
  console.log(`  year:           ${agg.refYearPresent} (${pct(agg.refYearPresent, agg.refTotals)})`);
  console.log(`ref verdicts:`);
  for (const k of Object.keys(agg.refVerdicts)) {
    const v = agg.refVerdicts[k];
    console.log(`  ${k.padEnd(15)} ${String(v).padStart(5)}  ${pct(v, agg.refTotals)}`);
  }
  console.log(`ref sources:`);
  const srcEntries = Object.entries(agg.refSources).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of srcEntries) {
    console.log(`  ${k.padEnd(15)} ${String(v).padStart(5)}  ${pct(v, agg.refTotals)}`);
  }
  console.log(`author verdicts:`);
  for (const k of Object.keys(agg.authorVerdicts)) {
    const v = agg.authorVerdicts[k];
    console.log(`  ${k.padEnd(15)} ${String(v).padStart(5)}  ${pct(v, agg.authorTotals)}`);
  }
  console.log(`network totals:   ${JSON.stringify(agg.network)}`);
}

function printDelta(beforeAgg, afterAgg) {
  console.log(`\n=== Δ (after − before) ===`);
  const rows = [
    ["refs total", beforeAgg.refTotals, afterAgg.refTotals],
    ["doi present", beforeAgg.refDoiPresent, afterAgg.refDoiPresent],
    ["title present", beforeAgg.refTitlePresent, afterAgg.refTitlePresent],
    ["confirmed (refs)", beforeAgg.refVerdicts.confirmed, afterAgg.refVerdicts.confirmed],
    ["likely (refs)", beforeAgg.refVerdicts.likely_match, afterAgg.refVerdicts.likely_match],
    ["possible (refs)", beforeAgg.refVerdicts.possible_match, afterAgg.refVerdicts.possible_match],
    ["no_match (refs)", beforeAgg.refVerdicts.no_match, afterAgg.refVerdicts.no_match],
    ["confirmed (authors)", beforeAgg.authorVerdicts.confirmed, afterAgg.authorVerdicts.confirmed],
    ["llm calls", beforeAgg.network.llmCalls, afterAgg.network.llmCalls],
    ["crossref calls", beforeAgg.network.crossrefCalls, afterAgg.network.crossrefCalls],
    ["epmc calls", beforeAgg.network.epmcCalls, afterAgg.network.epmcCalls],
    ["openalex calls", beforeAgg.network.openalexCalls, afterAgg.network.openalexCalls],
    ["openalex resolved", beforeAgg.network.openalexResolved, afterAgg.network.openalexResolved],
    ["cache hits", beforeAgg.network.cacheHits, afterAgg.network.cacheHits],
  ];
  console.log(`${"metric".padEnd(22)}  ${"before".padStart(8)}  ${"after".padStart(8)}  ${"Δ".padStart(8)}`);
  for (const [name, before, after] of rows) {
    const delta = after - before;
    const sign = delta > 0 ? "+" : "";
    console.log(
      `${name.padEnd(22)}  ${String(before).padStart(8)}  ${String(after).padStart(8)}  ${(sign + delta).padStart(8)}`,
    );
  }
}

async function main() {
  const args = parseArgs();
  const reports = {};

  if (args.dir) {
    const summaries = await loadDir(args.dir);
    const agg = aggregate(summaries);
    printSummary(args.dir, agg);
    reports[args.dir] = agg;
  } else {
    const [beforeSums, afterSums] = await Promise.all([loadDir(args.before), loadDir(args.after)]);
    const beforeAgg = aggregate(beforeSums);
    const afterAgg = aggregate(afterSums);
    printSummary(`BEFORE: ${args.before}`, beforeAgg);
    printSummary(`AFTER:  ${args.after}`, afterAgg);
    printDelta(beforeAgg, afterAgg);
    reports.before = { dir: args.before, ...beforeAgg };
    reports.after = { dir: args.after, ...afterAgg };
  }

  if (args.out) {
    const outAbs = path.resolve(args.out);
    await fs.mkdir(path.dirname(outAbs), { recursive: true });
    await fs.writeFile(outAbs, JSON.stringify(reports, null, 2));
    console.log(`\nReport written to ${outAbs}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
