<div align="center">

# RW Screen

**本地优先的学术诚信筛查工具，基于 Retraction Watch 撤稿数据库。**

[English](./README.md) · 简体中文

[![CI](https://img.shields.io/github/actions/workflow/status/handsomeZR-netizen/retraction-watch-mcp/ci.yml?branch=main&label=CI&logo=github)](https://github.com/handsomeZR-netizen/retraction-watch-mcp/actions)
[![Version](https://img.shields.io/badge/version-0.4.0-2ea44f)](./package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript 5.9](https://img.shields.io/badge/TS-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio-6f42c1)](https://modelcontextprotocol.io/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](#-部署)
[![Tests](https://img.shields.io/badge/tests-118%20passing-brightgreen)](#-开发)

[快速开始](#-快速开始) · [Web 应用](#-web-应用) · [CLI](#%EF%B8%8F-cli) · [MCP](#-mcp-server) · [部署](#-部署) · [安全](#-安全)

</div>

---

## ✨ 这个工具能做什么

- **筛查作者** — 输入姓名 + 机构 / 邮箱 / DOI / PMID，返回保守、可追溯证据的撤稿作者匹配。
- **筛查稿件** — 拖入 PDF / DOCX / LaTeX，自动抽取每条参考文献并对照撤稿数据库逐条比对。
- **一套引擎，三种入口** — Web 应用 (`localhost:3210`)、CLI (`rw-query`)、MCP server (`rw-mcp`) 共用同一套 matcher 和策略。
- **默认本地优先** — 360 MB 的 Retraction Watch SQLite 存在本机；除非显式开启 LLM 辅助，**没有任何外网请求**。

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
# 生成 hex 密钥贴到 .env：
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3) 创建初始管理员账号（密码只在 shell 里出现，不进磁盘）
ADMIN_USERNAME=admin ADMIN_PASSWORD='起一个强密码' \
  npm run seed-admin -w @rw/web

# 4) 启动
npm run dev:web                         # 开发： http://localhost:3210
# 或
docker compose up -d                    # 生产： http://localhost
```

环境要求：**Node ≥ 20**、~1.5 GB 可用内存、导入后 ~500 MB 可用磁盘。`better-sqlite3` 是原生模块——Windows 需要 Visual Studio Build Tools，Linux 需要 `build-essential python3`，macOS 需要 Xcode CLI（绝大多数情况下 npm 会自动下载预编译二进制）。

---

## 📦 仓库结构

```
.
├── packages/
│   ├── core/         @rw/core    matcher · normalize · 策略 · CLI · MCP server
│   └── ingest/       @rw/ingest  PDF / DOCX / LaTeX → 参考文献 → LLM 客户端
├── apps/
│   └── web/          @rw/web     Next.js 15 应用（App Router · iron-session · SQLite）
├── mcpb/                         MCPB 清单与打包
├── docs/                         部署、验收标准、用例
├── Dockerfile                    多阶段 Node 20 构建（standalone Next.js）
└── docker-compose.yml            生产可用，env_file + 数据卷挂载
```

npm workspaces，不用 Turbo / Nx。每个包独立构建：`npm run build -w @rw/core`。

---

## 🌐 Web 应用

Web UI 是最方便的入口。登录后：

1. **拖入稿件**（PDF / DOCX / .tex / .zip）到首页。
2. 解析管线通过 SSE 流式推送进度：`uploaded → text_extracted → metadata_extracted → refs_segmented → refs_structured → screening → done`。
3. 结果页展示总裁决徽章、每条引用文献、命中条目的证据抽屉（含 Retraction Watch 原始记录）。
4. 通过 `/api/report/<id>?format=json|csv` 导出报告。

**内置裁决规则**

| 触发条件 | 裁决 |
|---|---|
| ≥1 条参考文献 DOI / PMID 精确命中撤稿记录 | **FAIL** |
| ≥1 条参考文献按标题（Jaccard ≥ 0.55）+ 作者重叠 + 年份 ±1 命中 | **REVIEW** |
| 弱部分匹配（仅标题或仅作者） | **REVIEW**（低置信度） |
| 全部参考文献清洁 | **PASS** |

每个结果页底部固定显示免责声明：*"本系统仅辅助筛查，不作为学术不端裁定的终审依据。"*

**可选 LLM 增强**（默认关闭）— 在 `/settings` 配置任意 OpenAI 兼容服务（DeepSeek、智谱、本地 vLLM、OpenAI 自身），切换参考文献 / 首页元数据的 LLM 抽取开关。API key 仅存服务端，使用 `RW_DATA_KEY` AES-256-GCM 静态加密。

---

## 🖥️ CLI

```bash
# 作者筛查
npm run query -- --name "Ahsen Maqsoom" --institution "COMSATS University"

# 严格模式（仅 DOI/PMID 精确匹配，软匹配进 nearMisses）
npm run query -- --strict --doi "10.1000/example"

# 本地安装诊断
npm run doctor                  # 人类可读
npm run doctor -- --json        # 机器可读
```

返回 JSON，包含 `verdict`、`candidates`、`nearMisses`、`evidence`、`safeSummary`、`consequentialUseWarning` 等字段。支持 `--policy balanced|strict|<path>.json` 自定义阈值。

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

提供的工具：`screen_person`、`screen_doi`、`screen_pmid`、`db_health`。与 CLI 共用同一引擎、同一证据 schema、同一策略集。

---

## 🐳 部署

一台 4 GB 的 VPS（阿里云 ECS、DigitalOcean、Hetzner）就够了。仓库自带的 `Dockerfile` 是多阶段构建，最终镜像约 500 MB（Next.js standalone + `better-sqlite3` 原生绑定）。

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

Compose 配置把 `${RW_HOST_PORT:-3210} → 3210`，挂载 `./data` 和 `./config` 作为持久化卷，设置 `NODE_OPTIONS=--max-old-space-size=2048` 把 Node 堆控制在 4 GB 机器的预算内，所有密钥从 `.env` 读。

HTTPS / 域名 / TLS 看 [`docs/DEPLOY.md`](docs/DEPLOY.md)；Cloudflare Workers / Pages 看 [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md)。

---

## 🔒 安全

- **本地优先存储**：两个数据库（`retraction-watch.sqlite`、`app.sqlite`）都是本地 SQLite 文件；没有后台遥测、没有外网请求（除非启用 LLM 辅助）。
- **审计日志只追加**：每个特权操作（登录、角色变更、稿件删除、强制注销）都在事务里写一条。`audit_log` 表的代码里**找不到任何 UPDATE / DELETE**——保留期由运维通过外部归档（logrotate、定时 SQLite 备份等）管理。
- **静态 AES-256-GCM 加密**：用户存的 LLM API key（`users.llm_settings_json`）和审计日志敏感字段都加密。密钥优先来自 `RW_DATA_KEY`，回退到 `RW_SESSION_SECRET`。生产环境两个都没有就拒绝启动。
- **CSRF 防御**：`middleware.ts` 强制 Origin / `Sec-Fetch-Site` 校验；生产环境只信任 `RW_BASE_URL`，不读 `Host` 头。所有改写状态的 API 调用都拒绝跨源请求。
- **Session 加固**：iron-session 加密 cookie、30 天 TTL、`httpOnly` + `secure`（生产）+ `sameSite=lax`。`session_version` 在改密码 / 禁用账号 / 强制注销时递增，立即吊销所有现有会话。
- **防 OAuth 账号接管**：GitHub OAuth 显式调用 `/user/emails` 校验主邮箱；只有 provider 明确返回 `email_verified = true` 才允许自动绑定到本地账号。
- **上传嗅探**：上传文件按魔术字节校验（PDF `%PDF-` / `%%EOF`、ZIP 本地头 + DOCX 的 `[Content_Types].xml`）——扩展名仅作参考。加密 PDF 和 xref 损坏的 PDF 在解析前直接拒绝。

---

## 🧪 开发

```bash
npm run typecheck           # 3 个包，TS 5.9 严格模式
npm run test                # 16 文件，118 测试（vitest + @rw/core、@rw/ingest）
npm run dev:web             # Next.js 开发服务器在 :3210
npm run lint -w @rw/web
```

每次推送 CI 跑 Linux / macOS / Windows × Node 20。

**版本管理**：4 个 `package.json`（root + 3 个 workspace）一起升；release 同步全部。monorepo 内部 `@rw/core` / `@rw/ingest` 的 dep 版本严格 pin 到完全一致。

---

## 📜 0.4.0 新增

- **四路 Codex 安全审计**：每个模块（auth、ingest、workspaces、admin）由一个并行 agent 全测试授权审查。修复包括：
  - Session TTL 对齐、OAuth state 时序安全比较、OAuth 邮箱必须 verified 才能自动绑定。
  - 服务端上传字节嗅探、PDF 解析资源释放、解析队列 stale-job 启动恢复。
  - 多租户授权测试、希伯来文/阿拉伯文/中文作者归一化、workspace 切换竞态修复。
  - 审计日志加固：AES-GCM 敏感字段加密、最后一名管理员锁定保护、append-only 不变性。
- **共享加密 helper** — `apps/web/lib/crypto/data-key.ts` 现在是 AES-256-GCM 的唯一来源，被 LLM API key 加密和审计日志加密共用。
- **生产可用的 Docker Compose** — `env_file: .env`、通过 `RW_APP_DB_DIR=/config` 持久化 `app.sqlite`、可配置 host 端口、Node 堆上限。
- **`.env.example`** 文档化所有环境变量。
- **测试从约 6 个文件扩到 16 个文件 / 118 个测试用例。**

---

## 📚 文档

- [`docs/DEPLOY.md`](docs/DEPLOY.md) — 完整部署指南（HTTPS、域名、备案、备份）
- [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md) — Cloudflare Pages / Workers
- [`docs/acceptance-criteria.md`](docs/acceptance-criteria.md) — 裁决语义和证据 schema
- [`docs/result-interpretation.md`](docs/result-interpretation.md) — 如何解读筛查报告
- [`docs/use-cases.md`](docs/use-cases.md) — 编辑流程、期刊集成模式

---

## 📄 协议

MIT — 见 [`LICENSE`](LICENSE)。

Retraction Watch 数据集版权 © Crossref / Center for Scientific Integrity，按 **CC BY 4.0** 分发。基于本工具发布的研究结果请注明数据来源。
