# 洞察工作台 · 行动建议模块生成逻辑梳理

> 代码基线：聚类引擎 `CLUSTERING_VERSION = 'v2.4'`，建议引擎 `recommendationEngine = 'pain_cluster_v2_4'`，举措合成版本 `CLUSTER_ACTION_SYNTHESIS_VERSION = 8`。

---

## 一、模块定位与代码入口

| 层次 | 文件 | 职责 |
| --- | --- | --- |
| 页面 | `src/pages/InsightWorkbench.jsx` | 洞察工作台容器 |
| Tab | `src/components/workbench/OverviewTab.jsx` | 洞察概览 Tab |
| 面板 | `src/components/workbench/PlanningRecommendationsPanel.jsx`（760 行） | 行动建议主 UI：分组、筛选、导出、LLM 润色入口 |
| 区块渲染 | `src/components/workbench/PlanningRecommendationSectionsView.jsx` | 单条建议的四个结构化区块 |
| 说明弹窗 | `src/components/workbench/PlanningRecommendationsHelpModal.jsx` | 「?」→ 生成规则说明 |
| **编排** | `src/snapshots/buildOverviewConclusions.js` | **生成总入口** |
| 聚类 | `src/lib/painPointClustering/*` | 痛点聚类 V2（一次/二次聚类、打分） |
| 建议装配 | `src/lib/painPointClustering/buildClusterActionRecommendations.js` | 群组 → 建议骨架 |
| 内容生成 | `src/lib/planningRecommendationSections.js`（823 行） | 四个 sections 的内容生成与校验 |
| 举措合成 | `src/lib/painPointClustering/clusterActionSynthesis.js` | productActions 优先级链 |
| 截断配额 | `src/lib/planningRecommendations.js`（2566 行） | 去重、配额、排序、链接 |
| LLM 润色 | `src/lib/overviewConclusionsLLM.js` | 只润色文案，不重新聚类 |

标题常量：`PLANNING_RECOMMENDATIONS_PANEL_TITLE = '行动建议'`（`src/domain/overviewConclusions.js:9`）。

---

## 二、触发时机（三条路径）

### 1. 生成 / 刷新洞察（唯一会持久化的路径）

```
「生成/刷新洞察」按钮
  → snapshotService.rebuildAllSnapshots()
  → rebuildOverviewSnapshot()          // 先重建 5 个来源快照，再重建概览
  → buildOverviewSnapshot()
  → buildOverviewConclusions()         // ★ 行动建议在此生成
  → adapter.putSnapshot()
```

关键点：
- `rebuildOverviewSnapshot` 会先读取**上一周期**的 `conclusions.recommendations` 作为 `previousRecommendations`，供环比比较用。
- 重建后若旧快照有 `recommendationsLlm`（LLM 润色记录），会**原样继承**，避免刷新洞察把人工润色结果冲掉。
- 结果是**只读快照**：改数据不改建议，必须重新刷新洞察。

### 2. 展示期兜底重算（不持久化）

`rehydrateOverviewRecommendations.js`：
- `needsOverviewRecommendationsRehydrate()`：快照 `recommendationEngine` 不以 `pain_cluster_v2` 开头、或 `legacyFallback === true` → 判定为旧快照。
- `prepareOverviewConclusionsForDisplay()`：旧快照**直接清空建议列表**，只留提示"需通过生成/刷新洞察生成"。
- `refreshStaleV2RecommendationSections()`：V2 快照但 `actionSynthesisVersion < 8`、或 `productActionsSource` 不是 `synth/synth+manual`、或摘要像工单元数据 → 用当前规则**重算 sections**，并加注"已基于当前工单实时重算"。

### 3. LLM 润色（可选，改文案不改结构）

