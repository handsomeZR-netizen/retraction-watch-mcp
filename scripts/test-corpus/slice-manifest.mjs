#!/usr/bin/env node
// Create a small balanced manifest from a larger test corpus manifest.
//
// Usage:
//   node scripts/test-corpus/slice-manifest.mjs --per-layout 5
//   node scripts/test-corpus/slice-manifest.mjs --manifest test-corpus/elsevier-oa/manifest.json --out test-corpus/elsevier-oa/manifest-smoke.json

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

function parseArgs() {
  const args = {
    manifest: "test-corpus/elsevier-oa/manifest.json",
    out: "test-corpus/elsevier-oa/manifest-smoke.json",
    perLayout: 5,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--manifest") (args.manifest = v, i++);
    else if (k === "--out") (args.out = v, i++);
    else if (k === "--per-layout") (args.perLayout = Number(v), i++);
  }
  if (!Number.isFinite(args.perLayout) || args.perLayout < 1) {
    throw new Error("--per-layout must be a positive number");
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const manifestPath = path.resolve(ROOT, args.manifest);
  const outPath = path.resolve(ROOT, args.out);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  const selected = [];
  for (const layout of ["single", "double"]) {
    const entries = manifest.filter((entry) => entry.layout === layout).slice(0, args.perLayout);
    if (entries.length < args.perLayout) {
      throw new Error(`only found ${entries.length}/${args.perLayout} ${layout} entries in ${args.manifest}`);
    }
    selected.push(...entries);
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(selected, null, 2));
  process.stdout.write(`Wrote ${selected.length} entries to ${args.out.replace(/\\/g, "/")}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
