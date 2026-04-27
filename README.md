# Retraction Watch MCP

[![CI](https://github.com/handsomeZR-netizen/retraction-watch-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/handsomeZR-netizen/retraction-watch-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/handsomeZR-netizen/retraction-watch-mcp)](./LICENSE)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio-6f42c1)](https://modelcontextprotocol.io/)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](./package.json)

一个本地运行的 Model Context Protocol (MCP) server，用于基于 Crossref 分发的公开 Retraction Watch 数据集做保守、可解释的学术诚信记录筛查。

本项目默认本地运行：Retraction Watch CSV 会被下载并索引到本机 SQLite 数据库，姓名、邮箱、机构等查询输入不会上传到远端服务。

## 项目状态

- 版本：`0.1.0`
- 运行环境：Node.js `>=20`
- MCP 传输：`stdio`
- 支持平台：Windows、macOS、Linux
- 数据存储：由 `rw-import` 在本地生成 SQLite
- 默认发行方式：GitHub clone 后本地构建运行

## 能做什么

- 下载 Crossref/GitLab 上的 Retraction Watch CSV，并构建本地 SQLite 索引。
- 提供 MCP tools：单人筛查、批量筛查、DOI 查询、记录查询、匹配解释、数据版本查询。
- 使用保守、可解释的匹配策略。
- 支持输入 `name`、`email`、`institution`、`doi`、`pmid`。
- 默认返回全部 `RetractionNature` 类型，并在结果里明确标注。
- 将正式候选 `candidates` 和弱/冲突证据 `nearMisses` 分开。
- 每次筛查都会提示 Retraction Watch 原始数据没有作者到机构的一一映射。

## 不能做什么

这个工具是筛查辅助工具，不是身份裁定系统。

非 DOI/PMID 命中的结果只表示输入信息与 Retraction Watch 记录中的作者字符串、机构字符串相似。它不能证明输入的人就是记录中的同一个个体，也不能证明个人存在学术不端。

特别注意：

- Retraction Watch 公开数据没有邮箱字段。
- 邮箱只会被降级为域名弱证据，例如 `name@example.edu` 只使用 `example.edu`。
- 作者列表和机构列表不能建立一一对应关系。
- 只有 DOI/PMID 精确命中才会返回 `confirmed`。
- `likely_match` 和 `possible_match` 都需要人工复核。

## 安装

```bash
git clone https://github.com/handsomeZR-netizen/retraction-watch-mcp.git
cd retraction-watch-mcp
npm ci
npm run build
```

构建产物会生成到 `dist/`。本仓库不会提交生成后的 Retraction Watch SQLite 数据库。

## 初始化或更新数据

首次使用 MCP server 前，需要先导入数据：

```bash
npm run import
```

默认数据库位置：

- Windows：`C:\Users\<you>\.retraction-watch-mcp\retraction-watch.sqlite`
- macOS/Linux：`~/.retraction-watch-mcp/retraction-watch.sqlite`

也可以指定数据库路径：

```bash
npm run import -- --db-path ./data/retraction-watch.sqlite
```

Retraction Watch CSV 约 64 MB，生成后的 SQLite 数据库通常为数百 MB。需要更新数据时，重新运行 `npm run import` 即可。

## 启动 MCP Server

```bash
npm run mcp
```

指定数据库路径：

```bash
npm run mcp -- --db-path ./data/retraction-watch.sqlite
```

也可以用环境变量配置：

- `RW_MCP_DB_PATH`：指定 SQLite 数据库完整路径
- `RW_MCP_DATA_DIR`：指定默认数据库目录

## MCP 客户端配置

建议使用绝对路径指向编译后的 `dist/index.js`。

### Claude Desktop

```json
{
  "mcpServers": {
    "retraction-watch": {
      "command": "node",
      "args": ["D:\\\\path\\\\to\\\\retraction-watch-mcp\\\\dist\\\\index.js"],
      "env": {
        "RW_MCP_DB_PATH": "D:\\\\path\\\\to\\\\retraction-watch.sqlite"
      }
    }
  }
}
```

### Cursor

`.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "retraction-watch": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/retraction-watch-mcp/dist/index.js"],
      "env": {
        "RW_MCP_DB_PATH": "/absolute/path/to/retraction-watch.sqlite"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add retraction-watch -- node /absolute/path/to/retraction-watch-mcp/dist/index.js
```

如果数据库不在默认位置，启动客户端前设置 `RW_MCP_DB_PATH`，或在 MCP 配置的 `args` 中加入 `--db-path`。

## CLI 用法

不通过 MCP 客户端，也可以直接命令行查询：

```bash
npm run query -- --name "Ahsen Maqsoom" --institution "COMSATS University Islamabad"
```

指定数据库路径：

```bash
npm run query -- --db-path ./data/retraction-watch.sqlite --name "Ahsen Maqsoom" --institution "COMSATS University Islamabad"
```

本地 link 后可使用全局风格命令：

```bash
npm link
rw-import
rw-query --name "Ahsen Maqsoom" --institution "COMSATS University Islamabad"
rw-mcp
```

常用帮助：

```bash
rw-import --help
rw-query --help
rw-mcp --help
```

## MCP Tools

| Tool | 作用 |
| --- | --- |
| `screen_person` | 基于姓名、邮箱、机构、DOI、PMID 筛查单个人 |
| `screen_batch` | 批量筛查多个人 |
| `lookup_record` | 通过 Retraction Watch `Record ID` 查询记录 |
| `lookup_doi` | 通过原论文 DOI 或撤稿通知 DOI 精确查询 |
| `explain_match` | 解释某个查询与某条记录的打分证据 |
| `get_source_versions` | 返回本地数据快照和匹配策略版本 |

## MCP Resources

- `rw://source-version`
- `rw://match-policy/current`
- `rw://record/{record_id}`

## 结果字段解释

筛查结果的关键字段：

| 字段 | 含义 |
| --- | --- |
| `verdict` | `confirmed`、`likely_match`、`possible_match` 或 `no_match` |
| `identityConfirmed` | 只有 DOI/PMID 精确命中时才为 `true` |
| `reviewRequired` | 是否需要人工复核 |
| `candidates` | 正式候选结果 |
| `nearMisses` | 被拒绝但有弱证据或冲突证据的记录 |
| `warnings` | 数据源和身份匹配限制 |
| `manualReviewReasonCodes` | 机器可读的复核原因 |
| `inputDiagnostics` | 邮箱域名处理、作者机构映射能力等诊断信息 |

## 数据源与许可

主数据源：

`https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv`

Crossref 文档说明，GitLab 仓库是保持 Retraction Watch 数据更新的推荐来源。这个项目当前直接下载 raw CSV，用于本地工作流。旧的 Crossref Labs 接口不作为稳定契约，Retraction Watch 网页搜索页也不会作为程序化主入口。

Crossref 将 Retraction Watch database 标为 CC0。若在论文、报告或公开成果中使用，请按 Retraction Watch 用户指南引用数据源。

本项目代码使用 MIT 许可。Retraction Watch/Crossref 数据不随本仓库分发。

## 隐私与安全

- 默认本地运行，不上传查询输入。
- 不内置遥测。
- 不保存用户查询历史。
- 邮箱不会完整用于 Retraction Watch 匹配，只提取域名作为弱证据。
- 如果未来部署为远程服务，需要额外实现认证、访问控制、审计和脱敏策略。

## 开发

```bash
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

直接运行 TypeScript 源码的开发命令：

```bash
npm run dev:import
npm run dev:query -- --name "Ahsen Maqsoom"
npm run dev:mcp
```

## 排障

- `Local Retraction Watch database not found`：先运行 `npm run import`，或设置 `RW_MCP_DB_PATH` 指向已有数据库。
- MCP 客户端能启动但 tools 失败：确认已运行 `npm run build`，并且客户端配置指向 `dist/index.js`。
- 导入很慢：CSV 和生成后的 SQLite 都比较大，这是预期行为。
- 结果看起来不确定：查看 `warnings`、`manualReviewReasonCodes`、`nearMisses`，必要时用 `explain_match` 单独解释某条记录。

## 路线图

- npm 发布与 `npx` 直接运行。
- MCPB 桌面扩展包。
- Docker/OCI 镜像。
- 可选 Crossref DOI 元数据增强。
- 更完整的机构别名和 ROR 增强。