`polishPlanningRecommendationsWithLLM()`：
- 前置：服务端配置 LLM（`LLM_API_KEY`），且当前周期已有建议。
- 只允许改 `summary` / `productActions` / `serviceActions`，system prompt 明令禁止改 `id / priority / category / scope / evidence / clusterRootCause`。
- 后置校验：摘要长度 < 12 字、或判定为统计描述句、或判定为通用套话 → **整条回退规则结果**。
- 成功改动的条目标记 `measureSource: 'AI 润色'`，快照 `source` 升级为 `hybrid`。

---

## 三、主链路详解

### Step 1 · 取数与前置门槛

```js
ticketRecords = 周期内 complaint_ticket + consultation_ticket（filterRecordsForScope）
totalRecords = 全部来源记录数
```

- `totalRecords < 3` → 直接返回 `insufficientData: true, recommendations: []`，不再往下走。
- 顺带产出 `dataCoverageNotes`：来源缺失、订单量缺失、聚类排除说明、问题原因缺失率、负面情绪占比。

### Step 2 · 分源聚类（投诉、咨询各跑一遍 pipeline）

`buildClusterRecommendationsFromPipeline(records, { settings, profile })`，`profile` 由 `resolveClusterProfile()` 决定：

| profile | topN | 一次阈值 | 低价值类型 | 高危单例阈值 |
| --- | --- | --- | --- | --- |
| complaint | 10 | 0.30 | 配额与权限申请、其他 | 4.8 |
| consultation | 10 | 0.28 | 其他 | 4.2 |
| overview | 12 | 0.30 | — | 4.5 |

> 注意：`overviewProfile.topN = 12` 实际**未生效**——`buildOverviewConclusions` 传给两条 pipeline 的是 `complaintProfile` / `consultationProfile`（都是 10），overview profile 只用于 `recommendationsMeta` 里的 `profileId` / `scoreModelVersion` 标注。

单产品 pipeline（`runProductClusteringPipeline`）：

**2.1 一次聚类** `runPrimaryClustering`
- 按 `(product, dataSourceType, journeyL1)` 分组（L1 缺失记"未识别环节"）。
- 组内**以「问题原因」为主**：按 `causeKey` 分桶，桶内 ≥ `PRIMARY_MIN_CLUSTER_SIZE = 2` 条即成簇；桶 < 2 条打入 isolated。
- 无问题原因的工单**退回痛点 Jaccard 层次聚类**（阈值 0.3，最小 2 条）。
- 输出 `PrimaryPainCluster`，带 `representativeCause` / `causeKey` / `problemType`（多数票）。

**2.2 低价值过滤** `filterLowValuePrimaryClusters`
- `problemType ∈ LOW_VALUE_PROBLEM_TYPES` 的一次簇整簇剔除，计入 `excludedPrimaryClusterCount` / `excludedTicketCount`。

**2.3 二次聚类** `runSecondaryClustering`
- **只按 `causeKey` 合并**：同因合并（允许跨 L1、跨来源），异因禁止合并。
- 无因的一次簇**各自独立**，不再跨 L1 合并。
- 输出 `FinalPainCluster`。
- ⚠️ 旧的 `runSecondaryClusteringByPain`（痛点 Jaccard）已标 `@deprecated`，v2.4 默认不调用，`SECONDARY_CLUSTER_THRESHOLD = 0.2` 实际不再使用。

**2.4 高危单例** `identifyHighRiskSingletons`
```
riskScore = severity×0.9 + emotion×0.5 + urgent×0.9 + unresolved×1.1 + highValue×0.6 + negative×0.4
```
- 仅对 isolated 记录计算，≥ `singletonMinRiskScore` 才保留（投诉 4.8 / 咨询 4.2）。

### Step 3 · 打分排序

`scoreAndRankFinalClusters`：

```
breadthScore = clamp(1 + sharePct / 4, 1, 5)        // 连续化，避免阶梯跳变
p90Severity / p90Emotion / maxSeverity
urgentRate / unresolvedRate / highValueRate / negativeRate / repeatRate / selfServiceRate
```

