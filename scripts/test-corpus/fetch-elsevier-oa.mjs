#!/usr/bin/env node
// Fetch open-access Elsevier journal articles for the test corpus.
//
// Usage:
//   node scripts/test-corpus/fetch-elsevier-oa.mjs --target 10
//   node scripts/test-corpus/fetch-elsevier-oa.mjs --target 200 --layout double
//
// --target N             How many PDFs to actually download (default 10)
// --layout single|double|mixed   Restrict to curated journal lists (default mixed)
// --rows N               Crossref page size (default 200)
// --out DIR              Output dir (default test-corpus/pdfs)
// --manifest FILE        Manifest JSON (default test-corpus/manifest.json)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const UNPAYWALL_EMAIL = "rw-screen-dev@example.com";

// Hand-curated journal lists. Single-column journals (Cell-style) and
// double-column journals (Procedia-style). Crossref filter is by ISSN.
const JOURNALS = {
  single: [
    { name: "Cell Reports", issn: "2211-1247" },
    { name: "Heliyon", issn: "2405-8440" },
    { name: "iScience", issn: "2589-0042" },
    { name: "Patterns", issn: "2666-3899" },
    { name: "STAR Protocols", issn: "2666-1667" },
  ],
  double: [
    { name: "Procedia Computer Science", issn: "1877-0509" },
    { name: "Procedia CIRP", issn: "2212-8271" },
    { name: "Energy Procedia", issn: "1876-6102" },
    { name: "Journal of Cleaner Production", issn: "0959-6526" },
    { name: "Computers & Industrial Engineering", issn: "0360-8352" },
  ],
};

function parseArgs() {
  const args = { target: 10, layout: "mixed", rows: 200, out: "test-corpus/pdfs", manifest: "test-corpus/manifest.json" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--target") args.target = Number(v), i++;
    else if (k === "--layout") args.layout = v, i++;
    else if (k === "--rows") args.rows = Number(v), i++;
    else if (k === "--out") args.out = v, i++;
    else if (k === "--manifest") args.manifest = v, i++;
  }
  return args;
}

function slugifyDoi(doi) {
  return doi.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 80);
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": `rw-screen-test-corpus/1.0 (mailto:${UNPAYWALL_EMAIL})`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchCrossrefByIssn(issn, rows) {
  // member:78 is Elsevier in Crossref. We only ask for journal-articles with
  // a license (proxy for OA) published since 2019.
  const url = new URL("https://api.crossref.org/journals/" + encodeURIComponent(issn) + "/works");
  url.searchParams.set("filter", "type:journal-article,has-license:true,from-pub-date:2019");
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("select", "DOI,title,author,container-title,published-print,published-online,license,reference,references-count,abstract");
  url.searchParams.set("sort", "published");
  url.searchParams.set("order", "desc");
  const j = await fetchJson(url);
  return j.message?.items ?? [];
}

async function findOaPdf(doi) {
  // Unpaywall best_oa_location.
  try {
    const j = await fetchJson(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`);
    const url = j?.best_oa_location?.url_for_pdf || j?.best_oa_location?.url;
    if (url && /\.pdf(\?|$|#)/i.test(url)) return url;
    if (url) return url; // landing page; download attempt below will sniff
    return null;
  } catch {
    return null;
  }
}

async function downloadPdf(url, dest) {
  // Some OA hosts return HTML if Accept doesn't ask for application/pdf
  const res = await fetch(url, {
    headers: {
      "User-Agent": `rw-screen-test-corpus/1.0 (mailto:${UNPAYWALL_EMAIL})`,
      Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) return { ok: false, reason: `${res.status}` };
  const ctype = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  // Sniff %PDF magic bytes — landing pages return HTML even on 200
  if (buf.slice(0, 5).toString("latin1") !== "%PDF-") {
    return { ok: false, reason: `not-a-pdf (ctype=${ctype.slice(0, 40)} bytes=${buf.length})` };
  }
  if (buf.length < 30_000) return { ok: false, reason: `too-small ${buf.length}` };
  if (buf.length > 50 * 1024 * 1024) return { ok: false, reason: `too-large ${buf.length}` };
  await fs.writeFile(dest, buf);
  return { ok: true, bytes: buf.length };
}

async function main() {
  const args = parseArgs();
  const outDir = path.resolve(ROOT, args.out);
  const manifestPath = path.resolve(ROOT, args.manifest);
  await fs.mkdir(outDir, { recursive: true });

  // Load existing manifest so re-runs are incremental.
  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {}
  const seenDois = new Set(existing.map((m) => m.doi.toLowerCase()));

  const pools =
    args.layout === "single" ? JOURNALS.single
    : args.layout === "double" ? JOURNALS.double
    : [...JOURNALS.single, ...JOURNALS.double];

  const manifest = [...existing];
  let downloaded = 0;
  let attempted = 0;

  outer: for (const journal of pools) {
    process.stdout.write(`\n[${journal.name} ${journal.issn}] fetching candidates...\n`);
    let candidates;
    try {
      candidates = await fetchCrossrefByIssn(journal.issn, args.rows);
    } catch (err) {
      process.stdout.write(`  crossref err: ${err.message}\n`);
      continue;
    }
    process.stdout.write(`  ${candidates.length} candidates\n`);
    for (const work of candidates) {
      if (manifest.length - existing.length >= args.target) break outer;
      const doi = (work.DOI ?? "").toLowerCase();
      if (!doi || seenDois.has(doi)) continue;
      attempted++;

      const pdfUrl = await findOaPdf(doi);
      if (!pdfUrl) continue;
      const slug = slugifyDoi(doi);
      const dest = path.join(outDir, `${slug}.pdf`);
      const dl = await downloadPdf(pdfUrl, dest);
      if (!dl.ok) {
        process.stdout.write(`  - ${doi}: ${dl.reason}\n`);
        continue;
      }
      downloaded++;
      seenDois.add(doi);
      const entry = {
        doi,
        slug,
        pdfPath: path.relative(ROOT, dest).replace(/\\/g, "/"),
        bytes: dl.bytes,
        title: work.title?.[0] ?? null,
        journal: journal.name,
        issn: journal.issn,
        layout: JOURNALS.single.includes(journal) ? "single" : "double",
        published: work["published-print"] ?? work["published-online"] ?? null,
        crossrefAuthors: (work.author ?? []).map((a) => ({
          family: a.family ?? null,
          given: a.given ?? null,
          orcid: a.ORCID ?? null,
        })),
        referencesCount: work["references-count"] ?? (work.reference?.length ?? null),
        crossrefReferenceDois: (work.reference ?? [])
          .map((r) => (r.DOI ?? "").toLowerCase())
          .filter(Boolean),
        url: pdfUrl,
        downloadedAt: new Date().toISOString(),
      };
      manifest.push(entry);
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      process.stdout.write(`  + ${doi} -> ${slug}.pdf (${(dl.bytes / 1024).toFixed(0)} KB)\n`);
    }
  }

  process.stdout.write(`\nDone. Attempted ${attempted}, downloaded ${downloaded}, manifest size ${manifest.length}.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
