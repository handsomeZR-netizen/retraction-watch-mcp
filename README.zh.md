<div align="center">

# RW Screen

**本地优先的学术诚信筛查工具，基于 Retraction Watch 撤稿数据库。**

[English](./README.md) · 简体中文

[![CI](https://img.shields.io/github/actions/workflow/status/handsomeZR-netizen/retraction-watch-mcp/ci.yml?branch=main&label=CI&logo=github)](https://github.com/handsomeZR-netizen/retraction-watch-mcp/actions)
[![Version](https://img.shields.io/badge/version-0.5--precision-2ea44f)](./package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript 5.9](https://img.shields.io/badge/TS-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio-6f42c1)](https://modelcontextprotocol.io/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](#-部署)
[![Tests](https://img.shields.io/badge/tests-184%20passing-brightgreen)](#-开发)

[快速开始](#-快速开始) · [识别管线](#-识别管线) · [识别精度](#-识别精度) · [Web 应用](#-web-应用) · [CLI](#%EF%B8%8F-cli) · [MCP](#-mcp-server) · [部署](#-部署)

</div>

---

## ✨ 这个工具能做什么

- **筛查作者** — 输入姓名 + 机构 / 邮箱 / DOI / PMID，返回保守、可追溯证据的撤稿作者匹配。
- **筛查稿件** — 拖入 PDF / DOCX / LaTeX，自动抽取每条参考文献并对照撤稿数据库逐条比对。
- **一套引擎，三种入口** — Web 应用 (`localhost:3210`)、CLI (`rw-query`)、MCP server (`rw-mcp`) 共用同一套 matcher 和策略。
- **默认本地优先** — 360 MB 的 Retraction Watch SQLite 存在本机；除非显式开启 LLM 辅助或外源元数据增强，**没有任何外网请求**。
- **三重精度 gate** — 我们接受的每个外源 DOI 都同时通过：title Levenshtein ≥ 0.92、年份 ±1、**至少一个本地作者姓氏在外源作者列表中出现**。宁可标 `no_match` 也不给错的 DOI。

> **裁决固定为三档：** `PASS` · `REVIEW` · `FAIL`。**只有 DOI/PMID 精确命中才会判 `FAIL`**；软匹配会作为 `REVIEW` 提交，附完整证据链。

---

## 🚀 快速开始

```bash
git clone https://github.com/handsomeZR-netizen/retraction-watch-mcp.git
cd retraction-watch-mcp
npm ci

# 1) 构建撤稿数据库（约 15 分钟，360 MB）
npm run import

# 2) 配置密钥
cp .env.example .env
# 生成 hex 密钥贴进 .env：
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3) 创建初始管理员账户（密码只在 shell 中，不落盘）
ADMIN_USERNAME=admin ADMIN_PASSWORD='choose-a-strong-one' \
  npm run seed-admin -w @rw/web

# 4) 启动
npm run dev:web                         # 开发模式: http://localhost:3210
# 或
docker compose up -d                    # 生产模式: http://localhost
```

环境要求：**Node ≥ 20**，约 1.5 GB 空闲内存，import 后约 500 MB 磁盘。`better-sqlite3` 是 native 模块——Windows 需要 VS Build Tools，Linux 需要 `build-essential python3`，macOS 需要 Xcode CLI。多数平台直接拿到预编译二进制。

---

## 🧠 识别管线

每份上传的稿件都走同一套五阶段流水线，每阶段都可独立关掉，默认配置以**精度优先**。

```
PDF / DOCX / LaTeX
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 1. 文本抽取                                                    │
│    unpdf · mammoth · LaTeX bibliographies · tesseract.js OCR  │
│    ↳ 双栏 PDF 可选 layout-aware 重读（pdfjs bbox 列检测）      │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 2. 引用切分（splitter v2，三层 fallback）                      │
│    ① 正则头识别 + 行切分                                       │
│    ② 编号 marker / blob 解包兜底                               │
│    ③ LLM segmenter（仅当 ① 和 ② 都失败时触发）                  │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 3. 引用结构化                                                  │
│    正则命中 DOI / PMID 直通                                    │
│    未解析的进 LLM（默认 deepseek-v4-flash）                     │
│    ↳ 幻觉守卫: DOI/PMID/年份必须在原文中字面出现                │
│    ↳ 噪音 title 拒绝: 把 "57(6): 365-88" 类页码当 title 的拒收  │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 4. 外源元数据增强（3 源，融合 gate）                           │
│    ┌───────────┐  miss  ┌──────────┐  miss  ┌────────────┐    │
│    │ Crossref  ├───────▶│ OpenAlex ├───────▶│ S2（可选）  │    │
│    └───────────┘        └──────────┘        └────────────┘    │
│    每次接受必须同时满足:                                       │
│      title Levenshtein ≥ 0.92                                 │
│      年份 ±1                                                   │
│      ≥1 个本地作者姓氏在外源作者中出现                         │
│    单稿件每源调用上限 60 次。SQLite 缓存 30 天 TTL。            │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 5. 撤稿匹配                                                    │
│    DOI / PMID 硬路由 → BALANCED_POLICY                         │
│    否则: title + author Jaccard, year window                   │
│    Verdict: confirmed → FAIL · likely/possible → REVIEW        │
└───────────────────────────────────────────────────────────────┘
    │
    ▼
        result.json + screening_log + 证据抽屉
```

---

## 🎯 识别精度

**100-PDF 端到端基准（2026 年 4 月跑）** — 50 篇单栏（Cell Reports）+ 50 篇双栏（Procedia CS），从 Elsevier OA 抽取：

| 布局 | DOI 出现率 | Title 出现率 | 作者出现率 | 年份出现率 | 备注 |
|---|---|---|---|---|---|
| 单栏 50 | **97.8%** | 100% | 100% | 100% | 已触数据天花板 |
| 双栏 50 | **59.6%** | 99.5% | 99.9% | 100% | 每个 DOI 都通过三重 gate |

**为什么双栏约 40% 没拿到 DOI：**

| 类别 | 占无 DOI 比 | 管线能不能救 |
|---|---|---|
| 书 / ISO 标准 / URL 网页 | ~8% | ❌ 本身就没 DOI |
| 不被 Crossref / OpenAlex 收录的会议论文 | ~25% | ⚠️ Semantic Scholar API key 能救一部分 |
| 作者姓氏不重合（精度 gate 主动拒）| ~5% | ✅ **这就是精度的代价**——这些 candidate 几乎是错的 |
| 长尾（title 太脏、年份缺失等）| ~ 其余 | ⚠️ 放松 0.92 gate 能涨命中但会引入误匹配 |

完整诊断 + Key 申请操作手册：[`docs/IDENTIFICATION-PRECISION.md`](docs/IDENTIFICATION-PRECISION.md)。

---

## ⚙️ 配置开关一览

所有开关都在 `/settings`（UI）和 / 或环境变量里。

| 开关 | 默认 | 开了之后能拿到什么 | 关了会怎样 |
|---|---|---|---|
| **启用 LLM**（`config.llm.enabled`）| 关（设了 `RW_LLM_API_KEY` 自动开）| 引用结构化 fallback + 双栏 LLM segmenter（救回约 4/50 0-ref 失败）| 纯正则 + 启发式 |
| **LLM 首页元数据增强**（`config.llm.enableHeaderParse`）| 开 | 双栏作者 recall ~0.83 → ~0.92 | 每篇省 ~1 次 LLM 调用 |
| **外源元数据增强**（`config.enrichment.enabled`）| 开 | Crossref + OpenAlex 反查 DOI（双栏 +19 pts，单栏 +16 pts）| 仅本地抽取 |
| **联系邮箱**（`config.enrichment.contactEmail`）| 必填，否则上一项无效 | Crossref / OpenAlex polite-pool 限速放宽 | 增强会静默不跑 |
| **云端 OCR**（`config.ocr.cloudEnabled`）| 关 | 扫描件走云端 OCR | 仅本地 tesseract.js |
| `RW_S2_API_KEY`（环境变量）| 未设 | Semantic Scholar 第三源开启（预期双栏 +5-10 pts）| S2 客户端不构造（无 rate-limit 开销）|
| `RW_USE_ENRICHED_PIPELINE=0`（环境变量）| 未设 | 强制关闭整条 enriched 管线（紧急回滚用）| 默认开 |
| `RW_OPENALEX_API_KEY`（环境变量）| 未设 | OpenAlex 高级配额（10× 速率）| 免费层（10 万/天，足够）|

---

## 🌐 Web 应用

Web UI 是最常用的入口。登录后：

1. **拖一份稿件**（PDF / DOCX / .tex / .zip）到首页 Dropzone。
2. 流水线通过 SSE 流式推送进度：`uploaded → text_extracted → metadata_extracted → refs_segmented → refs_structured → screening → done`。
3. 结果页显示裁决标识、每条引用、以及命中时弹出"证据抽屉"展示原始 Retraction Watch 记录。
4. 每条 ref 的 `ProvenanceList` 显示每个字段的来源（regex / LLM / Crossref / OpenAlex / Semantic Scholar），带置信度条和冲突标记。
5. 通过 `/api/report/<id>?format=json|csv` 导出结果。

**内置裁决规则**

| 触发条件 | Verdict |
|---|---|
| ≥1 条 ref 的 DOI / PMID 精确命中撤稿记录 | **FAIL** |
| ≥1 条 ref 通过 title (Jaccard ≥ 0.55) + 作者重合 + 年份 ±1 软匹配 | **REVIEW** |
| 仅 title 或仅作者的弱匹配 | **REVIEW**（低置信）|
| 全部 ref 干净 | **PASS** |

每张结果页底部钉一行：*"This is a screening aid, not a final adjudication of misconduct."*

---

## 🖥️ CLI

```bash
# 作者筛查
npm run query -- --name "Ahsen Maqsoom" --institution "COMSATS University"

# 严格模式（仅 DOI/PMID 精确，软匹配只显示在 nearMisses）
npm run query -- --strict --doi "10.1000/example"

# 本地诊断
npm run doctor                  # 人类可读
npm run doctor -- --json        # 机器可读
```

返回 JSON 含 `verdict`, `candidates`, `nearMisses`, `evidence`, `safeSummary`, `consequentialUseWarning`。支持 `--policy balanced|strict|<path>.json` 自定义阈值。

完整参数：`npm run query -- --help`。

---

## 🔌 MCP server

通过 stdio 接入 Claude Desktop / Cursor / Claude Code：

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

暴露的工具：`screen_person`, `screen_batch`, `lookup_record`, `lookup_doi`, `explain_match`, `get_source_versions`。引擎 / 证据 schema / 策略与 CLI 完全一致。

---

## 📦 仓库结构

```
.
├── packages/
│   ├── core/         @rw/core    matcher · normalize · policies · CLIs · MCP server
│   └── ingest/       @rw/ingest  PDF / DOCX / LaTeX → 引用 → 外源增强
│       ├── refs.ts                    splitter v2（三层 fallback）
│       ├── pdf-layout.ts              双栏 layout-aware 重抽
│       ├── extraction/
│       │   ├── confidence.ts          source / tier / provenance helpers
│       │   └── validate-llm.ts        幻觉守卫 + 噪音 title 拒绝
│       ├── external/
│       │   ├── http-client.ts         polite-pool HTTP（重试 + 退避）
│       │   ├── cache.ts               SQLite 外源响应缓存
│       │   ├── crossref.ts            Crossref REST 客户端
│       │   ├── europepmc.ts           Europe PMC 客户端（PMID → DOI）
│       │   ├── openalex.ts            OpenAlex Works API 客户端
│       │   ├── semantic-scholar.ts    Semantic Scholar 客户端（env 控制）
│       │   └── fusion.ts              title + year + author-surname gate
│       └── pipeline/
│           ├── extract-candidates.ts  纯本地结构化
│           └── enrich-metadata.ts     四步外源增强协调器
├── apps/
│   └── web/          @rw/web     Next.js 15（App Router · iron-session · SQLite）
├── mcpb/                         MCPB manifest + bundle
├── docs/                         IDENTIFICATION-PRECISION, DEPLOY, acceptance-criteria, …
├── scripts/
│   └── test-corpus/              dual-run benchmark + verdict-breakdown 报表
├── Dockerfile                    多阶段 Node 20 构建（standalone Next.js）
└── docker-compose.yml            生产可用，env_file + volume 挂载
```

npm workspaces，没有 Turbo / Nx。每个包独立构建：`npm run build -w @rw/core`。

---

## 🐳 部署

一台 4 GB VPS（阿里云 ECS、DigitalOcean、Hetzner）就够了。`Dockerfile` 多阶段，最终镜像约 500 MB。

```bash
# 服务器上（推荐 Ubuntu 22.04）
git clone https://github.com/handsomeZR-netizen/retraction-watch-mcp.git
cd retraction-watch-mcp

cp .env.example .env                    # 编辑：RW_SESSION_SECRET、RW_DATA_KEY、RW_BASE_URL、RW_HOST_PORT
mkdir -p data config
RW_MCP_DB_PATH=$PWD/data/retraction-watch.sqlite npm run import   # 约 30 分钟，360 MB

docker compose up -d
docker compose logs -f rw-screen
```

Compose 会把 `${RW_HOST_PORT:-3210} → 3210` 暴露，把 `./data` 和 `./config` 挂载为持久卷，设置 `NODE_OPTIONS=--max-old-space-size=2048` 把 Node 堆控制在 4 GB 内，所有密钥从 `.env` 读。

HTTPS / 域名 / TLS 见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。Cloudflare Workers / Pages 见 [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md)。

---

## 🔒 安全

- **本地优先存储**。两个数据库（`retraction-watch.sqlite`、`app.sqlite`）都是本地 SQLite。无后台遥测、无外网请求，除非显式启用 LLM 或外源增强。
- **Append-only 审计日志**。所有特权操作（登录、改角色、删稿件、强退）在事务里记一次。`audit_log` 表在代码里没有 UPDATE / DELETE 语句——保留策略由运维决定（外部归档自处理）。
- **AES-256-GCM 静态加密** 用户级 LLM API key（`users.llm_settings_json`）和部分审计详情。密钥从 `RW_DATA_KEY`（首选）或 `RW_SESSION_SECRET`（兜底）派生。生产环境二者都不设会拒启动。
- **CSRF 防护**。`middleware.ts` 强制 Origin / `Sec-Fetch-Site`；生产只信任 `RW_BASE_URL`，不信任 `Host` 请求头。状态变更 API 一律拒绝跨 origin。
- **Session 加固**。iron-session 密封 cookie，30 天 TTL，`httpOnly` + `secure`（生产）+ `sameSite=lax`。改密码 / 禁用 / 强退会 bump `session_version`，让所有现存 session 失效。
- **OAuth 账户接管防御**。GitHub `/user/emails` 显式查验主邮箱；自动绑定到本地账户必须 provider 断言 `email_verified = true`。
- **上传嗅探**。文件类型读 magic bytes（PDF `%PDF-` / `%%EOF`、ZIP local header + `[Content_Types].xml` for DOCX）——后缀仅作 hint。加密 PDF / 损坏 xref 在 parse 之前就拒掉。
- **LLM 幻觉守卫**。LLM 输出的 DOI / PMID / year 必须在原始引用文本中**字面出现**；任何形如 vol(issue):page 或 month-day 片段的 title 直接被拒绝。

---

## 🧪 开发

```bash
npm run typecheck           # 3 个包，strict TS 5.9
npm run test                # 20 个测试文件，184 用例（vitest + @rw/core, @rw/ingest）
npm run dev:web             # Next.js dev on :3210
npm run lint -w @rw/web

# 重跑 benchmark（需要 RW_LLM_API_KEY + RW_CONTACT_EMAIL）：
node scripts/test-corpus/dual-run.mjs \
  --manifest test-corpus/elsevier-oa/manifest-double-50.json \
  --enriched-out test-corpus/elsevier-oa/parsed-double-50-mine \
  --skip-legacy --concurrency 4

node scripts/test-corpus/verdict-breakdown.mjs \
  --before test-corpus/elsevier-oa/parsed-double-50-v0.5 \
  --after  test-corpus/elsevier-oa/parsed-double-50-mine
```

CI 在 Linux / macOS / Windows × Node 20 每次 push 都跑。

**版本号**。根 + 3 个 workspace 一起 bump，每个 release 全部更新。Monorepo 内部 `@rw/core` / `@rw/ingest` 互相依赖固定到完全相同的版本号。最近稳定 tag：`v0.5-precision`（当前），`v0.5-openalex`（recall 高，gate 弱）。

---

## 📜 更新日志

### v0.5-precision（2026 年 5 月）— 当前

- **三重 fusion gate**：每个外源 DOI 必须同时满足 title (Levenshtein ≥ 0.92) + year (±1) + 至少一个本地作者姓氏在外源中出现。姓氏提取支持 "Last, First" / "First Last" / 中日韩姓氏 / 去音标（Müller ↔ Muller）。
- **三个外源**：Crossref → OpenAlex → Semantic Scholar（S2 由 env 控制）。所有源用同一套 fusion gate。
- **LLM noisy title 三层拒绝**（heuristic / LLM / merge）——`"Aug 17;57(6):365–88."` 和 `"7(1): p. 373-384."` 这种片段不再污染 Crossref title-search。
- **Splitter v2**：三层 fallback（regex → numbered-marker / blob-unwrap → LLM segmenter）。双栏 50-PDF benchmark 0-ref 失败从 4/50 降到 0/50。
- **双栏 layout-aware 重抽**：pdfjs `getTextContent` + bbox 列检测，仅在 regex splitter 信号兜底时触发。
- **enriched 管线默认开**（`RW_USE_ENRICHED_PIPELINE !== "0"`）：填了联系邮箱就自动 Crossref / OpenAlex 反查 DOI。
- **LLM 结构化结果缓存**：`structureReferences` 批以 `sha256(model + prompt-version + payload)` 为 key。重跑零成本。
- **单稿外源调用上限**（Crossref / OpenAlex / S2 各 60 次）防止异常长 bibliography 把 polite pool 跑爆。
- **184 单测**（0.4.0 时是 118），CI 三平台全绿。
- 新文档：[`docs/IDENTIFICATION-PRECISION.md`](docs/IDENTIFICATION-PRECISION.md) 给客户用的精度交底文档。

### v0.4.0 — 上一个稳定版

- 四线并行 Codex 安全审计。每个模块（auth、ingest、workspaces、admin）由独立 agent 全测试权限审查；修复一起合并。
- 共享加密 helper `apps/web/lib/crypto/data-key.ts` —— LLM key 加密和审计详情加密的唯一来源。
- 生产可用 Docker Compose：`env_file: .env`、`app.sqlite` 持久化（`RW_APP_DB_DIR=/config`）、可配置宿主端口、Node 堆 cap。
- `.env.example` 列全所有环境变量。

---

## 📚 文档

- [`docs/IDENTIFICATION-PRECISION.md`](docs/IDENTIFICATION-PRECISION.md) — **新增**。当前精度数据、痛点拆解、API key 申请操作手册。
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — 完整部署指南（HTTPS、域名、ICP、备份）
- [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md) — Cloudflare Pages / Workers
- [`docs/acceptance-criteria.md`](docs/acceptance-criteria.md) — verdict 语义和证据 schema
- [`docs/result-interpretation.md`](docs/result-interpretation.md) — 怎么读筛查报告
- [`docs/use-cases.md`](docs/use-cases.md) — 编辑工作流、期刊集成模式

---

## 🗺️ 路线图

按 ROI 排，开放方向：

| 方向 | 预期收益 | 成本 | 状态 |
|---|---|---|---|
| 申请 Semantic Scholar API key | 双栏 +5-10 pts DOI | 1 周邮件等 | **推荐**——代码已就绪，只需 `RW_S2_API_KEY` |
| 申请 OpenAlex 高级 key | benchmark 速度 +50% | 1 天 | **推荐**——同一套 `RW_OPENALEX_API_KEY` |
| 加 DBLP 覆盖 CS 会议论文 | 双栏 +3-5 pts | 1 天工作量 | Backlog |
| 外部 GPU 服务跑 layout-aware OCR（MinerU 这类）| 双栏 +5-10 pts | ¥0.5-2 / 稿件 | Backlog（等真扫描件 corpus 出现再做）|

**不在路线图上：**

- 放松 0.92 fusion gate。我们选的方向是收紧不是放松。
- 在生产 VPS 上自部署 MinerU / PaddleOCR。4 GB RAM 不够。
- 用 GPT-4 / Claude 替代 deepseek-v4-flash。30× 单价差换不来明显的 extraction 提升。

---

## 📄 License

MIT — 见 [`LICENSE`](LICENSE)。

Retraction Watch 数据集 © Crossref / Center for Scientific Integrity，按 **CC BY 4.0** 分发。如果你用本工具的结果发表论文，请显式归属。