**投诉 profile**：
```
harmScore     = clamp(p90Severity×0.32 + p90Emotion×0.20
                    + urgentRate×5×0.16 + unresolvedRate×5×0.16 + highValueRate×5×0.16)
priorityScore = clamp((breadth×0.40 + harm×0.60) × confidenceDiscount)
```

**咨询 profile**：
```
harmScore     = clamp(breadth×0.15 + repeatRate×5×0.25 + selfServiceRate×5×0.25
                    + negativeRate×5×0.10 + highValueRate×5×0.10 + p90Emotion×0.15)
priorityScore = clamp((breadth×0.45 + harm×0.55) × confidenceDiscount)
```

```
confidenceDiscount: ≥8 单 → 1.00 | ≥5 → 0.95 | ≥3 → 0.88 | 否则 0.76
```

按 `priorityScore` 降序取 Top N，写入 `rank` / `totalFinal`。

### Step 4 · 群组 → 建议骨架

`scoredFinalClusterToRecommendation()`：

- **类名（label）优先级**：`cluster.representativeCause` → `pickRepresentativeCause(records)` → `pickRepresentativeCauseLabel()` → `pickInsightRepresentativePain()` → 原 label → "未命名问题群组"。
  → v2.4 起**优先用"问题原因"当类名**，痛点只作证据。
- **稳定键**：`stableKey`（product + 类名 + problemType 哈希）+ `fingerprintV2`（product + theme + problemType + journeyL1），用于跨周期比对与跨源融合。
- **priority**：`priorityScore ≥ 4 → high`，`≥ 3 → medium`，否则 `low`。
- **scope**：product / dataSourceType / journeyL1 / journeyL2 / problemType。
- `insufficientEvidence = ticketCount < 3`。
- 同时落 `painClusterScores`（打分明细、来源分布行、客户层级分布）。

### Step 5 · 跨源融合与小产品兜底

**融合** `buildOverviewFusedRecommendations`：
- 以 `fingerprintV2`（回退 `stableKey`）为键，合并投诉与咨询的同类群组。
- 保留 score 最高的成员为底本，`signalType` 改为 `overview_fused_cluster`。
- `sourceGroup`：`cross_source`（两边都有）/ `complaint_only` / `consultation_only`。
- **跨源加分**：`mergedScore = min(5, max(memberScores) + (cross_source ? 0.45 : 0))`。
- 跨源时 summary 追加"（投诉/咨询共性主题）"。
- `fallback_reference` 类（小产品兜底）不参与融合，单独排在后面。

**小产品兜底** `appendSmallProductJourneyProblemFallbacks`：
- 3 ~ 29 单（`MIN_PRODUCT_TICKETS_FOR_COVERAGE=3` ~ `SMALL_PRODUCT_FALLBACK_MAX_TICKETS=29`）且该产品无正式聚类建议 → 取 `journeyL1×L2×problemType` 最高频组合补 1 条，priority `low`，`insufficientEvidence: true`，`evidenceStrength: 'weak'`。

### Step 6 · 内容生成（四个 sections）

`attachPlanningRecommendationSections(rec, pool)` → `buildPlanningRecommendationSectionsCore`

| 区块 | 生成函数 | 规则 |
| --- | --- | --- |
| `executiveSummary` | `buildInsightExecutiveSummary` | 有「问题原因」→ `因 {原因} 导致的问题（N 条工单，占该产品 M%）`；无 → 提炼痛点句 demand clause。上限 88 字，只取第一句 |
| `clusterRootCause` | `buildClusterRootCauseStructured` | `causeLabel` + 簇内痛点 Top 5（与代表痛点 Jaccard ≥ 0.35 标 `isRepresentative`）+ `businessImpact`（环节断点 / 负面占比 ≥40% / 加急 ≥2 / 金银牌 ≥2 / 占比 ≥8%，上限 120 字） |
| `productActions` | 见下方优先级链 | ≤ 4 条，每条 ≤ 96 字，必须命中 `PLANNING_ACTION_RE` 动作词，长度 ≥ 12 |
| `serviceActions` | `collectProductAndServiceActions` | ≤ 2 条；按 `SLA\|协查\|催办\|流程\|协同\|回访\|升级路径\|知识库\|空转` 正则从优化建议里分流 |

