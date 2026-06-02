# 痛点聚类 V2 — 开发说明

**规范来源**：[`data/痛点聚类与痛点群组优先级评定标准.md`](../data/痛点聚类与痛点群组优先级评定标准.md) V2.0

## 模块位置

`src/lib/painPointClustering/`

| 文件 | 职责 |
|------|------|
| `runProductClusteringPipeline.js` | 单产品完整流水线（一次 → 剔除 → 二次 → Top 10） |
| `buildJourneyClusterView.js` | 旅程 Tab：按 L1 展示一次群组，L2 为子集过滤 |
| `buildSourceClusterSnapshot.js` | 写入来源快照 `aggregates.painPointClustering` |
| `buildClusterActionRecommendations.js` | 概览行动建议（Top 10 → `OverviewRecommendation`） |
| `clusteringSnapshot.js` | 快照新鲜度检测、旧快照 live 回退 |

## 数据流

```
周期内工单（投诉 + 咨询）
  → runMultiProductClusteringPipeline
  → Top 10 最终群组
  → buildClusterActionRecommendations（§8 painClusterScores）
  → buildOverviewConclusions.recommendations

来源 Tab 旅程区
  → resolveJourneyClusterViewForDisplay（优先读快照 `aggregates.painPointClustering`）
  → 无快照时频次回退（不在 UI 路径 live 聚类）

洞察快照重建（共享 API 库）
  → POST /api/storage/insight-rebuild（服务端 Job）
  → rebuildAllSnapshots（SQLite 读工单 → 写 snapshots）
  → 前端 poll GET /api/storage/insight-rebuild/:id → reloadSnapshots
```

## 快照与兼容

- **新生成快照**：来源快照含 `painPointClustering.clusteringVersion = v2.0`；概览含 `recommendationsMeta.recommendationEngine = pain_cluster_v2`。
- **旧快照**：概览缺少有效 `recommendationEngine: pain_cluster_v2` 时，**不**在浏览器内 live 重算；`OverviewTab` 调用 `prepareOverviewConclusionsForDisplay` 隐藏行动建议并提示「生成 / 刷新洞察」。重算经 **服务端 Insight Rebuild Job**（`POST /api/storage/insight-rebuild`）在 API 进程后台执行，前端轮询任务状态后读快照。
- **V2 无 Top 10**：不展示行动建议，在数据覆盖说明与概览面板提示「未形成痛点聚类 Top 10」；请补充「需求痛点挖掘」打标后重新生成快照。
- **生成规则说明**：洞察概览「行动建议」标题旁问号弹窗，文案由 `buildPlanningRecommendationsHelpSections()` 维护（V2 聚类流程与优先级评分）。

## 关键字段

| 字段 | 用途 |
|------|------|
| `painPoint` / `需求痛点挖掘` | 聚类文本 |
| `problemType` | 严重度、低价值剔除 |
| `journeyL1` | 一次聚类分组 |
| `customerTier`（导入列「移动云客户服务等级」） | §8 展示，不参与评分 |
| `dataSourceType` | 投诉 / 咨询分组 |

## 优化语料（行动建议 / 群组措施，非痛点主文本）

- **确立举措优先**：有 `manualReviewOptimization`（未来将改为「确立举措」）时，该工单不再用 `optimizationProduct` / `optimizationService` 作优化语料（见 `getEffectiveOptimization`）。
- **不纳入聚类语料**：产品组优化建议、设计师优化建议（需求 @20260601-1 §五；仅展示与导出）。
- 痛点聚类 **主文本** 仍为 `painPoint`；上项只影响行动建议、措施收集等 **优化附属语料**。

## 阈值（`constants.js`）

- 一次聚类 Jaccard 阈值：**0.3**
- 二次聚类 Jaccard 阈值：**0.2**
- 每产品 Top N：**10**

## Legacy 保留

以下模块已标记 `@deprecated`，旅程 Tab 不再调用，保留 1~2 个稳定周期后评估移除：

- `journeyOptimizationBatch.js`
- `journeyOptimizationLLM.js`
- `journeyOptimizationMeasuresCache.js`
- `planningRecommendations.js` 中的信号引擎路径（V2 空结果时仍作回退）

## 测试

```bash
npm test -- --run src/lib/painPointClustering src/snapshots/rehydrateOverviewRecommendations.test.js src/snapshots/painPointClusteringIntegration.test.js src/snapshots/insightClusterStability.test.js src/snapshots/buildOverviewConclusions.test.js
```

M2-4 Top10 golden 回归：`clusteringTop10Golden.test.js`（τ ≥ 0.85）。更新 golden：`npm run generate:clustering-golden`

服务端 Job 测试（需 SQLite）：`npm test -- --run server/insightRebuildJob.test.js`

用例索引见 [TEST-PLAN.md](./TEST-PLAN.md) §5.4.5 **TAG-CL**（约 70+ 自动化用例）。
