# 痛点聚类性能优化 — 任务分解与产品决策

**背景**：单周期 ~1401 工单、最大聚类组 643 条时，同步 `buildClusterRecommendationsFromPipeline` 约 44s，导致洞察工作台主线程无响应。

**目标 SLA**

| 场景 | 当前 | 目标 |
|------|------|------|
| 工作台首屏可交互 | 40s+ | **< 1s** |
| 概览/旅程 Tab 展示 | 同步重算 | **< 200ms**（读快照） |
| 全量聚类（1401 工单） | ~44s | **< 5s**（M2 后；Server Job 后台执行） |

**M2 基准（auth.db，弹性公网IP 2726 条）**：`runProductClusteringPipeline` ~**207ms**；最大组 2011 条 ~**156ms**（Top150 代表 + NN-chain）。

---

## 已锁定产品决策（2026-06-01）

| 决策项 | 结论 |
|--------|------|
| **旧快照行动建议** | **是** — 不展示 V2（亦不展示需刷新的 legacy 列表），仅提示用户点击「生成 / 刷新洞察」 |
| **洞察重建计算位置** | **Server Job（P1 必做）** — 多人共享 API 库，聚类在服务端执行；Web Worker 仅作 IDB 单机过渡 |

实现入口：

- 展示：`prepareOverviewConclusionsForDisplay()`（`rehydrateOverviewRecommendations.js`）
- 计算：保留 `rehydrateOverviewRecommendations()` 供服务端 Job / 快照重建，**不在** `OverviewTab` 同步调用

---

## Phase S — 短期止血

| ID | 任务 | 状态 |
|----|------|------|
| S1 | 概览去掉 sync rehydrate，旧快照 Alert + 隐藏行动建议 | ✅ |
| S2 | 工作台 Tab 懒加载（仅渲染 activeTab） | ✅ |
| S3 | 旅程 Tab 异步聚类 + loading | 跳过（L0-1 已读快照） |
| S4 | 快照重建主线程让出 | ✅ |

## Phase M1 — 中期算法 Layer 0/1

| ID | 任务 | 状态 |
|----|------|------|
| M1-1 | `normalizePainPoint` + exact 预合并 | ✅ |
| M1-2 | unique 文本聚类 + recordIds 展开 | ✅ |
| M1-3 | `PRIMARY_CLUSTER_MAX_ITEMS` 与 diagnostics | ✅ |
| M1-4 | 性能回归测试 / benchmark script | ✅ `npm run benchmark:clustering` |
| S3 | 旅程 Tab 异步聚类 + loading | 跳过（L0-1 已读快照） |
| S4 | 快照重建主线程让出 | ✅ |

## Phase M2 — 中期算法 Layer 2 + 内核

| ID | 任务 | 状态 |
|----|------|------|
| M2-1 | 倒排索引候选对 | ✅ |
| M2-2 | NN-chain 层次聚类内核 | ✅ |
| M2-3 | 大组降级（>150 unique → Top150 + minSharedTokens 阶梯） | ✅ |
| M2-4 | Golden 对比（Top10 Kendall τ ≥ 0.85） | 待办 |

## Phase L — 长期架构

| ID | 任务 | 优先级 | 状态 |
|----|------|--------|------|
| L0-1 | 旅程 Tab 读 `aggregates.painPointClustering` 快照 | P1 | ✅ |
| L0-2 | Dashboard 无快照时仅频次回退 | P2 | 待办 |
| L1-1 | 概览只读 + `prepareOverviewConclusionsForDisplay` | P1 | ✅ |
| L1-2 | 概览持久化 pipeline 中间态 | P2 | 待办 |
| L2-1 | Web Worker（IDB 过渡） | P2 | 待办 |
| **L2-2** | **服务端 Insight Rebuild Job** | **P1** | 待办 |
| L2-3 | 导入后自动入队 | P1 | 待办 |
| L3-1 | Clustering Artifact 分表 | P3 | 待办 |
| L3-2 | 增量聚类 | P3 | 待办 |

## 推荐实施顺序

1. S1 + S2 + L1-1（已完成）
2. L0-1 + S3 + S4
3. M1 → M2（降低 Server Job 单次耗时）
4. **L2-2 Server Job**（共享库 P1）
5. L2-3、L1-2、L3

## 相关模块

| 路径 | 说明 |
|------|------|
| `src/lib/painPointClustering/jaccardHierarchical.js` | 聚类瓶颈 |
| `src/snapshots/rehydrateOverviewRecommendations.js` | 展示 vs 重算分离 |
| `src/components/workbench/OverviewTab.jsx` | 概览只读 |
| `src/pages/InsightWorkbench.jsx` | Tab 懒加载 |
| `src/lib/painPointClustering/buildSourceClusterSnapshot.js` | 分源快照一次聚类 |
| `server/businessDb.js` | L2 Job 持久化扩展点 |

规范依据：[`data/痛点聚类与痛点群组优先级评定标准.md`](../data/痛点聚类与痛点群组优先级评定标准.md) V2.0