**productActions 生成优先级**（`synthesizeClusterProductActions`，取前 2 条）：

| 优先级 | 来源 | 条件 |
| --- | --- | --- |
| 100 | 确立举措（established） | 群组内同一举措关联 ≥ 3 单 |
| 80 | 工单人工复核优化建议 | `optimization` 字段，source = 人工复核 |
| 50 | 旅程 / 问题类型 playbook | `collectPlanningPlaybookActionLines` |
| 40 | 问题类型模板句 | `buildProblemTypePrimaryAction` |
| 30 | 备选问题类型模板句 | 咨询↔配额↔配置 轮换 |

- 过滤：长度 < 12、命中 `SERVICE_ACTION_RE`、命中已废弃通用句、缺动作词 → 全部丢弃。
- 问题类型兜底推断 `inferProblemTypeForCluster`：配额 → 计费 → 配置 → 连通性 → 声明类型 → 产品功能咨询。

**不足时的逐级降级**：
1. 合成 < 2 条 → 用群内工单 `optimization` 字段聚合（`collectProductAndServiceActions`）
2. 仍 < 2 条 → **Playbook 兜底**（`collectPlaybookFallbackProductActions`）
3. 仍 < 2 条 → 回落到 `rec.details` 原文
4. 最后 `enforcePlanningSectionRules` 统一收紧：summary 88 字、productActions 4 条、serviceActions 2 条

**举措-痛点对齐校验** `refineProductActionsForPainAlignment`：
```
similarity = Jaccard(tokenizeZh(摘要), tokenizeZh(举措))
```
- `< 0.2` 视为不对齐 → 剔除
- 对齐后不足 2 条 → 用 playbook 替换
- `actionAlignmentWeak = 有不对齐 && (对齐后<2条 || 平均分<0.25 || 用了 playbook)`
- 标记 weak → `evidenceStrength` **降一级**（strong→medium→weak）

**来源标记** `measureSource`：`synth+manual` / `synth` / `playbook` / `mixed` / `ticket`。

### Step 7 · 截断、环比与突发标注

**条数上限** `computeMaxPlanningRecommendations`：
```
每个产品（取 Top 24）按工单量给目标条数：
  <3 → 0 | <30 → 1 | <100 → 2 | <300 → 3
  ≥300 → clamp(round(3 + n/300×4), 3, 8)
求和后 clamp 到 [4, 48]   // MAX_PLANNING_RECOMMENDATIONS = 48
```

**配额选取** `limitPlanningRecommendationsWithProductQuota`：
1. 先按产品配额**保底**（每产品先占位）
2. 再全局填充至 max（单产品累计上限 8 条）
3. `sortRecommendationsForSelection`：正式聚类优先 → `evidenceStrength` 强→弱 → score 降序 → rank 升序 → priority
4. `dedupeSameProductPlanningRecommendations`：同产品去重
   - 摘要 Jaccard ≥ 0.4
   - 或 productActions 全文相似度 ≥ 0.72
   - 或 productActions 前 40 字相同

**环比** `attachRecommendationPeriodCompare`：与上一周期建议按 `stableKey` 比对，注入 `periodCompare`（`lifecycle: new/growing/...`、`deltaCount`），统计 `removedFromPreviousCount`。

**突发标注** `applyCauseSpikeHighlight`：
- 本期新增 → 追加"（本期新增）"
- `growing` 且当前 ≥ 3 条、环比 ≥ 2 倍 → 追加"（环比 X 倍）"
- 依赖上一周期快照，无上期则无标注。

