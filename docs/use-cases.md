# 典型使用场景

| 场景 | 用户 | 输入 | 输出 | 风险控制 |
| --- | --- | --- | --- | --- |
| 投稿前作者自查 | 研究者、学生 | 姓名、机构、DOI 或 PMID | 是否存在记录级命中或相似候选 | 明确不是身份裁定 |
| 文献复核 | 导师、科研助理 | 论文 DOI、作者列表 | DOI 精确命中、姓名近似候选 | DOI 优先，姓名只作线索 |
| 机构科研诚信初筛 | 科研管理人员 | 批量人员信息 | 批量 JSON 报告和复核原因 | 强制人工复核 |
| AI 助手工作流 | MCP 客户端用户 | 自然语言问题 | 调用 tools 后生成谨慎摘要 | 使用 `safeSummary` 和 prompts 限制措辞 |

## 推荐工作流

1. 先用 `rw-doctor` 确认本地数据库、source snapshot 和策略可用。
2. 高风险场景优先用 `--strict` 或 `policy=strict`。
3. 有 DOI/PMID 时优先传 DOI/PMID，不要只靠姓名。
4. 读取 `safeSummary`、`warnings` 和 `manualReviewReasonCodes`。
5. 对候选记录使用 `lookup_record` 或 `explain_match` 逐条复核。

## 不适合的场景

- 作为招聘、招生、资助、处分或公开指控的唯一依据。
- 用姓名相似直接判断某个人存在学术不端。
- 用公共邮箱域名作为身份强证据。
- 把 `no_match` 当作绝对无记录证明。
