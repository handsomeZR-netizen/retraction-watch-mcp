# RW Screen — 学术诚信筛查工具集

[![License: MIT](https://img.shields.io/github/license/handsomeZR-netizen/retraction-watch-mcp)](./LICENSE)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio-6f42c1)](https://modelcontextprotocol.io/)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Local First](https://img.shields.io/badge/local--first-privacy-111827)](#-隐私与安全)

> 本地运行的学术诚信筛查工具集：基于 Crossref 公开的 Retraction Watch 撤稿数据库，对作者和投稿稿件做保守、可解释、可复核的比对。
>
> 既可以以 **CLI / MCP server** 形态查"某个人是否出现在撤稿名单"，也可以以 **Next.js Web 站点** 形态查"一篇投稿是否引用了撤稿文献"。

---

## 目录

- [快速概览](#-快速概览)
- [仓库结构](#-仓库结构-monorepo)
- [前置依赖](#-前置依赖)
- [安装](#-安装)
- [初始化撤稿数据库](#-初始化撤稿数据库)
- [Web 应用：稿件诚信筛查](#-web-应用稿件诚信筛查)
- [CLI 用法](#-cli-用法)
- [MCP Server](#-mcp-server)
- [匹配策略](#-匹配策略)
- [API：HTTP 接口](#-apihttp-接口)
- [架构与数据流](#-架构与数据流)
- [部署](#-部署)
- [隐私与安全](#-隐私与安全)
- [能做什么 / 不能做什么](#-能做什么-不能做什么)
- [开发与测试](#-开发与测试)
- [排障 FAQ](#-排障-faq)
- [路线图](#-路线图)
- [数据源与许可](#-数据源与许可)

---

## 🔍 快速概览

| 场景 | 入口 | 说明 |
| --- | --- | --- |
| 查"某个人/作者是否出现在撤稿名单" | `rw-query` CLI / MCP `screen_person` tool | 输入姓名 + 邮箱/机构/DOI/PMID，返回保守可解释的匹配证据 |
| 审"一篇投稿稿件是否引用了撤稿文献" | Web `http://localhost:3210` | 拖拽 PDF / Word / LaTeX，自动抽取参考文献并逐条比对 |
| 程序化集成（Claude Desktop / Cursor / Claude Code） | MCP server `rw-mcp` | stdio 接入，复用同一引擎与策略 |

**核心设计原则：**
- ✅ **本地优先**：撤稿数据库在本机 SQLite；查询输入默认不出网
- ✅ **保守可解释**：每条匹配都附 `evidence[]` 证据明细 + 严格/平衡两种策略
- ✅ **裁决三档不一刀切**：`PASS` / `REVIEW` / `FAIL` —— 仅 DOI/PMID 精确命中才会判 `FAIL`
- ✅ **可选 LLM 增强**：参考文献结构化抽取支持 DeepSeek / OpenAI 兼容服务，默认关闭

---

## 📦 仓库结构 (monorepo)

npm workspaces，3 个内部包：

```
.
├── packages/
│   ├── core/         @rw/core    引擎 + CLI + MCP server
│   │   ├── src/
│   │   │   ├── data/         SQLite (better-sqlite3) 仓库 / 导入器 / 模式
│   │   │   ├── matching/     matcher (人级) + reference-matcher (文献级) + normalize
│   │   │   ├── mcp/          MCP server + prompts
│   │   │   ├── cli/          rw-import / rw-query / rw-doctor / rw-mcp 入口
│   │   │   └── policy.ts     balanced / strict 策略
│   │   └── policies/         JSON 策略文件
│   └── ingest/       @rw/ingest  稿件解析 + LLM 客户端
│       └── src/
│           ├── pdf.ts          unpdf (PDF 文本)
│           ├── docx.ts         mammoth (Word)
│           ├── latex.ts        .tex / .bib / .zip 解析
│           ├── ocr.ts          tesseract.js fallback
│           ├── metadata.ts     正则抽作者/机构/邮箱/ORCID
│           ├── refs.ts         References 段落定位 + 切分 + 正则 DOI
│           ├── llm-client.ts   OpenAI SDK + baseURL，DeepSeek 兼容
│           └── screen-manuscript.ts  端到端编排
├── apps/
│   └── web/          @rw/web    Next.js 15 站点
│       ├── app/                App Router：页面 + API 路由
│       └── lib/                config / repository / store / sse 工具
├── mcpb/             MCPB manifest 与打包
├── docs/             架构与验收文档
├── Dockerfile        多阶段镜像
└── docker-compose.yml
```

---

## 🛠 前置依赖

- **Node.js ≥ 20** （建议 20.10+；Web 应用需要 Next.js 15）
- 操作系统：Windows / macOS / Linux
- 磁盘：撤稿数据库导入后约 360 MB
- **`better-sqlite3` 是 native 模块**，安装时若没下到预编译二进制会自编译：
  - Windows：需要 Visual Studio Build Tools
  - Linux：`apt install build-essential python3`
  - macOS：`xcode-select --install`
  - 大部分情况下 npm 会自动下载预编译 binary，无需配环境

---

## 🚀 安装

```bash
git clone https://github.com/handsomeZR-netizen/retraction-watch-mcp.git
cd retraction-watch-mcp
npm install        # 自动安装 packages/* 与 apps/web 依赖
npm run build      # 构建 @rw/core 与 @rw/ingest
npm run build:web  # （仅生产部署需要）构建 Next.js 站点
```

构建产物：
| 路径 | 说明 |
| --- | --- |
| `packages/core/dist/` | 编译后的引擎 + CLI bin（`rw-mcp`、`rw-import`、`rw-query`、`rw-doctor`） |
| `packages/ingest/dist/` | 编译后的解析管线 |
| `apps/web/.next/` | Next.js 站点（standalone build） |

> 本仓库**不会**提交生成后的 SQLite 数据库；首次使用时通过 `npm run import` 拉取。

---

## 📥 初始化撤稿数据库

首次使用前需要先把 Retraction Watch CSV 导入本地：

```bash
npm run import
```

CSV 大小约 64 MB，导入后 SQLite 数据库约 360 MB。默认位置：

| 平台 | 默认路径 |
| --- | --- |
| Windows | `C:\Users\<you>\.retraction-watch-mcp\retraction-watch.sqlite` |
| macOS / Linux | `~/.retraction-watch-mcp/retraction-watch.sqlite` |

自定义位置（任选其一）：

```bash
# 通过命令行参数
npm run import -- --db-path ./data/retraction-watch.sqlite

# 通过环境变量（CLI/MCP/Web 都生效）
export RW_MCP_DB_PATH=/abs/path/to/retraction-watch.sqlite
export RW_MCP_DATA_DIR=/abs/path/to/dir   # 仅指定目录，文件名固定
```

更新数据：重新跑 `npm run import` 即可（覆盖旧文件）。

诊断本地安装：

```bash
npm run doctor          # 人类可读
npm run doctor -- --json  # 机器可读
```

---

## 🌐 Web 应用：稿件诚信筛查

### 启动开发服务器

```bash
npm run dev:web
# 浏览器打开 http://localhost:3210
```

### 使用流程

```
[首页] 拖拽 PDF / .docx / .tex / .zip
        ↓
[/api/upload]  保存到 ~/.config/rw-screen/manuscripts/<id>/
        ↓
[/api/parse]   SSE 流式上报阶段：
               uploaded → text_extracted → metadata_extracted
               → refs_segmented → refs_structured → screening → done
        ↓
[/result/<id>] 总裁决徽章 + 元信息卡 + 参考文献逐行命中
               (点击命中行展开证据抽屉，包含 RW 原始记录)
        ↓
[导出] /api/report/<id>?format=json|csv
```

### 检测规则

| 情况 | 裁决 |
| --- | --- |
| 至少 1 条参考文献 DOI 或 PMID 精确命中撤稿数据库 | **FAIL** |
| 至少 1 条参考文献无 DOI 但标题 Jaccard ≥ 0.55 + 作者重叠 + 年份 ±1 | **REVIEW** |
| 部分弱匹配（仅标题或仅作者） | REVIEW（低置信） |
| 全部清洁 | **PASS** |

底部固定显示免责声明："本系统仅辅助筛查，不作为学术不端裁定的终审依据。"

### LLM 配置（可选）

打开 `http://localhost:3210/settings`，填写：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| Base URL | `https://api.deepseek.com/v1` | 任何 OpenAI 兼容服务，例如智谱 `https://api.z.ai/api/paas/v4`、本地 vLLM、OpenAI 等 |
| Model | `deepseek-v4-flash` | OAI 兼容的 model 名 |
| API Key | (空) | 仅保存在服务端配置文件，永不回包前端 |
| Enable LLM Refs Parse | ❌ | 启用 LLM 增强参考文献解析 |
| Enable LLM Header Parse | ❌ | 启用 LLM 增强首页元数据 |
| Cloud OCR | ❌ | 扫描版 PDF 时启用云端 OCR（默认本地 tesseract.js） |
| Keep uploads | ❌ | 是否保留稿件副本（默认 24h 后自动清理） |

#### LLM 抽取流程（参考文献）

1. References 段落按字号 / 编号 / 段落空行切分成单条 ref
2. 第一道：正则抽 DOI / PMID（覆盖现代论文 ~90%）
3. 第二道：剩余条目按 20 条/批发给 LLM，强制 `tool_choice=emit_references` JSON Schema 严格输出
4. 失败重试 1 次，仍失败降级到 regex-only

#### 不通过 UI 配置（环境变量）

```bash
export DEEPSAPI_API_KEY=sk-xxx                  # 或 RW_LLM_API_KEY
export RW_LLM_BASE_URL=https://api.deepseek.com/v1
export RW_LLM_MODEL=deepseek-v4-flash
```

> ⚠️ **API Key 安全**：key 不会写入仓库、不会出现在 git diff、不会回到前端。如果走 UI 配置，仅服务端 `~/.config/rw-screen/config.json` 持久化，请确保该文件读权限。

---

## 💻 CLI 用法

### 单人筛查（同 MCP `screen_person`）

```bash
npm run query -- --name "Ahsen Maqsoom" --institution "COMSATS University Islamabad"
```

输出 JSON，包含 `verdict` / `candidates` / `nearMisses` / `evidence` / `safeSummary` / `consequentialUseWarning` 等。

#### 完整选项

```
--name <name>                       Required. 人名（中英文都支持）
--email <email>                     Optional. 仅域名作为弱证据
--institution <institution>         Optional. 机构
--doi <doi>                         Optional. 原论文 DOI 或撤稿声明 DOI
--pmid <pmid>                       Optional. PubMed ID
--include-notice-types <csv>        Optional. RetractionNature 过滤，例如 "Retraction,Correction"
--limit <n>                         Optional. 候选数 (1-50)
--db-path <path>                    Optional. 自定义 SQLite 路径
--policy <name|file>                Optional. balanced / strict / 自定义 JSON 路径
--strict                            Shortcut for --policy strict
--help                              帮助
```

### 严格模式

```bash
npm run query -- --strict --name "Ahsen Maqsoom" --institution "COMSATS University Islamabad"
```

严格模式：仅 DOI/PMID 精确命中才会作为正式候选；其它姓名/机构相似项一律降级到 `nearMisses`。

### 全局命令

```bash
npm link
rw-import --help
rw-query --name "..." --institution "..."
rw-doctor --json
rw-mcp --help
```

### 直接跑 TS 源码（开发）

```bash
npm run dev:import
npm run dev:query -- --name "Ahsen Maqsoom"
npm run dev:mcp
```

---

## 🧠 MCP Server

启动 stdio MCP server：

```bash
npm run mcp
# 自定义路径
npm run mcp -- --db-path /abs/path/to/retraction-watch.sqlite
# 严格策略
npm run mcp -- --policy strict
```

### MCP Tools

| Tool | 作用 |
| --- | --- |
| `screen_person` | 单人筛查 (姓名/邮箱/机构/DOI/PMID) |
| `screen_batch` | 批量筛查多人 |
| `lookup_record` | 通过 Record ID 查询单条记录 |
| `lookup_doi` | 通过 DOI 精确查询 |
| `explain_match` | 解释某查询与某条记录的打分证据 |
| `get_source_versions` | 返回数据快照与匹配策略元信息 |

### MCP Resources

- `rw://source-version` — 当前数据快照
- `rw://match-policy/current` — 当前匹配策略
- `rw://record/{record_id}` — 任意记录详情

### MCP Prompts

| Prompt | 作用 |
| --- | --- |
| `screen-author` | 单人筛查工作流（措辞谨慎） |
| `review-match-result` | 把 JSON 转成非定罪式人工复核摘要 |
| `batch-integrity-check` | 批量诚信初筛 |
| `explain-limitations` | 解释工具能做什么、不能证明什么 |

### Claude Desktop 配置

```json
{
  "mcpServers": {
    "retraction-watch": {
      "command": "node",
      "args": ["D:\\path\\to\\retraction-watch-mcp\\packages\\core\\dist\\index.js"],
      "env": {
        "RW_MCP_DB_PATH": "D:\\path\\to\\retraction-watch.sqlite"
      }
    }
  }
}
```

### Cursor 配置

`.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "retraction-watch": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/retraction-watch-mcp/packages/core/dist/index.js"],
      "env": {
        "RW_MCP_DB_PATH": "/abs/path/to/retraction-watch.sqlite"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add retraction-watch -- node /abs/path/to/retraction-watch-mcp/packages/core/dist/index.js
```

---

## ⚖️ 匹配策略

### 策略文件

- `packages/core/policies/balanced.json` — 默认平衡策略
- `packages/core/policies/strict.json` — 严格策略（`hardIdentifiersOnly = true`）

### 关键参数（节选）

| 字段 | 默认 (balanced) | 说明 |
| --- | --- | --- |
| `thresholds.likelyMatch` | 0.7 | 人级 likely match 分数门槛 |
| `thresholds.referenceConfirmed` | 0.95 | 文献级 confirmed 门槛 |
| `thresholds.referenceLikely` | 0.7 | 文献级 likely 门槛 |
| `thresholds.referenceTitleJaccardLikely` | 0.55 | 标题相似度高阈值 |
| `thresholds.referenceTitleJaccardPossible` | 0.3 | 标题相似度可疑阈值 |
| `weights.doiExact` / `weights.referenceDoiExact` | 1.0 | DOI 精确命中 |
| `weights.referenceTitleHigh` | 0.55 | 高标题相似度加分 |
| `weights.referenceAuthorOverlap` | 0.25 | 作者重叠加分 |
| `weights.referenceYearMatch` | 0.1 | 年份 ±1 加分 |
| `weights.referenceYearConflictPenalty` | -0.15 | 年份差距 ≥4 扣分 |
| `safety.hardIdentifiersOnly` | false (balanced) / true (strict) | 仅 DOI/PMID 精确才作为正式候选 |

### 自定义策略

把 balanced.json 复制为 `my-policy.json`，调整阈值和权重，然后：

```bash
rw-query --policy ./my-policy.json --name "..."
rw-mcp --policy ./my-policy.json
```

---

## 🌐 API：HTTP 接口

Web 站点暴露的 REST 接口（全部 `runtime: nodejs`）：

| Method & Path | 用途 |
| --- | --- |
| `POST /api/screen-person` | 单人筛查（等价于 MCP `screen_person`） |
| `POST /api/upload` | multipart 上传稿件，返回 `{ manuscriptId, fileName, fileType, bytes, uploadedAt }` |
| `GET  /api/parse?manuscriptId=...` | SSE 流式触发解析 + 筛查 |
| `GET  /api/result/[id]` | 拉取已生成的 JSON 结果 |
| `GET  /api/report/[id]?format=json\|csv` | 下载报告（`application/json` 或 `text/csv`） |
| `GET  /api/settings` | 读取当前配置（API key 已脱敏为 `***`） |
| `POST /api/settings` | 更新配置 |

### `POST /api/screen-person` 示例

```bash
curl -X POST http://localhost:3210/api/screen-person \
  -H "Content-Type: application/json" \
  -d '{"name":"Ahsen Maqsoom","institution":"COMSATS University Islamabad","strict_mode":false}'
```

返回（节选）：

```json
{
  "queryId": "uuid",
  "verdict": "likely_match",
  "identityConfirmed": false,
  "reviewRequired": true,
  "score": 0.72,
  "candidates": [...],
  "nearMisses": [],
  "evidence": [
    { "field": "name", "strength": "medium", "scoreDelta": 0.48, "message": "Author name exactly matches ..." },
    { "field": "institution", "strength": "medium", "scoreDelta": 0.24, "message": "Institution has high token overlap ..." }
  ],
  "safeSummary": "A likely record-level similarity ...",
  "consequentialUseWarning": "This result must not be used as the sole basis for hiring, ...",
  "policyVersion": "rw-person-screening-v2"
}
```

### `POST /api/upload` + `GET /api/parse` SSE 示例

```bash
ID=$(curl -s -F file=@manuscript.pdf http://localhost:3210/api/upload | jq -r .manuscriptId)
curl -N "http://localhost:3210/api/parse?manuscriptId=$ID"
# data: {"stage":"uploaded","message":"manuscript.pdf (1234.5 KB)"}
# data: {"stage":"text_extracted","message":"已提取 45678 字符（12 页）"}
# data: {"stage":"metadata_extracted","message":"识别到 4 位作者；标题: ..."}
# data: {"stage":"refs_segmented","message":"参考文献分割：48 条"}
# data: {"stage":"refs_structured","message":"结构化参考文献：48 条"}
# data: {"stage":"screening","message":"5/48 已比对"}
# ...
# data: {"stage":"done","message":"verdict=PASS; saved","manuscriptId":"...","detail":{...}}
```

---

## 🏗 架构与数据流

### 引擎核心 (`@rw/core`)

```
[CSV (Crossref/GitLab)]
      ↓ rw-import
[SQLite: rw_records / rw_authors / rw_institutions / rw_dois / source_snapshots]
      ↑
[matching/normalize.ts]  归一化 (DOI / 名字 / 标题 / 中文拼音)
[matching/matcher.ts]    人级评分：DOI/PMID/Name/Institution/Email
[matching/reference-matcher.ts]  文献级评分：DOI/PMID/Title-Jaccard/Authors/Year/Journal
[policy.ts]              balanced / strict 阈值与权重
```

### 解析管线 (`@rw/ingest`)

```
buffer + fileType
  ├─ pdf      → unpdf (extractText + getMeta 并行) → ExtractedDocument
  ├─ docx     → mammoth.extractRawText
  └─ latex    → 解 .zip (yauzl.fromBuffer) → strip TeX → 解 .bib + \bibitem

ExtractedDocument
  ├─ extractHeaderMetadata (regex / 启发式 + 可选 LLM)
  └─ locateAndSplitReferences → regexStructure (DOI/PMID 直查)
                              ↘ 余下 → DeepseekLlmClient.structureReferences
                                       (按 20 条/批，tool_choice 强制 JSON Schema)
```

### Web 编排 (`@rw/web`)

```
[upload]──► [SSE parse]──► screenManuscript
                              ↓
              repository.findReferenceCandidates
                              ↓ 逐条
              screenReference (复用 matcher 的证据格式)
                              ↓
              ManuscriptScreenResult (JSON 写入 ~/.config/rw-screen/manuscripts/<id>/result.json)
                              ↓
              [/result/<id>] 渲染 + [/api/report] 导出
```

### 数据模型简化

```
rw_records (record_id PK)
  ├── rw_authors      (record_id FK, normalized_name, surname, signature)
  ├── rw_institutions (record_id FK, normalized_institution)
  └── rw_dois         (record_id FK, doi_type, doi)
```

索引：`idx_rw_authors_normalized` / `_signature` / `_surname`、`idx_rw_institutions_norm`、`idx_rw_dois_doi`、`idx_rw_records_nature`。

---

## 📦 部署

### 零成本零绑卡方案：Cloudflare Tunnel

**最推荐的低风险演示部署**，详细步骤见 [docs/DEPLOY-CLOUDFLARE.md](./docs/DEPLOY-CLOUDFLARE.md)。一句话上手：

```bash
# 终端 A
RW_MCP_DB_PATH=/abs/path/retraction-watch.sqlite npm run dev:web

# 终端 B
cloudflared tunnel --url http://localhost:3210
```

立刻拿到 `https://*.trycloudflare.com` 的临时 HTTPS 公网 URL。绑自有域名 + 加 Cloudflare Access 鉴权全部免费。

### Docker（自托管 24×7）

```bash
mkdir -p ./data ./config
cp /path/to/retraction-watch.sqlite ./data/retraction-watch.sqlite

docker compose up -d
# 浏览器打开 http://localhost:3210
```

`docker-compose.yml` 已经把 `./data` 与 `./config` 挂载到容器，数据库文件不会打进镜像。

环境变量（容器内默认值）：

| 变量 | 容器默认 |
| --- | --- |
| `RW_MCP_DB_PATH` | `/data/retraction-watch.sqlite` |
| `RW_SCREEN_CONFIG_DIR` | `/config` |
| `RW_SCREEN_DATA_DIR` | `/data/manuscripts` |

### 自托管 Node 进程

```bash
npm run build && npm run build:web
NODE_ENV=production node apps/web/.next/standalone/apps/web/server.js
# 默认监听 3210（next start -p 3210 的别名）
```

### 反向代理

Nginx 示例（保留 SSE keepalive）：

```nginx
location / {
    proxy_pass http://127.0.0.1:3210;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 600s;
}
```

### MCPB 打包

```bash
npm run mcpb:stage
npm run mcpb:pack
```

打包出的 `.mcpb` 不内置 SQLite 数据库，安装后需要把 `db_path` 指向本机 `rw-import` 生成的数据库。

---

## 🔒 隐私与安全

| 项目 | 默认行为 |
| --- | --- |
| Retraction Watch CSV 下载 | 仅在 `rw-import` 时连接 GitLab，不传任何查询输入 |
| 单人 / 文献筛查 | 完全本地，**不出网** |
| LLM 参考文献增强 | **默认关闭**；启用后仅参考文献文本片段发往所配置的 OAI 兼容服务 |
| 云端 OCR | **默认关闭**；启用后仅扫描版 PDF 整页图片上传 |
| 稿件副本 | 默认 24h 后自动清理（可在 `/settings` 关闭） |
| API Key | 服务端持久化在 `~/.config/rw-screen/config.json`，UI 显示脱敏 `***`，永不回包到前端 |
| 邮箱 | 仅域名用作弱证据；用户名部分被丢弃 |
| 查询日志 | 不记录、不上报；进程重启即丢 |

> **未来**：如果你打算把 Web 站点部署成多用户在线服务，需要额外实现：登录/RBAC、审计日志、稿件加密落盘、合规免责弹窗。

---

## ✅ 能做什么 / 不能做什么

### 能做什么

- 从 Retraction Watch CSV 构建本地 SQLite 索引，秒级查询
- 单人保守筛查：DOI/PMID 精确 → `confirmed`；姓名+机构高重叠 → `likely_match`；纯姓名相似 → `possible_match`；其它 → `no_match`
- 整篇稿件参考文献逐条比对：DOI/PMID 命中即 FAIL；标题 Jaccard + 作者重叠 + 年份匹配 → REVIEW
- 中英混排支持：中文姓名走拼音回退；中文标题走 bigram tokens
- 双策略：balanced（默认）/ strict（仅硬标识符命中作为正式候选）
- 可解释：每条匹配附 `evidence[]` 明细 + `safeSummary` 措辞模板

### 不能做什么

- **不是**身份裁定系统：非 DOI/PMID 命中只是字符串相似度，不能证明同一人 / 同一论文
- **不能**证明个人存在学术不端
- 不会做"全文相似度反查"（比如检测正文是否援引了撤稿文献的观点） —— v0.2 计划之一
- 不会自动给参考文献加权重判官式裁决；最终还是需要编辑/评审人复核

### Retraction Watch 数据本身的限制

- 没有邮箱字段
- 作者列表与机构列表无法一一对应
- 名字字符串不带 ROR / ORCID 的官方映射

---

## 🧰 开发与测试

### 全量验证

```bash
npm install
npm run typecheck   # 三个 workspace 全部 typecheck
npm test            # @rw/core vitest（@rw/ingest 暂无单测，--passWithNoTests）
npm run build       # 构建 core + ingest
npm run build:web   # 构建 Next.js
npm run doctor      # 检查 Node / SQLite / DB / policy 状态
```

### 单跑某个包

```bash
npm run typecheck -w @rw/core
npm run test -w @rw/core
npm run build -w @rw/ingest
npm run dev:web -w @rw/web        # 或根目录 npm run dev:web
```

### 测试集（建议）

构建一个本地 `tests/fixtures/` 目录用于回归：

| 目录 | 内容 | 期望 |
| --- | --- | --- |
| `pass/` | 5 篇正常英文稿件 | PASS |
| `fail-doi/` | 5 篇引用了撤稿论文（带 DOI） | FAIL |
| `review-no-doi/` | 5 篇引用了撤稿但 ref 不带 DOI | REVIEW 或 FAIL |
| `cn-mixed/` | 5 篇含中文期刊参考文献 | 视情况 |

跑：

```bash
for f in tests/fixtures/**/*.pdf; do
  ID=$(curl -s -F file=@"$f" http://localhost:3210/api/upload | jq -r .manuscriptId)
  curl -s "http://localhost:3210/api/parse?manuscriptId=$ID" > /dev/null
  curl -s "http://localhost:3210/api/report/$ID?format=json" | jq '{file:"'"$f"'", verdict, totals}'
done
```

---

## 🔧 排障 FAQ

**Q: `Local Retraction Watch database not found`**
A: 先跑 `npm run import`；或确认 `RW_MCP_DB_PATH` 指向真实文件，或 `--db-path` 路径正确。

**Q: `npm run doctor` 显示 better-sqlite3 失败**
A: native 模块编译失败，安装系统构建工具（见[前置依赖](#-前置依赖)）；或者用 nvm 切回纯净 Node 20.x 重装 `npm install`。

**Q: Web 站点能起，但 `/api/parse` 报 "manuscript not found"**
A: 上传成功后会返回 `manuscriptId`，确认 SSE URL 用了同一个；检查 `~/.config/rw-screen/manuscripts/<id>/upload.json` 是否存在。

**Q: 启用了 LLM 增强但参考文献仍未结构化**
A: 检查 `/settings`：(1) Enable LLM Refs Parse 是否打开；(2) Base URL/Model/Key 是否正确；(3) `/api/parse` SSE 中 `refs_structured` 阶段的 `detail.llmCalls` 是否 > 0；(4) 服务端日志是否有 OpenAI 401/429。

**Q: PDF 是扫描版，文本提取为空**
A: 默认会触发本地 tesseract.js（中英文识别）；如需更高精度，开启 `/settings` 的 Cloud OCR 开关并接入云服务（v0.2 完善）。

**Q: 中文期刊参考文献漏匹配**
A: `screenReference` 已对中文做拼音回退 + bigram tokens，但短标题（< 4 字）召回会偏低。如果遇到大量中文 ref，建议同时启用 LLM 增强让作者/标题字段更干净。

**Q: 想看为什么某条 ref 被判 confirmed**
A: 在结果页点击命中行，右侧会展开 `MatchEvidence[]` 明细；或调 `/api/report/<id>?format=json` 拿到 `screenedReferences[*].result.evidence` 列表。

**Q: MCP 客户端启动但 tools 调不通**
A: 确认已跑 `npm run build`；MCP 配置的 `args` 指向 `packages/core/dist/index.js`（绝对路径）；`RW_MCP_DB_PATH` 已设置。

**Q: 导入很慢 / SQLite 文件很大**
A: CSV 64 MB → SQLite 约 360 MB 是预期值（多张表 + 多个索引）；首次 SSD 上约 30-60s。

---

## 🗺 路线图

- [ ] FTS5 + 批量候选检索：单稿件 SQL 调用从 ~1000 次降到 <50 次
- [ ] 全文相似度反查：检测正文是否援引撤稿文献观点（段落级嵌入 + 向量检索）
- [ ] 多用户登录 / 查询历史 / 审计日志
- [ ] 撤稿数据库 cron 自动刷新 + Webhook
- [ ] PDF 扫描版的高质量 OCR 管线（pdf-to-img + tesseract.js / 云 OCR）
- [ ] 更完整的机构别名与 ROR 增强
- [ ] CSV 报告中加入 RW 撤稿声明 URL 直链
- [ ] 移到 `pnpm` workspaces（可选，目前 npm 工作良好）

---

## 📚 数据源与许可

**主数据源：**

```
https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv
```

Crossref 文档说明 GitLab 仓库是保持 Retraction Watch 数据更新的推荐来源。本项目直接下载 raw CSV 用于本地工作流。旧的 Crossref Labs 接口不作为稳定契约，Retraction Watch 网页搜索页也不会作为程序化主入口。

Crossref 将 Retraction Watch database 标为 **CC0**。若在论文、报告或公开成果中使用，请按 Retraction Watch 用户指南引用数据源。

**项目代码许可：MIT**（见 [LICENSE](./LICENSE)）。Retraction Watch / Crossref 数据本身不随本仓库分发。

---

## 致谢

- Crossref 与 Retraction Watch 的数据维护团队
- [unpdf](https://github.com/unjs/unpdf)、[mammoth](https://github.com/mwilliamson/mammoth.js)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)、[pinyin-pro](https://github.com/zh-lx/pinyin-pro)、[tesseract.js](https://github.com/naptha/tesseract.js) 等开源依赖

如果发现误报或漏报，请提交 issue 附上：
1. 输入（脱敏后即可）
2. 期望裁决 vs 实际裁决
3. `evidence[]` 明细
4. 对应 RW 记录的 `recordId`