---

## 四、可观测元数据

快照 `conclusions.recommendationsMeta`：

```
ruleVersion                  pain-cluster-v2.4
recommendationEngine         pain_cluster_v2_4
profileId / scoreModelVersion / fingerprintVersion
stableKeyVersion             cluster-stable-key-v1|fallback-stable-key-v1|cluster-family-stable-key-v2
generatedRecommendationCount 融合前生成总数
formalClusterCount           正式聚类建议数
fallbackReferenceCount       小产品兜底数
singletonCount               高危单例数
overviewFusedCount           跨源融合数
cappedCount                  截断后条数
removedFromPreviousCount     相对上期消失条数
legacyFallback               false
```

面板分组展示：`isPainClusterRecommendation`（正式）/ `isFallbackReferenceRecommendation`（兜底），按产品分组，支持按产品筛选与 xlsx 导出。

---

## 五、观察与风险点

### 1. 强依赖「问题原因」打标质量 ✅ 最大变量
v2.4 把聚类主轴从"痛点文本相似度"改成了"问题原因键"。好处是类名稳定、同类不散；代价是**打标缺失会直接导致质量塌方**：
- 缺原因的工单退回痛点 Jaccard，群组质量下降；
- 缺原因占比 ≥ 30% 时，概览会加提示"已按问题类型回退聚类"，建议批量重打标补全。

### 2. 旧规则引擎已是死代码
`planningRecommendations.js` 里的 `buildPlanningRecommendations()`（含 `wan_tou` / `root_cause` / `risk_negative` / `risk_trend` / `journey_hotspot` 五类信号，约 700 行）**在生产链路已无调用方**，仅被 `planningRecommendations.test.js` 引用。`SIGNAL_TYPE_TEMPLATE`、`buildPrimaryActionForSignal`、`buildPlanningSummary/Details` 等相关工具同理。建议核实后清理，或至少在文件头标注 deprecated，避免误改。

### 3. `overviewProfile.topN = 12` 未生效
概览实际用的是投诉/咨询 profile（topN = 10）。要么改成传 overview profile，要么把 topN 改回 10，避免配置与行为不一致造成误解。

### 4. 二次聚类的阈值常量已失效
`SECONDARY_CLUSTER_THRESHOLD = 0.2` 与 `runSecondaryClusteringByPain()` 在 v2.4 下不再参与计算，但常量仍在 `constants.js` 导出、仍被 `planningRecommendationTemplate.js` 帮助文案引用，容易误导。

### 5. 展示期重算不落库，会造成"所见非所存"
`refreshStaleV2RecommendationSections` 在页面打开时重算 sections，但不写回快照。用户看到的"已基于当前工单实时重算"内容，导出（走快照数据）时可能不一致。建议重算后提示用户刷新洞察，或直接落库。

### 6. 举措对齐度阈值偏严
`ACTION_PAIN_ALIGNMENT_THRESHOLD = 0.2` 用的是中文 2-gram Jaccard，摘要短、举措长时天然偏低，容易误判为 weak 并触发 playbook 替换——这会导致**多条不同建议的举措趋同**（都变成 playbook 通用句）。如果遇到"建议举措千篇一律"的反馈，这里是首要排查点。

### 7. 跨源 +0.45 是可观的加成
投诉/咨询同时命中的主题会额外加 0.45 分（上限 5 分制），相当于约 9% 的排序权重提升。这是有意设计（共性主题优先），但调优时需注意它不是对称的——只有跨源才加。

---

## 六、一句话总结

行动建议 = **痛点聚类 V2.4 的 Top 群组** × **"问题原因优先"的类名/合并策略** × **"确立举措 > 工单优化 > playbook > 模板"的举措降级链** × **按产品体量动态配额的截断**，生成后写入周期快照；LLM 只做文案润色，不改结构与排序。
