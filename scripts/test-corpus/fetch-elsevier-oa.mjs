#!/usr/bin/env node
// Fetch open-access Elsevier journal articles for the test corpus.
//
// Usage:
//   node scripts/test-corpus/fetch-elsevier-oa.mjs --target 10
//   node scripts/test-corpus/fetch-elsevier-oa.mjs --target 100 --layout single
//   node scripts/test-corpus/fetch-elsevier-oa.mjs --target 100 --layout double
//
// --target N             Desired count for the selected layout(s) (default 10)
// --layout single|double|mixed   Restrict to curated journal lists (default mixed)
// --rows N               Crossref page size (default 200)
// --out DIR              Output dir (default test-corpus/elsevier-oa/pdfs)
// --manifest FILE        Manifest JSON (default test-corpus/elsevier-oa/manifest.json)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CONTACT_EMAIL = process.env.TEST_CORPUS_CONTACT_EMAIL ?? process.env.UNPAYWALL_EMAIL ?? "rw-screen-dev@localhost";
const UNPAYWALL_EMAIL = process.env.UNPAYWALL_EMAIL ?? "";
const MIN_PDF_BYTES = 100_000;

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
  const args = {
    target: 10,
    layout: "mixed",
    rows: 200,
    out: "test-corpus/elsevier-oa/pdfs",
    manifest: "test-corpus/elsevier-oa/manifest.json",
  };
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

function validateArgs(args) {
  if (!Number.isFinite(args.target) || args.target < 0) throw new Error("--target must be a non-negative number");
  if (!Number.isFinite(args.rows) || args.rows < 1) throw new Error("--rows must be a positive number");
  if (!["single", "double", "mixed"].includes(args.layout)) throw new Error("--layout must be single, double, or mixed");
}

function slugifyDoi(doi) {
  return doi.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 80);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, init = {}, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": `rw-screen-test-corpus/1.0 (mailto:${CONTACT_EMAIL})`,
          ...(init.headers ?? {}),
        },
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1);
        process.stdout.write(`  ${res.status}, waiting ${wait}ms...\n`);
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error("retries exhausted");
}

