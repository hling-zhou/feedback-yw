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
  → buildJourneyClusterView（实时，基于当前 scoped 工单）
  → 一次群组 / 未聚类单点
```

## 快照与兼容

- **新生成快照**：来源快照含 `painPointClustering.clusteringVersion = v2.0`；概览含 `recommendationsMeta.recommendationEngine = pain_cluster_v2`。
- **旧快照**：概览缺少 `recommendationEngine` 时，`OverviewTab` 调用 `rehydrateOverviewRecommendations` 用当前工单临时重算行动建议，并提示重新生成快照。
- **V2 无 Top 10**：自动回退 `buildPlanningRecommendations`（legacy），UI 显示 `legacyFallback` 警告。

## 关键字段

| 字段 | 用途 |
|------|------|
| `painPoint` / `需求痛点挖掘` | 聚类文本 |
| `problemType` | 严重度、低价值剔除 |
| `journeyL1` | 一次聚类分组 |
| `customerTier`（导入列「移动云客户服务等级」） | §8 展示，不参与评分 |
| `dataSourceType` | 投诉 / 咨询分组 |

## 阈值（`constants.js`）

- 一次聚类 Jaccard 阈值：**0.35**
- 二次聚类 Jaccard 阈值：**0.3**
- 每产品 Top N：**10**

## Legacy 保留

以下模块已标记 `@deprecated`，旅程 Tab 不再调用，保留 1~2 个稳定周期后评估移除：

- `journeyOptimizationBatch.js`
- `journeyOptimizationLLM.js`
- `journeyOptimizationMeasuresCache.js`
- `planningRecommendations.js` 中的信号引擎路径（V2 空结果时仍作回退）

## 测试

```bash
npm test -- src/lib/painPointClustering src/snapshots/rehydrateOverviewRecommendations.test.js src/snapshots/painPointClusteringIntegration.test.js src/snapshots/buildOverviewConclusions.test.js
```
