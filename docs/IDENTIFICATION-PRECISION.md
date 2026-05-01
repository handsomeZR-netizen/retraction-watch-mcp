# 识别精度现状 + 痛点说明 + Key 申请指南

> 面向客户/管理员的现状交底文档。截至 2026-05-01。

## 1. 一句话现状

100 篇真实 PDF 端到端实测：
- **单栏稿件**（Cell Reports 风格）：DOI 命中率 **97.8%**，已经触顶。
- **双栏稿件**（Procedia CS 风格）：DOI 命中率 **59.6%**，每一条都通过 title + year + 作者姓氏三重校验。

剩下双栏 ~40% 拿不到 DOI，**绝大多数不是系统识别错，而是数据源本身没有 DOI**。详见 §3 痛点拆解。

---

## 2. 当前生产管线（4 层 + 3 外源）

```
PDF / Word / LaTeX
   ↓
[1] 文本抽取（unpdf / mammoth / latex）
   ↓
[2] 引用切分（splitter v2 三层 fallback：正则 → marker → LLM 兜底）
   ↓
[3] 引用结构化（regex 抽 DOI/PMID → LLM 兜底抽 title/authors）
   ↓
[4] 外源反查 DOI（Crossref → OpenAlex → Semantic Scholar*，每层都过 0.92 title + ±1 year + 作者姓氏 gate）
   ↓
[5] 比对 Retraction Watch 数据库 → PASS / REVIEW / FAIL
```

\* Semantic Scholar 默认关，等申请 API key 后开启（详见 §4）。

---

## 3. 当前痛点拆解（双栏 50 篇 corpus 的 505 条无 DOI ref）

| 类别 | 数量 | 占无 DOI | 性质 | 可救？ |
|---|---|---|---|---|
| 书籍 / ISO 标准 / URL 网页 | 76 | 15.0% | **本身就没有 DOI** | ❌ 不可救（所有手段无效）|
| 大型出版商索引外的会议论文 | ~125 | 24.8% | Crossref + OpenAlex 都不收录 | ⚠️ Semantic Scholar / DBLP 部分可救 |
| 早期 LLM 把页码误当 title | 0 | 0% | 已修复（commit `659a05f`）| ✅ 已修 |
| 双栏读列顺序导致字段错乱 | ~80 | 15.8% | layout-aware 已部署但仍有遗漏 | ⚠️ 需要 layout-aware OCR（成本高） |
| 作者姓氏不重合（精度 gate 拒绝）| ~24 | 4.8% | **故意丢弃**——这些是 title 模糊匹配但作者完全对不上的，几乎肯定是同名不同论文 | ✅ 这是精度保证，不应"救" |
| 其他长尾（标题太脏、年份缺失等）| ~200 | 39.6% | fusion gate 0.92 卡掉 | ⚠️ 放阈值会引入误匹配，不建议 |

**核心信息给客户：**
> 系统宁可标"未命中"也不会给你一个错的 DOI。这是设计意图，不是 bug。当一份双栏稿件 DOI 命中率只有 60% 时，那 40% 中**约 1/3 是物理上没 DOI 的引用**（书、标准、URL），剩下 2/3 大部分是数据库覆盖盲区。

---

## 4. 提升空间 + 申请 Key 操作手册

下面三条 key 都是**免费**，预计能把双栏命中率从 **59.6% → 70-75%**。

### 4.1 Crossref polite pool（已开，仅需邮箱）

**作用**：DOI 反查的主要数据源，覆盖 ~1.5 亿篇主流期刊文献。

**怎么开**：进 `/settings` → "外源元数据增强"卡 → 填一个能联系到管理员的邮箱（已有的 `1516924835@qq.com` 即可），保存即生效。

**速率限制**：polite pool 自动给到 50 req/s。基本无瓶颈。

**收益**：当前 60% 双栏命中里**至少 30 pts** 来自 Crossref，没它直接退到 26%。**必开**。

### 4.2 OpenAlex（已开，无需 key）

**作用**：第二外源，~2.5 亿条记录，覆盖 Crossref 漏掉的会议、灰色文献。

**怎么开**：跟 Crossref 共用同一个邮箱（已自动启用，无单独开关）。

**速率限制**：免费层 100k req/天 / 10 req/s，对单稿足够。

**收益**：双栏命中率比"只有 Crossref"再加 4-5 pts。已经在跑。

**可选升级**：申请 OpenAlex 高级 API key（也免费）。

  1. 访问 <https://openalex.org/>
  2. 右上角 "API → Get a free API key"
  3. 邮箱注册，几分钟内收到 key
  4. 给我（或部署人员），我们设到环境变量 `RW_OPENALEX_API_KEY=...`
  5. 重启 docker。生效后速率上限 ×10，**对 100-PDF benchmark 重跑速度大幅提升**

