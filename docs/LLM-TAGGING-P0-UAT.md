# LLM 打标 P0 — 发布 / UAT 检查清单

**版本**：2026-06-02  
**适用版本**：commit `693e667` 及之后（含 Phase A~E、Post-LLM 重打、V2 golden）  
**关联**：[LLM-TAGGING-P0-DESIGN.md](./LLM-TAGGING-P0-DESIGN.md)、[TEST-PLAN.md](./TEST-PLAN.md)、[TICKET-ANALYSIS-P0-RULES.md](./TICKET-ANALYSIS-P0-RULES.md)

---

## 1. 发布前自动化（必过）

执行人：研发 / CI

| # | 项 | 命令 / 依据 | 通过 |
|---|-----|-------------|------|
| 1.1 | 全量单元测试 | `npm test` | ☐ |
| 1.2 | 前端构建 | `npm run build` | ☐ |
| 1.3 | P0 LLM 专项 | `npm test -- src/lib/ticketAnalysis/ticketLlmGolden.test.js src/lib/ticketAnalysis/v2TicketExamples.test.js src/lib/journeyMatchConfidence.test.js src/lib/applyThemes.test.js src/lib/importEnrichment.test.js` | ☐ |
| 1.4 | Token 预算模型 | `node scripts/benchmark-ticket-llm.mjs 500` → 降幅 ≥40% | ☐ |
| 1.5 | E2E 冒烟（可选） | `npm run test:e2e` | ☐ |

**离线验收已覆盖**（无需 UAT 重复）：U-06、O-golden、G-01~G-05、O-01~O-05、R-01~R-03 — 见 TEST-PLAN §5.4.1 TAG-LLM-21~24。

---

## 2. 环境与配置

| # | 项 | 说明 | 通过 |
|---|-----|------|------|
| 2.1 | API Key | 设置页或服务端 `LLM_API_KEY` 可用；`canUseSemanticMatch` 为 true | ☐ |
| 2.2 | 团队默认配置 | 确认共享库 `app_settings_shared_v1` 含 P0 默认值（见下表） | ☐ |
| 2.3 | 测试库备份 | 复制 `server/data/auth.db` 或使用独立测试库 | ☐ |
| 2.4 | 洞察周期 | 选定 1 个含 EIP 投诉工单的月份（建议 ≥50 条） | ☐ |

### 2.1 P0 默认团队设置

| 键 | 发布默认 | 回滚值 |
|----|----------|--------|
| `ticketLlmMode` | `unified` | `separate` |
| `taggingPipelineOrder` | `ticket_first` | `legacy` |
| `journeyLlmGating` | `true` | `false` |
| `journeyLlmSkipScoreThreshold` | `3` | — |
| `retagDimensionsAfterTicketLlm` | `true` | `false` |
| `themeMatchMode` | `hybrid`（保持现网） | — |

回滚组合：`ticketLlmMode=separate` + `taggingPipelineOrder=legacy` + `journeyLlmGating=false` → 行为≈改造前。

---

## 3. 功能 UAT — 导入打标

| # | 场景 | 步骤 | 预期 | 通过 |
|---|------|------|------|------|
| 3.1 | 小批量导入 | 导入 10~20 条 EIP 投诉 Excel | 完成页显示 enrichmentStats；无报错 | ☐ |
| 3.2 | 打标顺序 | 观察导入进度文案 | 默认 ticket_first：**本地场景/类型 → 工单 LLM → LLM 语料重打场景/类型（默认开）→ 用户旅程 → 情绪** | ☐ |
| 3.3 | LLM 语料重打 | 导入后抽查 2 条 ticket LLM 成功工单 | 请求场景/问题类型与 LLM `customerRequest`/`painPoint` 语义一致；协办对端类处理意见 → 问题类型可为「产品功能咨询」 | ☐ |
| 3.4 | 来源字段 | 打开 2~3 条详情 | `customerRequestSource` / `painPointSource` / `optimizationSource` 为 `llm`（有 Key 时） | ☐ |
| 3.5 | 旅程门控 | 找 1 条关键词明显命中旅程的工单 | `journeySource=rule` 且 `journeyMatchScore≥3` 时仍可有正确 journeyL1/L2 | ☐ |
| 3.6 | 旅程 LLM | 找 1 条「未识别环节」工单 | 导入后 journey 被 LLM 填充或仍为未识别（视正文） | ☐ |
| 3.7 | 导入 warning | 模拟 Key 无效或中断后完成导入 | 完成页 warning 含「反馈库 → 补打 / 补打旅程」指引 | ☐ |
| 3.8 | 快照 | 导入完成后 | 该月洞察快照已刷新；工作台可打开 | ☐ |

---

## 4. 功能 UAT — 反馈库与补打

