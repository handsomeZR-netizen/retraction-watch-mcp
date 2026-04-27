# 验收标准

## `screen_person`

- DOI 精确命中时，`verdict=confirmed` 且 `identityConfirmed=true`。
- PMID 精确命中时，`verdict=confirmed` 且 `identityConfirmed=true`。
- 仅姓名命中时，不得返回 `confirmed`。
- 公共邮箱域名不得贡献正向分数。
- 非公共邮箱只能使用域名与机构 token 的弱重合证据。
- 作者到机构无法一一映射时，必须在 `warnings` 或 `inputDiagnostics` 中体现。
- 结果必须包含 `sourceVersion`、`policyVersion`、`safeSummary` 和 `consequentialUseWarning`。
- `strict_mode=true` 时，非 DOI/PMID 命中的结果不得进入正式 `candidates`。

## `screen_batch`

- 每次最多处理 50 人。
- 支持批量默认 `include_notice_types`。
- 单人 `limit` 优先于批量 `limit_per_person`。
- 每个结果都必须保留独立 `queryId`、`safeSummary` 和复核原因。

## `lookup_doi`

- 只做 DOI 规范化后的精确查询。
- 可以匹配原论文 DOI 或撤稿通知 DOI。
- 不应把 DOI 字符串相似作为命中。

## `explain_match`

- 对不存在的 `record_id` 返回 `found=false`。
- 对存在记录返回逐项 evidence 和 score delta。
- 解释输出必须遵循当前 active policy。

## `rw-doctor`

- Node.js 低于 20 时必须失败。
- 数据库不存在时必须失败，并提示运行 `rw-import` 或传 `--db-path`。
- 数据库存在时应报告文件大小、row count、导入时间、CSV hash 和 policy 版本。
- `--json` 必须输出机器可读结果。
