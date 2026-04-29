#!/usr/bin/env node
// Fetch a mixed corpus of single-column / double-column OA scholarly PDFs.
// - Double-column: arXiv (cs.* — IEEE-style template). Direct PDF URL by id.
// - Single-column: PMC OA Web Service — XML returns real PDF link.
//
// Usage:
//   node scripts/test-corpus/fetch-corpus.mjs --target 10
//   node scripts/test-corpus/fetch-corpus.mjs --target 200

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const UA = "rw-screen-test-corpus/1.0 (mailto:rw-screen-dev@example.com)";

function parseArgs() {
  const args = { target: 10, layout: "mixed", out: "test-corpus/pdfs", manifest: "test-corpus/manifest.json" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--target") (args.target = Number(v), i++);
    else if (k === "--layout") (args.layout = v, i++);
    else if (k === "--out") (args.out = v, i++);
    else if (k === "--manifest") (args.manifest = v, i++);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, init = {}, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers ?? {}) } });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          const wait = 1500 * (attempt + 1);
          process.stdout.write(`  ${res.status}, waiting ${wait}ms...\n`);
          await sleep(wait);
          continue;
        }
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error("retries exhausted");
}

async function fetchText(url) {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}
async function fetchJson(url) {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

async function downloadPdf(url, dest) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/pdf,*/*;q=0.8" },
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, reason: `${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.slice(0, 5).toString("latin1") !== "%PDF-")
      return { ok: false, reason: `not-a-pdf bytes=${buf.length}` };
    if (buf.length < 30_000) return { ok: false, reason: `too-small ${buf.length}` };
    if (buf.length > 50 * 1024 * 1024) return { ok: false, reason: `too-large ${buf.length}` };
    await fs.writeFile(dest, buf);
    return { ok: true, bytes: buf.length };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function fetchArxivCandidates(limit) {
  const q = "cat:cs.LG+OR+cat:cs.AI+OR+cat:cs.CV+OR+cat:cs.CL";
  const url = `http://export.arxiv.org/api/query?search_query=${q}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
  const xml = await fetchText(url);
  const entries = xml.split("<entry>").slice(1);
  return entries.map((entry) => {
    const id = (entry.match(/<id>([^<]+)<\/id>/) ?? [, ""])[1].trim();
    const title = (entry.match(/<title>([\s\S]*?)<\/title>/) ?? [, ""])[1].replace(/\s+/g, " ").trim();
    const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1].trim());
    const arxivId = id.match(/abs\/([^v\s]+)/)?.[1] ?? null;
    return { source: "arxiv", arxivId, title, authors, pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null };
  }).filter((c) => c.pdfUrl);
}

// PMC OA Service: returns XML with real PDF FTP link
async function fetchPmcOaPdfUrl(pmcid) {
  const xml = await fetchText(`https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=PMC${pmcid}`);
  // <link format="pdf" href="ftp://ftp.ncbi.nlm.nih.gov/pub/pmc/oa_pdf/xx/yy/foo.pdf"/>
  const m = xml.match(/<link[^>]+format="pdf"[^>]+href="([^"]+)"/);
  if (!m) return null;
  // FTP URL — convert to HTTPS mirror (NCBI publishes both)
  return m[1].replace(/^ftp:\/\/ftp\.ncbi\.nlm\.nih\.gov\//, "https://ftp.ncbi.nlm.nih.gov/");
}

async function fetchPmcCandidates(limit) {
  // search PMC OA recent
  const term = encodeURIComponent('open access[filter] AND "2024"[PDAT] NOT "Preprint"[Publication Type]');
  const search = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=${term}&retmax=${limit}&retmode=json`;
  const j = await fetchJson(search);
  const ids = j?.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];
  const summary = await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${ids.join(",")}&retmode=json`
  );
  const candidates = [];
  for (const pmcid of ids) {
    const r = summary.result?.[pmcid];
    if (!r) continue;
    const pdfUrl = await fetchPmcOaPdfUrl(pmcid).catch(() => null);
    if (!pdfUrl) continue;
    candidates.push({
      source: "pmc",
      pmcid,
      title: r.title ?? null,
      authors: (r.authors ?? []).map((a) => a.name).filter(Boolean),
      doi: (r.articleids ?? []).find((a) => a.idtype === "doi")?.value ?? null,
      pdfUrl,
    });
    await sleep(120); // be polite to NCBI (max ~3 req/s)
  }
  return candidates;
}

function slug(s) {
  return s.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 80);
}

async function main() {
  const args = parseArgs();
  const outDir = path.resolve(ROOT, args.out);
  const manifestPath = path.resolve(ROOT, args.manifest);
  await fs.mkdir(outDir, { recursive: true });

  let manifest = [];
  try { manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")); } catch {}
  const seen = new Set(manifest.map((m) => m.id.toLowerCase()));

  const wantSingle = args.layout === "double" ? 0 : Math.ceil(args.target * (args.layout === "single" ? 1 : 0.5));
  const wantDouble = args.target - wantSingle;

  const tasks = [];
  if (wantDouble > 0) tasks.push({ kind: "double", want: wantDouble });
  if (wantSingle > 0) tasks.push({ kind: "single", want: wantSingle });

  let downloaded = 0;
  for (const task of tasks) {
    process.stdout.write(`\n=== ${task.kind === "double" ? "arXiv (double-col)" : "PMC (single-col)"}: target ${task.want} ===\n`);
    let candidates;
    try {
      candidates = task.kind === "double"
        ? await fetchArxivCandidates(Math.max(20, task.want * 3))
        : await fetchPmcCandidates(Math.max(20, task.want * 3));
    } catch (err) {
      process.stdout.write(`  fetch err: ${err.message}\n`);
      continue;
    }
    process.stdout.write(`  ${candidates.length} candidates\n`);

    let got = 0;
    for (const c of candidates) {
      if (got >= task.want) break;
      const id = (c.arxivId ?? c.pmcid ?? "").toLowerCase();
      if (!id || seen.has(id)) continue;
      const filename = `${task.kind}_${slug(id)}.pdf`;
      const dest = path.join(outDir, filename);
      const dl = await downloadPdf(c.pdfUrl, dest);
      if (!dl.ok) {
        process.stdout.write(`  - ${id}: ${dl.reason}\n`);
        await sleep(200);
        continue;
      }
      const entry = {
        id,
        layout: task.kind,
        source: c.source,
        pdfPath: path.relative(ROOT, dest).replace(/\\/g, "/"),
        bytes: dl.bytes,
        title: c.title,
        crossrefAuthors: (c.authors ?? []).map((n) => {
          const parts = n.split(/\s+/);
          return { family: parts.slice(-1)[0] ?? null, given: parts.slice(0, -1).join(" ") || null };
        }),
        sourceUrl: c.pdfUrl,
        doi: c.doi ?? null,
        downloadedAt: new Date().toISOString(),
      };
      manifest.push(entry);
      seen.add(id);
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      got++;
      downloaded++;
      process.stdout.write(`  + ${id} (${(dl.bytes / 1024).toFixed(0)} KB)\n`);
      await sleep(200);
    }
    process.stdout.write(`  got ${got}/${task.want}\n`);
  }
  process.stdout.write(`\nDone. Total downloaded this run: ${downloaded}. Manifest now: ${manifest.length}.\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