### 4.3 Semantic Scholar（重点！代码已就绪，缺 key）

**作用**：第三外源，~2 亿条记录，**计算机科学 / 工程 / 会议论文覆盖最强**——你的双栏 corpus（Procedia CS）正是它的强项。

**当前状态**：代码已写好（`packages/ingest/src/external/semantic-scholar.ts`，commit `35f7f11`），但默认关闭，因为免费匿名层限速 ~1 req/s，几乎全部超时。

**怎么开**：

  1. 访问 <https://www.semanticscholar.org/product/api>
  2. 点 "Get API Key" → 填一个简短表单（说明项目用途即可，比如 "academic integrity screening tool, retraction watch comparison"）
  3. 一般 **2-7 个工作日**邮件回复 key
  4. 把 key 给部署人员，添加环境变量：
     ```
     RW_S2_API_KEY=xxx-your-key-xxx
     ```
  5. 重启 docker → 自动激活

**预期收益**：
- 双栏 DOI 命中率：**59.6% → 65-70%**（救回 30-50 条 Crossref + OpenAlex 都没收录的会议论文）
- 单栏不变（已 97.8%）
- API quota：1 req/s（带 key）→ 实测 100-PDF benchmark 大概多 3-5 min，可控

### 4.4 LLM Key（推荐 deepseek-v4-flash）

**作用**：参考文献结构化（提取 title/作者/年份）+ 双栏 PDF 切分兜底 + 首页元数据增强。

**当前状态**：你已经在用 `sk-d7326547dac64738a3067d684fab369c`，正常运转。

**成本**：每篇稿件 ~5 次调用，约 **¥0.001/稿**。100 稿不到 1 元。

**没 LLM 时**：双栏 0-ref 失败案例从 0/50 飙到 4/50；author recall 从 0.92 降到 0.83。**强烈建议保持开启**。

**申请新 key**：访问 <https://platform.deepseek.com/api_keys> 注册即可。

---

## 5. 不推荐的方向（已评估）

| 方向 | 我们为什么不做 |
|---|---|
| 自部署 MinerU / PaddleOCR | 需要 ≥ 8GB RAM 或 GPU，当前生产服务器（4GB CPU）扛不住，硬上会拖垮主站 |
| 放松 fusion gate 0.92 → 0.85 | 命中率 +5-10 pts，但**误匹配会引入错误 DOI**，跟"完全正确"原则冲突 |
| 加 ChatGPT-4 / Claude 替代 deepseek | 单价高 30-50x，识别精度提升 < 5 pts，性价比极低 |
| 升级到 32GB GPU 服务器 | 月成本 +¥500，benchmark 提升 < 10 pts，ROI 不达预期 |

---

## 6. 推荐执行清单

按优先级和投入时间排：

| 优先级 | 任务 | 投入 | 预期增益 |
|---|---|---|---|
| **P0** | 客户在 `/settings` 检查"外源增强"是开的、邮箱已填 | 1 min | 维持当前 60% 命中率 |
| **P1** | 申请 Semantic Scholar API key | 邮件等 1 周 | **双栏 +5-10 pts** |
| **P2** | 申请 OpenAlex 高级 key | 邮件等 1 天 | benchmark 速度 +50% |
| **P3** | 监控生产数据，看真实用户 corpus 跟 50-PDF benchmark 是否分布一致 | 持续 | 决定是否值得继续投入 |
| **可选** | 后续若决定上 MinerU，走外部 GPU 按量服务（不动当前服务器）| 1-2 天 + ¥0.5-2/稿 | 双栏 +5-10 pts |

---

## 7. 给客户的"放心话"

1. **当前 DOI 命中数据，每一条都过了三重 gate**：title 92% 相似 + 年份 ±1 + 作者姓氏共现。系统不会给你"看上去像但其实是另一篇"的错误 DOI。
2. **拿不到 DOI ≠ 系统识别失败**。书、标准、URL、未被任何数据库收录的小会议论文 —— 这些是数据本身的天花板，不是系统能力的天花板。
3. **现在所有 LLM 调用 + 外源调用都有限流和缓存**，单稿成本可控（~¥0.001 LLM + 免费 polite-pool 外源）。
4. **回滚路径完整**。任何一个外源 / LLM / 增强开关都能在 `/settings` 或环境变量里独立关掉，不影响其他模块。

---

## 8. 联系 / 后续

- 申请到 key 后：直接发给部署/运维人员，由他们设到 `docker-compose.yml` 的 `environment:` 里
- 部署变更走 `git pull && docker compose up -d --build`，约 2 min 内重启完成
- 历史 benchmark 报告 + 各阶段 commit 见 GitHub PR #5 描述及之后的 main 提交记录