async function fetchJson(url, init = {}) {
  const res = await fetchWithRetry(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchCrossrefByIssn(issn, rows) {
  // member:78 is Elsevier in Crossref. We only ask for journal-articles with
  // a license (proxy for OA) published since 2019.
  const url = new URL("https://api.crossref.org/journals/" + encodeURIComponent(issn) + "/works");
  url.searchParams.set("filter", "type:journal-article,has-license:true,from-pub-date:2019");
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("select", "DOI,title,author,container-title,published-print,published-online,license,reference,references-count,abstract,link,URL");
  url.searchParams.set("sort", "published");
  url.searchParams.set("order", "desc");
  const j = await fetchJson(url);
  return j.message?.items ?? [];
}

async function fetchEuropePmcByIssn(issn, rows) {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", `ISSN:"${issn}" OPEN_ACCESS:Y HAS_PDF:Y`);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", String(rows));
  url.searchParams.set("resultType", "core");
  const j = await fetchJson(url);
  return j.resultList?.result ?? [];
}

function titleLooksLikeArticle(title) {
  return !/^(correction|corrigendum|erratum|expression of concern|retraction notice|editorial|editor note)\b/i.test(title ?? "");
}

function normalizeEuropePmcAuthor(author) {
  return {
    family: author.lastName ?? null,
    given: author.firstName ?? null,
    orcid: author.authorId?.type === "ORCID" ? author.authorId.value : null,
  };
}

function normalizeEuropePmcCandidate(record, journal) {
  const pmcid = record.pmcid ?? record.fullTextIdList?.fullTextId?.find((id) => /^PMC/i.test(id));
  const doi = (record.doi ?? "").toLowerCase();
  if (!pmcid || !doi || !titleLooksLikeArticle(record.title)) return null;
  return {
    id: doi,
    doi,
    pmcid,
    title: record.title ?? null,
    journal: journal.name,
    issn: journal.issn,
    layout: journal.layout,
    source: "elsevier-oa",
    pdfUrl: `https://europepmc.org/api/getPdf?pmcid=${encodeURIComponent(pmcid)}`,
    published: record.firstPublicationDate
      ? { "date-parts": [record.firstPublicationDate.split("-").map(Number)] }
      : record.pubYear
        ? { "date-parts": [[Number(record.pubYear)]] }
        : null,
    crossrefAuthors: (record.authorList?.author ?? []).map(normalizeEuropePmcAuthor),
    referencesCount: null,
    crossrefReferenceDois: [],
  };
}

function uniqueUrls(urls) {
  return [...new Set(urls.filter(Boolean))];
}

async function findOaPdfCandidates(work) {
  const urls = [];
  for (const link of work.link ?? []) {
    const contentType = link?.["content-type"] ?? "";
    const url = link?.URL;
    if (url && (/pdf/i.test(contentType) || /\.pdf(\?|$|#)/i.test(url))) urls.push(url);
  }

  // Unpaywall best_oa_location.
  try {
    if (!UNPAYWALL_EMAIL) return uniqueUrls(urls);
    const doi = work.DOI;
    const j = await fetchJson(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`);
    const locations = [j?.best_oa_location, ...(j?.oa_locations ?? [])].filter(Boolean);
    for (const location of locations) {
      urls.push(location.url_for_pdf, location.url);
    }
  } catch {
    // Crossref direct PDF links may still work.
  }
  return uniqueUrls(urls);
}

async function downloadPdf(url, dest) {
  // Some OA hosts return HTML if Accept doesn't ask for application/pdf
  const res = await fetchWithRetry(url, {
    headers: {
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
  if (buf.length < MIN_PDF_BYTES) return { ok: false, reason: `too-small ${buf.length}` };
  if (buf.length > 50 * 1024 * 1024) return { ok: false, reason: `too-large ${buf.length}` };
  await fs.writeFile(dest, buf);
  return { ok: true, bytes: buf.length, url: res.url };
}

function poolsForLayout(layout) {
  const single = JOURNALS.single.map((journal) => ({ ...journal, layout: "single" }));
  const double = JOURNALS.double.map((journal) => ({ ...journal, layout: "double" }));
  if (layout === "single") return single;
  if (layout === "double") return double;
  return [...single, ...double];
}

function entryId(entry) {
  return (entry.doi ?? entry.id ?? "").toLowerCase();
}

function selectedLayouts(layout) {
  return layout === "mixed" ? ["single", "double"] : [layout];
}

function normalizeCrossrefCandidate(work, journal, pdfUrl) {
  const doi = (work.DOI ?? "").toLowerCase();
  if (!doi || !titleLooksLikeArticle(work.title?.[0])) return null;
  return {
    id: doi,
    doi,
    title: work.title?.[0] ?? null,
    journal: journal.name,
    issn: journal.issn,
    layout: journal.layout,
    source: "elsevier-oa",
    pdfUrl,
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
  };
}

async function main() {
  const args = parseArgs();
  validateArgs(args);
  const outDir = path.resolve(ROOT, args.out);
  const manifestPath = path.resolve(ROOT, args.manifest);
  await fs.mkdir(outDir, { recursive: true });

  // Load existing manifest so re-runs are incremental.
  let existing = [];
  try {
    existing = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {}
  const seenDois = new Set(existing.map(entryId).filter(Boolean));

  const layouts = selectedLayouts(args.layout);
  const existingInScope = existing.filter((entry) => layouts.includes(entry.layout)).length;
  const needed = Math.max(0, args.target - existingInScope);
  if (needed === 0) {
    process.stdout.write(`Manifest already has ${existingInScope}/${args.target} ${args.layout} entries. Nothing to download.\n`);
    return;
  }

  const pools = poolsForLayout(args.layout);
  const manifest = [...existing];
  let downloaded = 0;
  let attempted = 0;

  outer: for (const journal of pools) {
    process.stdout.write(`\n[${journal.name} ${journal.issn}] fetching Europe PMC candidates...\n`);
    let candidates = [];
    try {
      const records = await fetchEuropePmcByIssn(journal.issn, args.rows);
      candidates = records.map((record) => normalizeEuropePmcCandidate(record, journal)).filter(Boolean);
    } catch (err) {
      process.stdout.write(`  europepmc err: ${err.message}\n`);
    }
    process.stdout.write(`  ${candidates.length} candidates\n`);

    for (const candidate of candidates) {
      if (downloaded >= needed) break outer;
      const doi = candidate.doi;
      if (!doi || seenDois.has(doi)) continue;
      attempted++;

      const slug = slugifyDoi(doi);
      const dest = path.join(outDir, `${slug}.pdf`);
      const dl = await downloadPdf(candidate.pdfUrl, dest);
      if (!dl.ok) {
        process.stdout.write(`  - ${doi}: ${dl.reason}\n`);
        continue;
      }
      downloaded++;
      seenDois.add(doi);
      const entry = {
        ...candidate,
        slug,
        pdfPath: path.relative(ROOT, dest).replace(/\\/g, "/"),
        bytes: dl.bytes,
        sourceUrl: dl.url,
        url: dl.url,
        downloadedAt: new Date().toISOString(),
      };
      delete entry.pdfUrl;
      manifest.push(entry);
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      process.stdout.write(`  + ${doi} -> ${slug}.pdf (${(dl.bytes / 1024).toFixed(0)} KB)\n`);
      await sleep(250);
    }

    if (downloaded >= needed) break;
    process.stdout.write(`  trying Crossref PDF links...\n`);
    let crossrefCandidates;
    try {
      crossrefCandidates = await fetchCrossrefByIssn(journal.issn, args.rows);
    } catch (err) {
      process.stdout.write(`  crossref err: ${err.message}\n`);
      continue;
    }
    for (const work of crossrefCandidates) {
      if (downloaded >= needed) break outer;
      const doi = (work.DOI ?? "").toLowerCase();
      if (!doi || seenDois.has(doi)) continue;
      attempted++;
      const pdfUrls = await findOaPdfCandidates(work);
      if (pdfUrls.length === 0) continue;
      const slug = slugifyDoi(doi);
      const dest = path.join(outDir, `${slug}.pdf`);
      let dl = null;
      let candidate = null;
      for (const pdfUrl of pdfUrls) {
        candidate = normalizeCrossrefCandidate(work, journal, pdfUrl);
        if (!candidate) break;
        dl = await downloadPdf(pdfUrl, dest);
        if (dl.ok) break;
        await sleep(200);
      }
      if (!candidate || !dl?.ok) continue;
      downloaded++;
      seenDois.add(doi);
      const entry = {
        ...candidate,
        slug,
        pdfPath: path.relative(ROOT, dest).replace(/\\/g, "/"),
        bytes: dl.bytes,
        sourceUrl: dl.url,
        url: dl.url,
        downloadedAt: new Date().toISOString(),
      };
      delete entry.pdfUrl;
      manifest.push(entry);
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      process.stdout.write(`  + ${doi} -> ${slug}.pdf (${(dl.bytes / 1024).toFixed(0)} KB)\n`);
      await sleep(250);
    }
  }

  const finalInScope = manifest.filter((entry) => layouts.includes(entry.layout)).length;
  process.stdout.write(`\nDone. Attempted ${attempted}, downloaded ${downloaded}, ${args.layout} entries ${finalInScope}/${args.target}, manifest size ${manifest.length}.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
