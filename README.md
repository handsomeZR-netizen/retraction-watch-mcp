<div align="center">

# RW Screen

**Local-first academic-integrity screening against the Retraction Watch database.**

English · [简体中文](./README.zh.md)

[![CI](https://img.shields.io/github/actions/workflow/status/handsomeZR-netizen/retraction-watch-mcp/ci.yml?branch=main&label=CI&logo=github)](https://github.com/handsomeZR-netizen/retraction-watch-mcp/actions)
[![Version](https://img.shields.io/badge/version-0.4.0-2ea44f)](./package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript 5.9](https://img.shields.io/badge/TS-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio-6f42c1)](https://modelcontextprotocol.io/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](#-deploy)
[![Tests](https://img.shields.io/badge/tests-118%20passing-brightgreen)](#-development)

[Quickstart](#-quickstart) · [Web app](#-web-app) · [CLI](#%EF%B8%8F-cli) · [MCP](#-mcp-server) · [Deploy](#-deploy) · [Security](#-security)

</div>

---

## ✨ What it does

- **Screen people** — given a name + institution / email / DOI / PMID, return conservative, evidence-backed matches against retracted authors.
- **Screen manuscripts** — drop a PDF / DOCX / LaTeX, get every reference checked against the retraction database in one pass.
- **One engine, three surfaces** — Web app (`localhost:3210`), CLI (`rw-query`), MCP server (`rw-mcp`) all share the same matcher and policies.
- **Local-first by default** — the 360 MB Retraction Watch SQLite lives on your disk; nothing leaves the box unless you explicitly enable the LLM helper.

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

## 📦 Repository layout

```
.
├── packages/
│   ├── core/         @rw/core    matcher · normalize · policies · CLIs · MCP server
│   └── ingest/       @rw/ingest  PDF / DOCX / LaTeX → references → LLM client
├── apps/
│   └── web/          @rw/web     Next.js 15 app (App Router · iron-session · SQLite)
├── mcpb/                         MCPB manifest + bundle
├── docs/                         Deployment, acceptance criteria, use cases
├── Dockerfile                    Multi-stage Node 20 build (standalone Next.js)
└── docker-compose.yml            Production-ready, env_file + volume mounts
```

npm workspaces, no Turbo / Nx. Every package builds in isolation: `npm run build -w @rw/core`.

---

## 🌐 Web app

The Web UI is the most ergonomic entry point. After login:

1. **Drag a manuscript** (PDF / DOCX / .tex / .zip) onto the home page.
2. The pipeline streams progress over SSE: `uploaded → text_extracted → metadata_extracted → refs_segmented → refs_structured → screening → done`.
3. The result page shows a verdict badge, every cited reference, and an evidence drawer with the original Retraction Watch record for any hit.
4. Export the result with `/api/report/<id>?format=json|csv`.

**Built-in detection rules**

| Trigger | Verdict |
|---|---|
| ≥1 reference DOI / PMID exact-matches a retraction | **FAIL** |
| ≥1 reference matches by title (Jaccard ≥ 0.55) + author overlap + year ±1 | **REVIEW** |
| Weak partial matches (title-only or author-only) | **REVIEW** (low confidence) |
| All references clean | **PASS** |

A disclaimer is pinned to the bottom of every result: *"This is a screening aid, not a final adjudication of misconduct."*

**Optional LLM enhancement** (off by default) — at `/settings`, point any OpenAI-compatible endpoint (DeepSeek, ZhipuAI, local vLLM, OpenAI itself) and toggle reference / header extraction. The API key stays server-side, encrypted at rest with `RW_DATA_KEY` (AES-256-GCM).

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

Tools exposed: `screen_person`, `screen_doi`, `screen_pmid`, `db_health`. Same engine as the CLI — same evidence schema, same policies.

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

- **Local-first storage.** Both databases (`retraction-watch.sqlite`, `app.sqlite`) are local SQLite files. No background telemetry, no outbound calls unless you opt in to the LLM helper.
- **Append-only audit log.** Every privileged action (login, role change, manuscript delete, force-logout) is logged once, in a transaction. The `audit_log` table has no UPDATE / DELETE statements anywhere in the codebase — retention is the operator's responsibility (archive externally if needed).
- **AES-256-GCM at rest** for sensitive fields: per-user LLM API keys (`users.llm_settings_json`) and selected audit log details. Key derives from `RW_DATA_KEY` (preferred) or `RW_SESSION_SECRET` (fallback). Production refuses to boot without one of them.
- **CSRF defense.** Origin / `Sec-Fetch-Site` enforcement in `middleware.ts`; production trusts only `RW_BASE_URL` (not the raw `Host` header). State-changing API calls reject cross-origin requests outright.
- **Session hardening.** iron-session sealed cookies, 30-day TTL, `httpOnly` + `secure` (prod) + `sameSite=lax`. `session_version` bumps on password change / disable / force-logout invalidate every existing session.
- **OAuth account-takeover prevention.** GitHub `/user/emails` is consulted explicitly to verify a primary email; auto-link to a local account requires the provider to assert `email_verified = true`.
- **Upload sniffing.** Uploads are validated by reading magic bytes (PDF `%PDF-` / `%%EOF`, ZIP local header + `[Content_Types].xml` for DOCX) — extension is advisory only. Encrypted PDFs and corrupted xref pointers are rejected before parsing.

---

## 🧪 Development

```bash
npm run typecheck           # 3 packages, strict TS 5.9
npm run test                # 16 files, 118 tests (vitest + @rw/core, @rw/ingest)
npm run dev:web             # Next.js dev on :3210
npm run lint -w @rw/web
```

CI runs on Linux / macOS / Windows × Node 20 on every push.

**Versioning.** All four `package.json` files (root + 3 workspaces) move together; a release bumps every one. Internal `@rw/core` / `@rw/ingest` deps inside the monorepo are pinned to the exact same version.

---

## 📜 What's new in 0.4.0

- **Four-way Codex security audit.** Each module (auth, ingest, workspaces, admin) was reviewed by a parallel agent with full test authority. Resulting fixes:
  - Session TTL alignment, OAuth state timing-safe comparison, OAuth verified-email enforcement.
  - Server-side upload byte-sniffing, PDF resource cleanup, parse queue stale-job recovery.
  - Multi-tenant authorization tests, Hebrew / Arabic / Chinese author normalization, workspace race-condition fix.
  - Hardened audit log with AES-GCM detail encryption, last-admin lockout prevention, append-only invariant.
- **Shared crypto helper** — `apps/web/lib/crypto/data-key.ts` is now the single source of truth for AES-256-GCM, used by both LLM API key encryption and audit detail encryption.
- **Production-ready Docker Compose** — `env_file: .env`, persistent `app.sqlite` via `RW_APP_DB_DIR=/config`, configurable host port, Node heap cap.
- **`.env.example`** documenting every env var.
- **Tests grew from ~6 files to 16 files / 118 cases.**

---

## 📚 Docs

- [`docs/DEPLOY.md`](docs/DEPLOY.md) — full deployment guide (HTTPS, domain, ICP, backup)
- [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md) — Cloudflare Pages / Workers
- [`docs/acceptance-criteria.md`](docs/acceptance-criteria.md) — verdict semantics & evidence schema
- [`docs/result-interpretation.md`](docs/result-interpretation.md) — how to read a screening report
- [`docs/use-cases.md`](docs/use-cases.md) — editorial workflows, journal integration patterns

---

## 📄 License

MIT — see [`LICENSE`](LICENSE).

The Retraction Watch dataset is © Crossref / Center for Scientific Integrity, distributed under **CC BY 4.0**. Credit them if you publish results derived from this tool.
