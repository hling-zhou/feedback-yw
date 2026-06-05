# 用后即评 · 满意度回访 · UAT 记录

> 需求：[data/用后即评.md](../data/用后即评.md)  
> 设计：[DESIGN-用后即评-满意度回访.md](./DESIGN-用后即评-满意度回访.md)  
> 自动化：TEST-PLAN §5.4.3l TAG-FU；集成测 `followUpSatisfaction.integration.test.js`

**版本**：回访满意度 P0–P6（`EXPORT_ANALYSIS_VERSION = 3`）  
**执行方式**：Vitest 自动化 + 下列手工核对

---

## 1. 自动化（CI）

```bash
npm test -- \
  src/domain/followUpSatisfaction.test.js \
  src/lib/followUpSatisfactionImport.test.js \
  src/lib/followUpSatisfactionAnalytics.test.js \
  src/lib/followUpSatisfaction.integration.test.js \
  src/lib/feedbackFilters.test.js \
  src/lib/ticketAnalysisExport.test.js \
  src/lib/importAnalysis.test.js \
  src/snapshots/buildSourceSnapshot.test.js \
  server/routes/followUpSatisfactionImport.test.js
```

| # | 检查项 | TAG | 结果 |
|---|--------|-----|------|
| A1 | 领域模型：score/展示/趋势月份 | TAG-FU-01 | ✅ |
| A2 | Field Registry：回访列位于「是否加急」后 | TAG-FU-02 | ✅ |
| A3 | 导入匹配、幂等、跳过非成功回访 | TAG-FU-03, TAG-FU-08 | ✅ |
| A4 | 10 分率分母 = 回访成功且有评分 | TAG-FU-09 | ✅ |
| A5 | 导出 v3 21 列 + 来源+月份 sheet | TAG-FU-10, TAG-FU-11 | ✅ |
| A6 | 分析结果 round-trip 回访列 | TAG-FU-12 | ✅ |
| A7 | 快照 `followUpSatisfactionMetrics` | TAG-FU-13 | ✅ |
| A8 | 聚合：非 10 分分布 / 88% 基线数据 | TAG-FU-14 | ✅ |
| A9 | 下钻 URL `buildFollowUpDrillDownUrl` | TAG-FU-07, TAG-FU-15 | ✅ |
| A10 | 导入 API 集成（Node 20 + SQLite） | TAG-FU-03 | ✅（条件执行） |

---

## 2. 手工 UAT · 导入 → 列表 → 详情 → 导出

### 2.1 导入补全

- [ ] **U-01** 导入页 →「满意度回访」Tab → 选洞察周期 + 回访月份 → 上传 Excel → 预览成功/未匹配摘要正确
- [ ] **U-02** 确认合并后，匹配工单在反馈库「回访满意度」列有值（如 `10（已解决）`）
- [ ] **U-03** 同一回访工单号再次导入 → 覆盖更新（分数/解决状态变化），无重复工单
- [ ] **U-04** 原工单不在当前周期 → 仍补全；若 UI 展示周期外警告则可见（数据层 `outOfPeriodWarning=true`）

### 2.2 列表与详情

- [ ] **U-05** 反馈库筛选：有回访 / 无回访 / 10 分 / 非 10 分 / 已解决 / 未解决 组合正确
- [ ] **U-06** 工单详情：「是否加急」后显示回访满意度；「用户请求」上方显示不满意原因（只读）

### 2.3 导出与 round-trip

- [ ] **U-07** 导出分析结果 v3：Excel 含「回访满意度」「不满意原因」列；sheet 按「数据来源-YYYY年M月」分组
- [ ] **U-08** 修改导出 Excel 中回访列 → 导入分析结果 → 仅 patch 回访字段，不触发全量重打标

---

## 3. 手工 UAT · 工作台

- [ ] **U-09** 洞察工作台 → 用后即评 Tab →「回访满意度」模块可见
- [ ] **U-10** 10 分满意率趋势：多产品折线 + **88% 灰色虚线基线**
- [ ] **U-11** 非 10 分得分分布：分产品 1–9 分，≤5 分红色
- [ ] **U-12** 产品 Select 切换后：非 10 分场景/类型/原因/未解决统计联动变化
- [ ] **U-13** 条形图点击 → 跳转反馈库，URL 含 `followUp=non10` 及对应维度；列表与图表 subset 一致
- [ ] **U-14** 「查看工单」/ 未解决「查看」链接 → 反馈库预填筛选正确

---

## 4. 签字

| 角色 | 姓名 | 日期 | 签名 |
|------|------|------|------|
| 开发 | （自动化 UAT 通过） | 2026-06-05 | ✅ |
| 产品 | | | |
| 测试 | | | |

---

## 5. 相关任务状态

| Phase | 状态 |
|-------|------|
| P0 领域 + Registry | ✅ |
| P1 导入 | ✅ |
| P2 列表/详情/筛选 | ✅ |
| P3 导出 v3 + round-trip | ✅ |
| P4 分析聚合 + 快照 | ✅ |
| P5 工作台 UI + 下钻 | ✅ |
| P6 TEST-PLAN + UAT | ✅ |
