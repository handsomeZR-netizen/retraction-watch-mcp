<div align="center">

# RW Screen

**Local-first academic-integrity screening against the Retraction Watch database.**

English · [简体中文](./README.zh.md)

[![CI](https://img.shields.io/github/actions/workflow/status/handsomeZR-netizen/retraction-watch-mcp/ci.yml?branch=main&label=CI&logo=github)](https://github.com/handsomeZR-netizen/retraction-watch-mcp/actions)
[![Version](https://img.shields.io/badge/version-0.5--precision-2ea44f)](./package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript 5.9](https://img.shields.io/badge/TS-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio-6f42c1)](https://modelcontextprotocol.io/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](#-deploy)
[![Tests](https://img.shields.io/badge/tests-184%20passing-brightgreen)](#-development)

[Quickstart](#-quickstart) · [Pipeline](#-the-identification-pipeline) · [Precision](#-recognition-precision) · [Web app](#-web-app) · [CLI](#%EF%B8%8F-cli) · [MCP](#-mcp-server) · [Deploy](#-deploy)

</div>

---

## ✨ What it does

- **Screen people** — given a name + institution / email / DOI / PMID, return conservative, evidence-backed matches against retracted authors.
- **Screen manuscripts** — drop a PDF / DOCX / LaTeX, every reference is checked against the retraction database in one pass.
- **One engine, three surfaces** — Web app (`localhost:3210`), CLI (`rw-query`), MCP server (`rw-mcp`) all share the same matcher and policies.
- **Local-first by default** — the 360 MB Retraction Watch SQLite lives on your disk; nothing leaves the box unless you explicitly enable the LLM helper or external metadata enrichment.
- **Three-gate precision** — every external DOI we accept agrees with the local extraction on title (Levenshtein ≥ 0.92), year (±1) AND at least one author surname. We'd rather report `no_match` than the wrong DOI.

> **Verdict is always one of three:** `PASS` · `REVIEW` · `FAIL`. Only exact DOI/PMID hits ever produce `FAIL` — soft matches are surfaced as `REVIEW` with full evidence.

---

## 🚀 Quickstart

```bash
git clone https://github.com/handsomeZR-netizen/retraction-watch-mcp.git
cd retraction-watch-mcp
npm ci

# 1) Build the retraction database (~15 min, 360 MB)
npm run import

# 2) Configure secrets
cp .env.example .env
# generate hex secrets and paste into .env:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3) Seed the first admin user (password stays in your shell, never on disk)
ADMIN_USERNAME=admin ADMIN_PASSWORD='choose-a-strong-one' \
  npm run seed-admin -w @rw/web

# 4) Run
npm run dev:web                         # dev:   http://localhost:3210
# or
docker compose up -d                    # prod:  http://localhost
```

Requirements: **Node ≥ 20**, ~1.5 GB free RAM, ~500 MB free disk after import. `better-sqlite3` is native — Windows users need VS Build Tools, Linux needs `build-essential python3`, macOS needs the Xcode CLI tools (most platforms get prebuilt binaries automatically).

---

## 🧠 The identification pipeline

Every uploaded manuscript flows through the same five-stage pipeline. Each stage is opt-out; defaults aim at maximum precision.

```
PDF / DOCX / LaTeX
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 1. Text extraction                                            │
│    unpdf · mammoth · LaTeX bibliographies · tesseract.js OCR  │
│    ↳ Optional double-column layout-aware re-read (pdfjs bbox) │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 2. Reference splitter (3-tier fallback)                       │
│    ① regex header + line splitter                             │
│    ② numbered-marker / blob-unwrap salvage                    │
│    ③ LLM segmenter (only fires when ① and ② both miss)        │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 3. Reference structuring                                      │
│    regex DOI / PMID hits go straight through                  │
│    Unresolved refs go to LLM (deepseek-v4-flash by default)   │
│    ↳ Hallucination guard: DOI/PMID/year must appear in raw    │
│    ↳ Title-noise guard: page-range, vol(issue):page rejected  │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 4. External enrichment (3 sources, fusion-gated)              │
│    ┌───────────┐  miss  ┌──────────┐  miss  ┌────────────┐    │
│    │ Crossref  ├───────▶│ OpenAlex ├───────▶│ S2 (opt-in) │   │
│    └───────────┘        └──────────┘        └────────────┘    │
│    Each acceptance must clear:                                │
│      title Levenshtein ≥ 0.92                                 │
│      year ±1                                                  │
│      ≥1 local author surname matches external authors         │
│    Per-manuscript caps: 60 calls each. SQLite cache 30 d TTL. │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 5. Retraction matching                                        │
│    DOI / PMID hard route → BALANCED_POLICY                    │
│    Otherwise: title + author Jaccard, year window             │
│    Verdict: confirmed → FAIL · likely/possible → REVIEW       │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
        result.json + screening_log + evidence drawer
```

---

## 🎯 Recognition precision

**100-PDF live benchmark (Apr 2026)** — 50 single-column (Cell Reports) + 50 double-column (Procedia CS) sampled from Elsevier OA:

| Layout | DOI present | Title present | Author present | Year present | Notes |
|---|---|---|---|---|---|
| Single-column 50 | **97.8%** | 100% | 100% | 100% | Already at the data ceiling |
| Double-column 50 | **59.6%** | 99.5% | 99.9% | 100% | Every DOI passes the three-gate |

**Why ~40% of double-column refs don't get a DOI:**

| Category | Share | Pipeline can fix? |
|---|---|---|
| Books / ISO standards / URLs | ~8% | ❌ Intrinsically have no DOI |
| Conference papers not indexed by Crossref or OpenAlex | ~25% | ⚠️ Semantic Scholar API key may help |
| Author-surname mismatch (precision gate rejected the candidate) | ~5% | ✅ This **is** the precision win — those candidates were wrong |
| Long-tail (dirty title, missing year) | ~ rest | ⚠️ Loosening the 0.92 gate would lift recall but introduce false positives |

Full diagnosis + API key application guide: [`docs/IDENTIFICATION-PRECISION.md`](docs/IDENTIFICATION-PRECISION.md).

---

## ⚙️ Configuration matrix

All toggles live in `/settings` (UI) and / or environment variables.

| Switch | Default | What turning it ON gives you | What turning it OFF gives you |
|---|---|---|---|
| **LLM enabled** (`config.llm.enabled`) | off (env auto-on if `RW_LLM_API_KEY` present) | Reference structuring fallback + double-column LLM segmenter (saves ~4/50 0-ref failures) | Pure regex + heuristics |
| **LLM header parse** (`config.llm.enableHeaderParse`) | on | Author recall on double-column papers ~0.83 → ~0.92 | Saves ~1 LLM call per manuscript |
| **External enrichment** (`config.enrichment.enabled`) | on | Crossref + OpenAlex reverse-DOI lookup (~+19 pts double, +16 pts single) | Pure local extraction |
| **Contact email** (`config.enrichment.contactEmail`) | required for enrichment | Polite-pool throughput on Crossref / OpenAlex | Enrichment silently no-ops |
| **Cloud OCR** (`config.ocr.cloudEnabled`) | off | Image-OCR scanned PDFs via cloud service | Local tesseract.js only |
| `RW_S2_API_KEY` (env) | unset | Semantic Scholar third source enabled (predicted +5-10 pts double) | S2 client never constructed (no rate-limit overhead) |
| `RW_USE_ENRICHED_PIPELINE=0` | unset | Force-disable the entire enriched pipeline (rollback) | Default is enriched on |
| `RW_OPENALEX_API_KEY` (env) | unset | Higher OpenAlex quota (10× rate limit) | Free tier (100k/day, sufficient) |
| `cloudOcr` | off | Sends page images to a third-party OCR API | Skipped — only tesseract.js local |

---

## 🌐 Web app

The Web UI is the most ergonomic entry point. After login:

1. **Drag a manuscript** (PDF / DOCX / .tex / .zip) onto the home page.
2. The pipeline streams progress over SSE: `uploaded → text_extracted → metadata_extracted → refs_segmented → refs_structured → screening → done`.
3. The result page shows a verdict badge, every cited reference, and an evidence drawer with the original Retraction Watch record for any hit.
4. The `ProvenanceList` next to each ref shows where each field came from (regex / LLM / Crossref / OpenAlex / Semantic Scholar) with confidence bars and conflict markers.
5. Export the result with `/api/report/<id>?format=json|csv`.

**Built-in detection rules**

| Trigger | Verdict |
|---|---|
| ≥1 reference DOI / PMID exact-matches a retraction | **FAIL** |
| ≥1 reference matches by title (Jaccard ≥ 0.55) + author overlap + year ±1 | **REVIEW** |
| Weak partial matches (title-only or author-only) | **REVIEW** (low confidence) |
| All references clean | **PASS** |

A disclaimer is pinned to the bottom of every result: *"This is a screening aid, not a final adjudication of misconduct."*

---

## 🖥️ CLI

```bash
# Person screen
npm run query -- --name "Ahsen Maqsoom" --institution "COMSATS University"

# Strict mode (DOI/PMID exact only — softer matches go to nearMisses)
npm run query -- --strict --doi "10.1000/example"

# Local install diagnostics
npm run doctor                  # human
npm run doctor -- --json        # machine
```

Returns JSON with `verdict`, `candidates`, `nearMisses`, `evidence`, `safeSummary`, and `consequentialUseWarning`. Supports `--policy balanced|strict|<path>.json` for custom thresholds.

Full flag list: `npm run query -- --help`.

---

## 🔌 MCP server

Plug RW Screen into Claude Desktop / Cursor / Claude Code via stdio:

```json
{
  "mcpServers": {
    "retraction-watch": {
      "command": "npx",
      "args": ["-y", "@rw/core", "rw-mcp"],
      "env": { "RW_MCP_DB_PATH": "/abs/path/to/retraction-watch.sqlite" }
    }
  }
}
```

Tools exposed: `screen_person`, `screen_batch`, `lookup_record`, `lookup_doi`, `explain_match`, `get_source_versions`. Same engine as the CLI — same evidence schema, same policies.

---

## 📦 Repository layout

```
.
├── packages/
│   ├── core/         @rw/core    matcher · normalize · policies · CLIs · MCP server
│   └── ingest/       @rw/ingest  PDF / DOCX / LaTeX → references → external enrichment
│       ├── refs.ts                    splitter v2 (3-tier fallback)
│       ├── pdf-layout.ts              double-column layout-aware re-extractor
│       ├── extraction/
│       │   ├── confidence.ts          source / tier / provenance helpers
│       │   └── validate-llm.ts        hallucination guard + title-noise rejection
│       ├── external/
│       │   ├── http-client.ts         polite-pool HTTP w/ retries + backoff
│       │   ├── cache.ts               SQLite-backed external response cache
│       │   ├── crossref.ts            Crossref REST client
│       │   ├── europepmc.ts           Europe PMC client (PMID → DOI)
│       │   ├── openalex.ts            OpenAlex Works API client
│       │   ├── semantic-scholar.ts    Semantic Scholar client (env-gated)
│       │   └── fusion.ts              title + year + author-surname gate
│       └── pipeline/
│           ├── extract-candidates.ts  local-only structuring
│           └── enrich-metadata.ts     4-step external enrichment orchestrator
├── apps/
│   └── web/          @rw/web     Next.js 15 app (App Router · iron-session · SQLite)
├── mcpb/                         MCPB manifest + bundle
├── docs/                         IDENTIFICATION-PRECISION, DEPLOY, acceptance-criteria, …
├── scripts/
│   └── test-corpus/              dual-run benchmark + verdict-breakdown reporter
├── Dockerfile                    Multi-stage Node 20 build (standalone Next.js)
└── docker-compose.yml            Production-ready, env_file + volume mounts
```

npm workspaces, no Turbo / Nx. Every package builds in isolation: `npm run build -w @rw/core`.

---

## 🐳 Deploy

A 4 GB VPS (Aliyun ECS, DigitalOcean, Hetzner) is enough. The included `Dockerfile` is multi-stage and produces a ~500 MB final image (Next.js standalone + `better-sqlite3` native binding).

```bash
# On the server (Ubuntu 22.04 recommended)
git clone https://github.com/handsomeZR-netizen/retraction-watch-mcp.git
cd retraction-watch-mcp

cp .env.example .env                    # then edit: RW_SESSION_SECRET, RW_DATA_KEY, RW_BASE_URL, RW_HOST_PORT
mkdir -p data config
RW_MCP_DB_PATH=$PWD/data/retraction-watch.sqlite npm run import   # ~30 min, 360 MB

docker compose up -d
docker compose logs -f rw-screen
```

The Compose file maps `${RW_HOST_PORT:-3210} → 3210`, mounts `./data` and `./config` as persistent volumes, sets `NODE_OPTIONS=--max-old-space-size=2048` to keep Node within budget on a 4 GB box, and reads every secret from `.env`.

For HTTPS / domain / TLS, see [`docs/DEPLOY.md`](docs/DEPLOY.md). For Cloudflare Workers / Pages, see [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md).

---

## 🔒 Security

- **Local-first storage.** Both databases (`retraction-watch.sqlite`, `app.sqlite`) are local SQLite files. No background telemetry, no outbound calls unless you opt in to LLM or external enrichment.
- **Append-only audit log.** Every privileged action (login, role change, manuscript delete, force-logout) is logged once, in a transaction. The `audit_log` table has no UPDATE / DELETE statements anywhere in the codebase — retention is the operator's responsibility (archive externally if needed).
- **AES-256-GCM at rest** for sensitive fields: per-user LLM API keys (`users.llm_settings_json`) and selected audit log details. Key derives from `RW_DATA_KEY` (preferred) or `RW_SESSION_SECRET` (fallback). Production refuses to boot without one of them.
- **CSRF defense.** Origin / `Sec-Fetch-Site` enforcement in `middleware.ts`; production trusts only `RW_BASE_URL` (not the raw `Host` header). State-changing API calls reject cross-origin requests outright.
- **Session hardening.** iron-session sealed cookies, 30-day TTL, `httpOnly` + `secure` (prod) + `sameSite=lax`. `session_version` bumps on password change / disable / force-logout invalidate every existing session.
- **OAuth account-takeover prevention.** GitHub `/user/emails` is consulted explicitly to verify a primary email; auto-link to a local account requires the provider to assert `email_verified = true`.
- **Upload sniffing.** Uploads are validated by reading magic bytes (PDF `%PDF-` / `%%EOF`, ZIP local header + `[Content_Types].xml` for DOCX) — extension is advisory only. Encrypted PDFs and corrupted xref pointers are rejected before parsing.
- **LLM hallucination guard.** Any DOI / PMID / year emitted by the LLM must appear verbatim in the source ref text; any title that looks like a vol(issue):page or month-day fragment is rejected.

---

## 🧪 Development

```bash
npm run typecheck           # 3 packages, strict TS 5.9
npm run test                # 20 files, 184 tests (vitest + @rw/core, @rw/ingest)
npm run dev:web             # Next.js dev on :3210
npm run lint -w @rw/web

# Reproduce the benchmark (requires RW_LLM_API_KEY + RW_CONTACT_EMAIL):
node scripts/test-corpus/dual-run.mjs \
  --manifest test-corpus/elsevier-oa/manifest-double-50.json \
  --enriched-out test-corpus/elsevier-oa/parsed-double-50-mine \
  --skip-legacy --concurrency 4

node scripts/test-corpus/verdict-breakdown.mjs \
  --before test-corpus/elsevier-oa/parsed-double-50-v0.5 \
  --after  test-corpus/elsevier-oa/parsed-double-50-mine
```

CI runs on Linux / macOS / Windows × Node 20 on every push.

**Versioning.** All four `package.json` files (root + 3 workspaces) move together; a release bumps every one. Internal `@rw/core` / `@rw/ingest` deps inside the monorepo are pinned to the exact same version. Recent stable tags: `v0.5-precision` (current), `v0.5-openalex` (higher recall, weaker gate).

---

## 📜 What's new

### v0.5-precision (May 2026) — current

- **Three-gate fusion**: every external DOI must agree on title (Levenshtein ≥ 0.92), year (±1) AND at least one local author surname. Surname extractor handles "Last, First" / "First Last" / CJK family-names / diacritic-stripping (Müller ↔ Muller).
- **Three external sources**: Crossref → OpenAlex → Semantic Scholar (S2 env-gated). Same fusion gate for all.
- **LLM title-noise rejection** at three layers (heuristic / LLM / merge) — `"Aug 17;57(6):365–88."` and `"7(1): p. 373-384."` style fragments no longer pollute Crossref title-search.
- **Splitter v2**: 3-tier fallback (regex → numbered-marker / blob-unwrap → LLM segmenter). Eliminated 4/50 0-ref failures on double-column corpus.
- **Double-column layout-aware re-read**: pdfjs `getTextContent` + bbox column detection, only fires when the regex splitter signals trouble.
- **Default-on enrichment** (`RW_USE_ENRICHED_PIPELINE !== "0"`): Crossref / OpenAlex reverse-DOI lookup runs whenever a contact email is configured.
- **LLM result cache**: `structureReferences` batches keyed by `sha256(model + prompt-version + payload)`. Re-runs are free.
- **Per-manuscript external-call caps** (60 each for Crossref / OpenAlex / S2) prevent runaway bibliographies from exhausting polite pools.
- **184 tests** (was 118 in 0.4.0), CI green on Linux / macOS / Windows × Node 20.
- New docs: [`docs/IDENTIFICATION-PRECISION.md`](docs/IDENTIFICATION-PRECISION.md) for client-facing precision walkthrough.

### v0.4.0 — previous

- Four-way Codex security audit. Each module (auth, ingest, workspaces, admin) was reviewed by a parallel agent with full test authority; resulting fixes shipped together.
- Shared crypto helper at `apps/web/lib/crypto/data-key.ts` — single source of truth for AES-256-GCM, used for both LLM API key encryption and audit detail encryption.
- Production-ready Docker Compose: `env_file: .env`, persistent `app.sqlite` via `RW_APP_DB_DIR=/config`, configurable host port, Node heap cap.
- `.env.example` documenting every environment variable.

---

## 📚 Docs

- [`docs/IDENTIFICATION-PRECISION.md`](docs/IDENTIFICATION-PRECISION.md) — **NEW**. Current precision numbers, pain points, API key application guide.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — full deployment guide (HTTPS, domain, ICP, backup)
- [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md) — Cloudflare Pages / Workers
- [`docs/acceptance-criteria.md`](docs/acceptance-criteria.md) — verdict semantics & evidence schema
- [`docs/result-interpretation.md`](docs/result-interpretation.md) — how to read a screening report
- [`docs/use-cases.md`](docs/use-cases.md) — editorial workflows, journal integration patterns

---

## 🗺️ Roadmap

Open paths, ranked by ROI:

| Direction | Predicted gain | Cost | Status |
|---|---|---|---|
| Apply for Semantic Scholar API key | +5-10 pts double-column DOI | 1 week wait | **Recommended** — code already present, just needs `RW_S2_API_KEY` env |
| Apply for OpenAlex authenticated key | Benchmark speed +50% | 1 day wait | **Recommended** — same `RW_OPENALEX_API_KEY` pattern |
| Add DBLP for CS-conference coverage | +3-5 pts double-column | 1 day dev | Backlog |
| External GPU service for layout-aware OCR (MinerU class) | +5-10 pts double-column | ¥0.5-2/manuscript | Backlog (deferred until corpus shows non-text-layer PDFs) |

**Not on the roadmap:**

- Lowering the 0.92 fusion gate. Tightening, not relaxing, is the chosen direction.
- Self-hosted heavy OCR (MinerU / PaddleOCR) on the production VPS. 4 GB RAM is insufficient.
- Replacing deepseek-v4-flash with frontier models. The 30× cost difference doesn't translate into measurably better extraction.

---

## 📄 License

MIT — see [`LICENSE`](LICENSE).

The Retraction Watch dataset is © Crossref / Center for Scientific Integrity, distributed under **CC BY 4.0**. Credit them if you publish results derived from this tool.
