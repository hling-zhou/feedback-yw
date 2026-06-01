# 导出 v2 · UAT 记录

> 样例数据：`src/lib/ticketAnalysis/fixtures/exportV2UatSamples.js`  
> 自动化：`src/lib/ticketAnalysisExport.uat.test.js`  
> 迁移说明：[EXPORT-V2-MIGRATION.md](./EXPORT-V2-MIGRATION.md)

**版本**：v2（`EXPORT_ANALYSIS_VERSION = 2`）  
**执行日期**：2026-06-01  
**执行方式**：自动化 UAT（Vitest）+ 下列手工项可选复核

---

## 1. 样例覆盖（20 条）

| 分组 | 数量 | 样例 ID 前缀 | 覆盖场景 |
|------|------|--------------|----------|
| 投诉工单 | 10 | `uat-c-01`～`uat-c-10` | 全字段、legacy 确立举措、空排期、根因回退链、仅 rootCause、加急、problemSummary fallback |
| 咨询工单 | 10 | `uat-z-01`～`uat-z-10` | 无终判、problemType≠终判、空排期、import 来源、空根因 |

运行自动化 UAT：

```bash
npm test -- src/lib/ticketAnalysisExport.uat.test.js
```

---

## 2. 核对清单

### 2.1 自动化（已通过 ✅）

| # | 检查项 | 结果 |
|---|--------|------|
| A1 | 表头 16 列与 Registry 一致 | ✅ `getExportV2Headers` |
| A2 | 投诉 10 条无「投诉原因（终判）」列 | ✅ |
| A3 | 咨询 10 条无「投诉原因（终判）」列 | ✅ |
| A4 | 无来源三列 / legacy 列 | ✅ |
| A5 | 空排期 → 排期列为空（R1） | ✅ |
| A6 | 根因排查：人工 > 问题原因 > rootCause | ✅ |
| A7 | legacy `manualReviewOptimization` → 确立举措 | ✅ |
| A8 | 导出行 → `IMPORT_REPLACE` 往返（投诉/咨询代表样例） | ✅ |

### 2.2 手工（可选，真实库抽样）

在 **反馈库** 导出当前周期数据后勾选：

- [ ] 导出 Excel 首行与 [EXPORT-V2-MIGRATION.md §1](./EXPORT-V2-MIGRATION.md) 一致
- [ ] 投诉工单抽样 5 条：确立举措、根因排查、受理/处理意见合理
- [ ] 咨询工单抽样 5 条：无终判列；问题类型为打标值
- [ ] 文件名提示含 `v2` 或成功 toast 含「16 列」

---

## 3. P1-4 专项验收

| 场景 | 样例 | 预期 |
|------|------|------|
| 无排期 | `uat-c-02`, `uat-c-03`, `uat-z-01` 等 | `排期` = 空 |
| 根因 ← 问题原因 | `uat-c-03` | `磁盘使用率 100%` |
| 根因 ← rootCause | `uat-c-04` | `AccessKey 轮换未同步` |
| 根因 ← 人工 | `uat-c-01` | `安全组未放行 22 端口` |
| 根因全空 | `uat-c-08`, `uat-z-08` | `根因排查` = 空 |
| 导入往返 | `uat-c-01`, `uat-z-01` | `applyImportReplace` 核心字段一致 |

---

## 4. 签字

| 角色 | 姓名 | 日期 | 签名 |
|------|------|------|------|
| 开发 | （自动化 UAT 通过） | 2026-06-01 | ✅ |
| 产品 | | | |
| 测试 | | | |

---

## 5. 相关任务状态

| 任务 | 状态 |
|------|------|
| P1-1 recordToExportRowV2 | ✅ |
| P1-2 迁移说明 | ✅ |
| P1-3 确立举措过渡 | ✅（含于 P1-1） |
| P1-4 排期/根因占位 | ✅ |
| P1-5 导出 UAT | ✅（自动化） |