| # | 场景 | 步骤 | 预期 | 通过 |
|---|------|------|------|------|
| 4.1 | 待 LLM 筛选 | 反馈库 →「待 LLM（请求/痛点/优化）」 | 仅显示三字段非全 llm 的投诉/咨询工单 | ☐ |
| 4.2 | 待旅程 LLM | 反馈库 →「待旅程 LLM」 | 显示 journey 仍待 LLM 的工单；门控 skip 的不出现 | ☐ |
| 4.3 | 补打工单 LLM | 反馈库顶部提示条 →「补打」 | **不**弹确认框；直接按 `needs_ticket_llm` 启动；不重跑规则初标与旅程 | ☐ |
| 4.4 | 补打旅程 LLM | 反馈库顶部提示条 →「补打旅程」 | 直接按 `needs_journey_llm` 启动；仅旅程 + themes + 情绪 | ☐ |
| 4.5 | 分批持久化 | 补打 20+ 条，中途关页或断网后重开 | 已完成批次数据仍在；可继续点「补打」/「补打旅程」 | ☐ |
| 4.6 | 提示条 | 周期内有待补打工单 | 反馈库顶部单行提示（客户请求/痛点/优化 + 旅程）+ 链接按钮可用 | ☐ |
| 4.7 | 维度重打开关 | 设置 → 维度打标；批量重打弹窗 | 默认勾选「工单 LLM 成功后重打…」；关闭后补打/导入不再按 LLM 语料刷新场景/类型 | ☐ |
| 4.8 | 请求场景 V2 | 对含旧标签（如「报障与恢复」）工单批量重打 | 重打后请求场景为 V2 九类（如「报障与排错」） | ☐ |

---

## 5. 功能 UAT — 可靠性与 token（建议）

| # | 场景 | 步骤 | 预期 | 通过 |
|---|------|------|------|------|
| 5.1 | O-02 中断 | ticket_first 下批量补打，LLM 额度在第 N 批用尽 | 已 persist 批次保留；**未**出现大规模 journey LLM 消耗（因 ticket 先失败则 journey 未跑） | ☐ |
| 5.2 | 无 Key | 清空 Key 后导入 5 条 | 规则初标完成；warning 提示配置 Key；`*Source=rule` | ☐ |
| 5.3 | Token 抽检 | 同一 50 条周期，对比改造前日志或 separate 回滚跑一遍 | `llmChatCompletion` 次数或 prompt 字符降 **≥30%**（目标 40%） | ☐ |
| 5.4 | optimization 质量 | 抽检 20 条 `optimizationSource=llm` | 非空、非泛化套话；`optimizationRetry` 占比可接受（<40% 观察） | ☐ |

---

## 6. 功能 UAT — 洞察 / 聚类

| # | 场景 | 步骤 | 预期 | 通过 |
|---|------|------|------|------|
| 6.1 | 快照刷新 | 补打完成后手动刷新洞察 | 概述 / 聚类 / 行动建议可加载，无白屏 | ☐ |
| 6.2 | 簇数稳定 | 同周期仅补打 journey、pain 未变 | 痛点聚类 Top 簇数量变化 **<10%** | ☐ |
| 6.3 | 旅程变更 | 补打 journey 后 L1 变化的几条 | 聚类分组键变化属预期；刷新快照后数据一致 | ☐ |

---

## 7. 回滚 UAT（发布前在测试库演练一次）

| # | 步骤 | 预期 | 通过 |
|---|------|------|------|
| 7.1 | 团队设置改为回滚组合（§2.1） | 保存成功 | ☐ |
| 7.2 | 导入 5 条或补打 5 条 | 顺序为 legacy：旅程先于工单 LLM；hybrid 全量旅程 LLM | ☐ |
| 7.3 | ticket 三独立 LLM 调用 | separate 模式行为与改造前一致 | ☐ |
| 7.4 | 恢复 P0 默认配置 | 重新导入/补打恢复新行为 | ☐ |

---

## 8. 发布 sign-off

| 角色 | 姓名 | 日期 | 签字 |
|------|------|------|------|
| 研发 | | | |
| 测试 / UAT | | | |
| 产品 / 业务 | | | |

**发布结论**：☐ 通过发布　☐ 有条件通过（见备注）　☐ 不通过

**备注**：

---

## 9. 快速命令参考

```bash
# 自动化门禁
npm test && npm run build
node scripts/benchmark-ticket-llm.mjs 500

# P0 相关单测
npm test -- src/lib/ticketAnalysis/ticketLlmGolden.test.js \
  src/lib/journeyMatchConfidence.test.js \
  src/lib/applyThemes.test.js \
  src/lib/importEnrichment.test.js \
  src/snapshots/insightClusterStability.test.js

# 本地启动
export JWT_SECRET="$(openssl rand -base64 32)"
npm run dev
```

---

## 10. 相关文档

- [LLM-TAGGING-P0-DESIGN.md](./LLM-TAGGING-P0-DESIGN.md) — 改造设计与验收标准 §9
- [TEST-PLAN.md](./TEST-PLAN.md) — TAG-LLM 自动化映射 §5.4.1
- [TICKET-ANALYSIS-P0-RULES.md](./TICKET-ANALYSIS-P0-RULES.md) — 来源字段与流水线
- [DATA-PERSISTENCE.md](./DATA-PERSISTENCE.md) — 批量打标分批写库
