# 结果解释与复核边界

Retraction Watch MCP 的输出是筛查线索，不是身份裁定或学术不端裁定。

## Verdict

| 值 | 含义 | 是否身份确认 |
| --- | --- | --- |
| `confirmed` | 输入 DOI/PMID 与 Retraction Watch 记录中的原论文或撤稿通知精确命中 | 是记录级强证据，但仍不是个人不端裁定 |
| `likely_match` | 姓名证据加机构或邮箱域名等辅助证据达到阈值 | 否 |
| `possible_match` | 主要基于姓名字符串相似 | 否 |
| `no_match` | 本地索引中未返回正式候选 | 否，也不代表一定没有记录 |

## 关键字段

| 字段 | 用法 |
| --- | --- |
| `identityConfirmed` | 只有 DOI/PMID 精确命中时才为 `true` |
| `reviewRequired` | 非 `confirmed` 或存在 near miss 时通常为 `true` |
| `safeSummary` | 给 LLM 或报告生成器使用的谨慎摘要 |
| `consequentialUseWarning` | 高风险使用警告，不应删除 |
| `candidates` | 正式候选记录 |
| `nearMisses` | 有弱证据、冲突证据或 strict 模式下被降级的记录 |
| `manualReviewReasonCodes` | 机器可读的复核原因 |
| `inputDiagnostics` | 邮箱域名、作者机构映射能力等诊断信息 |

## 推荐措辞

推荐：

> 发现一条需要人工复核的 Retraction Watch 记录相似项。

不推荐：

> 这个人有学术不端记录。

推荐：

> DOI/PMID 与 Retraction Watch 记录精确命中，说明输入标识符对应的论文或通知存在记录。该结果仍不等同于个人学术不端裁定。

不推荐：

> 此人已被确认学术不端。

## 人工复核步骤

1. 核对 DOI、PMID、论文标题、期刊、年份和撤稿通知。
2. 核对作者全名、ORCID、机构历史、合作者和研究方向。
3. 阅读撤稿原因与通知原文，区分撤稿、修正、关注表达和恢复。
4. 不要把姓名相似或机构相似作为个人身份确认。
5. 在招聘、招生、资助、处分或公开指控等高风险场景中，必须走独立人工复核流程。
