# LLM 打标 P0 优化 — 改造设计

**版本**：2026-06-02  
**状态**：Phase A~D（P0-1~P0-4）已实现 — unified ticket LLM + 旅程门控 + 流水线重排 + 补打扩展  
**目标**：全量 ~1400 条场景 token 降 **40~60%**；消除「ticket LLM 失败、旅程 token 白打」  
**关联**：[TICKET-ANALYSIS-P0-RULES.md](./TICKET-ANALYSIS-P0-RULES.md)、[TEST-PLAN.md](./TEST-PLAN.md)

---

## 1. 背景与范围

### 1.1 现状（legacy 流水线）

```
规则初标 → 请求场景/问题类型（规则）→ 用户旅程 LLM（hybrid 全量）
  → 客户请求 LLM → 痛点 LLM → 优化建议 LLM → 用户情绪（规则）
```

- 投诉/咨询：**~4 次 LLM/条**（1 旅程 + 3 ticket）
- `taggingText` 重复送入 **4 次**
- 全量重打时 ticket 阶段失败 → **旅程 LLM 已消耗不可回收**

### 1.2 P0 四项

| ID | 内容 |
|----|------|
| P0-1 | 合并 ticket 三调用为一次 LLM（+ optimization 三层保障，见 §3） |
| P0-2 | 用户旅程 LLM 门控（高置信本地命中跳过） |
| P0-3 | 流水线重排：ticket 先于 journey |
| P0-4 | 扩展补打策略（`needs_ticket_llm` / `needs_journey_llm`） |

### 1.3 目标流水线（ticket_first）

```
规则初标 → 请求场景/问题类型（规则）
  → 工单分析 LLM（合并 1 次 + 按需 optimization 补打）
  → 用户旅程 LLM（门控）
  → 用户情绪（规则）
```

---

## 2. 配置与回滚

团队级设置（`AppSettings` / `appSettingsPersist`）：

| 键 | 默认（新） | 说明 |
|----|-----------|------|
| `ticketLlmMode` | `unified` | `unified` \| `split2` \| `separate`（回滚） |

默认 `unified`：单次 LLM 输出客户请求/痛点/优化；optimization 校验失败时 **compact 补打**（见 [LLM-TAGGING-P0-DESIGN.md](./LLM-TAGGING-P0-DESIGN.md)）。
| `journeyLlmGating` | `true` | hybrid 下本地高置信跳过旅程 LLM |
| `journeyLlmSkipScoreThreshold` | `3` | 与 `matchJourneyFromText` 关键词 +3 对齐 |
| `taggingPipelineOrder` | `ticket_first` | `ticket_first` \| `legacy` |

**事故回滚**：`ticketLlmMode=separate` + `taggingPipelineOrder=legacy` + `journeyLlmGating=false` → 行为≈现网。

---

## 3. P0-1：合并 Ticket LLM + Optimization 三层保障

### 3.1 动机

三次独立调用重复 system prompt + `taggingText`（≤4000 字 ×3）。合并为一次结构化输出可显著省 input token；但存在模型「偷懒」只填 `customerRequest` / `painPoint`、省略 `productOptimizations` 的风险。

**结论**：单靠 U-02（rule fallback）+ 非空率监控 **不能** 保证 optimization 的 LLM 质量；须 **预防 + 校验 + 按需补打** 三层组合。

### 3.2 新增模块与接口

**文件**：`src/lib/ticketAnalysis/ticketAnalysisUnifiedLLM.js`

```typescript
type TicketAnalysisUnifiedInput = {
  taggingText: string                    // ≤4000
  candidates: CustomerRequestCandidate[]
  ruleFallback: {
    customerRequest: string
    painPoint: string
    optimizationProduct: string
    optimizationService: string
  }
  handlingText?: string
  rootCause?: string
  solutionSummary?: string
  requestScene?: string                  // 规则版即可，不必等旅程 LLM
  problemType?: string
  journeyL2?: string                     // 规则初标 journeyL2
  fuzzy?: boolean
}

type TicketAnalysisUnifiedResult = {
  customerRequest: string
  painPoint: string
  optimizationProduct: string
  optimizationService: string
  optimizationSuggestion: string
  customerRequestSource: 'rule' | 'llm'
  painPointSource: 'rule' | 'llm'
  optimizationSource: 'rule' | 'llm'
  partialFailures?: ('customerRequest' | 'painPoint' | 'optimization')[]
  optimizationRetry?: boolean            // true = 合并后触发了按需 optimization 补打
}

extractTicketAnalysisUnifiedWithLLM(
  input: TicketAnalysisUnifiedInput,
  settings: AppSettings,
): Promise<TicketAnalysisUnifiedResult>
```

**编排入口**（`ticketLlmEnrichment.js`）：

```typescript
enrichRecordWithTicketLlm(record, settings)
  → build input from corpus + rule fallbacks
  → switch (settings.ticketLlmMode):
       'separate'  → 现有三调用（回滚）
       'split2'    → callA(request+pain) + callB(optimization)  // 见 §3.6
       'unified'   → extractTicketAnalysisUnifiedWithLLM → postValidate → maybe optimizationRetry
```

### 3.3 三层保障（解决 optimization「偷懒」）

#### 层 1 — 预防（降低偷懒概率）

1. **硬约束**：JSON schema / prompt 要求 `productOptimizations` **minItems: 1**；system 写明「缺 productOptimizations 视为无效回答」。
2. **足够输出 token**：合并调用 `max_tokens` **≥ 1024**（现单独 optimization 为 768）。
3. **分步指令**：在单次 prompt 内明确 Step1→Step2→Step3，优化放在独立第三步且不可省略。
4. **Structured output**：API 支持时使用 `response_format: json_schema`（或等价能力）。

#### 层 2 — 校验（合并后立即判定）

```text
unified 解析
  → isValidLlmCustomerRequest / isValidLlmPainPoint（现有）
  → validateTicketAnalysisPair(request, pain, rule*)
  → isValidUnifiedOptimization(result)  // 新增：≥1 条 product，且非 isGenericMeasure
  → 任一项失败：该字段 *Source='rule'，partialFailures 记录
```

**新增**：`src/lib/ticketAnalysis/validateUnifiedOptimization.js`

```typescript
isValidUnifiedOptimization(opt: {
  optimizationProduct?: string
  optimizationService?: string
  productOptimizations?: string[]
}): boolean
```

#### 层 3 — 按需补打（保证 optimization LLM 质量）

当 `ticketLlmMode=unified` 且层 2 判定 optimization 无效时：

```text
→ extractTicketOptimizationsWithLLM({
     text: 省略或截断 taggingText，  // 短 prompt
     painPoint, requestScene, problemType, journeyL2, rootCause, solutionSummary, fuzzy
   })
→ 成功：optimizationSource='llm', optimizationRetry=true
→ 仍失败：保留 ruleFallback，optimizationSource='rule'
```

**Token 估算（1400 条，假设 30% 需补打）**：

| 方案 | LLM 次数（ticket 段） |
|------|----------------------|
| 现状 separate | ~4200（1400×3） |
| 纯 unified、不补打 | ~1400（优化质量风险） |
| unified + 按需 optimization 补打 | ~1400 + 420 ≈ **1820** |

仍显著低于现状；补打 prompt **不带** 全文 `taggingText`。

### 3.4 监控与回归

| 指标 | 用途 | 阈值（建议） |
|------|------|--------------|
| `optimizationSource=llm` 占比 | 批量/导入后抽检 | 较 separate 基线 **≥90%** |
| `optimizationRetry` 占比 | 合并偷懒率 | 观察；>40% 考虑改 split2 |
| `partialFailures` 含 optimization | 单条诊断 | 日志 + 可选导出列 |

### 3.5 回归用例（P0-1）

| ID | 场景 | 预期 |
|----|------|------|
| U-01 | 正常投诉 fixture | 三字段 `*Source=llm`，无 partialFailures |
| U-02 | unified 仅返回 request+pain | optimization rule fallback；**触发 optimizationRetry 成功** → 最终 `optimizationSource=llm` |
| U-03 | unified 偷懒且补打仍失败 | `optimizationSource=rule`，partialFailures 含 optimization |
| U-04 | 引导语痛点 | validate 拒绝，pain rule fallback |
| U-05 | 超长输出 | PAIR_TOTAL_MAX / HARD_MAX 与现网一致 |
| U-06 | unified vs separate 20 条 golden | request/pain Jaccard ≥0.85；**O-golden：optimization 非 generic 率 ≥ separate 的 90%** |
| U-07 | 批量 4 并行 + onBatchPersist | 行为不变 |
| U-08 | 无 API Key | 全 rule，0 次 llmChatCompletion |
| U-09 | `ticketLlmMode=separate` | 走旧三调用 |
| U-10 | `optimizationSource=llm` 率统计 | 脚本/测试夹具可断言 |

### 3.6 备选模式：`split2`

当 U-06 / 线上监控显示 unified 优化非空率 **<90%** 时，无需回滚 separate，切换：

| 调用 | 内容 |
|------|------|
| Call A | customerRequest + painPoint（同 context，1 次） |
| Call B | optimization（依赖 A，短 prompt，1 次） |

`ticketLlmMode=split2`：比 separate 少 1 次全文重复，optimization 独立成 call，几乎不会被「挤掉」。

### 3.7 改造触点

| 模块 | 变更 |
|------|------|
| `ticketAnalysisUnifiedLLM.js` | 新增 |
| `validateUnifiedOptimization.js` | 新增 |
| `ticketLlmEnrichment.js` | 编排 unified / split2 / separate + optimizationRetry |
| `ticketAnalysis.js` | `enrichTicketAnalysisWithLlm` 同步 |
| `storage.js` / `appSettingsPersist.js` | `ticketLlmMode` |

---

## 4. P0-2：旅程 LLM 门控

### 4.1 接口

**文件**：`src/lib/journeyMatchConfidence.js`

```typescript
evaluateJourneyGating(text, journeys, taxonomyKey, settings): JourneyGatingDecision
filterIndicesNeedingJourneyLlm(texts, taxonomyKeys, settings): number[]
```

**skipLlm 条件（默认）**：

- `isValidJourneyPair(local) && score >= journeyLlmSkipScoreThreshold`
- 非 `semantic` 全量模式
- 非空 catalog 需提案场景

**可选 record 字段**：`journeySource: 'rule' | 'llm'`，`journeyMatchScore?: number`

### 4.2 改造触点

- `journeySemantic.js`：`matchJourneyHybridBatch` 仅对需 LLM 的 index 调用 `callLlmJourneyBatch`
- `ticketTagging.js`：导出本地 match score 供 gating

### 4.3 回归用例

| ID | 场景 | 预期 |
|----|------|------|
| G-01 | 关键词命中 score≥3 | skipLlm，`journeySource=rule` |
| G-02 | 未识别环节 | 调 LLM |
| G-03 | 库外 / 空 catalog | 调 LLM |
| G-04 | semantic 模式 | 全量 LLM，门控不生效 |
| G-05 | 批 8 条 5 skip | 1 次 LLM 仅含 3 条 |

### 4.4 改造触点（已实现）

| 模块 | 变更 |
|------|------|
| `journeyMatchConfidence.js` | 新增 `evaluateJourneyGating` / `filterIndicesNeedingJourneyLlm` |
| `journeySemantic.js` | `matchJourneyHybridBatch` 门控分组；`enrichRecordsWithJourneys` 写入 `journeySource` / `journeyMatchScore` |
| `ticketTagging.js` | 导出 `matchJourneyFromTextWithScore`、`JOURNEY_UNKNOWN_L1/L2` |
| `storage.js` / `appSettingsPersist.js` | `journeyLlmGating`、`journeyLlmSkipScoreThreshold` |
| `journeyMatchConfidence.test.js` | G-01~G-05 |

**说明**：`semantic` 模式仍全量 LLM；`matchJourneySemanticBatch` 不做门控（by design）。

---

## 5. P0-3：流水线重排

### 5.1 `reprocessAllThemesAndSentiment` options

```typescript
type ReprocessThemesOptions = {
  forceOverrideManualTags?: boolean
  ticketLlmOnly?: boolean
  journeyLlmOnly?: boolean          // 新增
  onTicketLlmBatchPersist?: ...
  pipelineOrder?: 'ticket_first' | 'legacy'
}
```

**ticket_first 顺序**：

1. `enrichRecordsWithSharedDimensions`
2. `enrichRecordsWithTicketLlm`（§3）
3. `enrichRecordsWithJourneys`（§4，门控）
4. `themesFromJourney` + `analyzeTicketSentiment`

**P0 已知差异**：optimization 使用**规则初标** `journeyL2`；旅程 LLM 后不自动重跑 optimization（P1 可选 `refreshOptimizationIfJourneyChanged`）。

### 5.2 同步改造

- `importEnrichment.js` / `Import.jsx` 进度文案与顺序
- 打标完成前不触发 `scheduleSnapshotRebuild`（或标记快照过期）

### 5.3 回归用例

| ID | 场景 | 预期 |
|----|------|------|
| O-01 | ticket_first 全链路 | 阶段顺序正确 |
| O-02 | ticket 中途中断（429） | 已 persist 批次保留；**旅程 LLM 调用次数=0** |
| O-03 | `pipelineOrder=legacy` | 与现网一致 |
| O-04 | `ticketLlmOnly` | 跳过场景/类型/旅程 |
| O-05 | `journeyLlmOnly` | 仅 journey + themes |

### 5.4 改造触点（已实现）

| 模块 | 变更 |
|------|------|
| `taggingPipeline.js` | `resolveTaggingPipelineOrder` / `llmStageOrderAfterShared` |
| `applyThemes.js` | `reprocessAllThemesAndSentiment` 支持 `pipelineOrder` / `journeyLlmOnly` |
| `importEnrichment.js` | 导入打标顺序与 `taggingPipelineOrder` 对齐 |
| `storage.js` / `appSettingsPersist.js` | `taggingPipelineOrder` 默认 `ticket_first` |
| `taggingPipeline.test.js` / `applyThemes.test.js` | O-01~O-05 |

---

## 6. P0-4：补打策略扩展

### 6.1 接口

**`ticketAnalysisSources.js`**：

```typescript
recordNeedsJourneyLlmEnrichment(record): boolean
countRecordsNeedingJourneyLlmEnrichment(records): number
```

**`retagSession.js`**：`BulkRetagScope` 增加 `needs_journey_llm`

**导入结果**：

```typescript
enrichmentStats: {
  ticketLlmCompleted: number
  ticketLlmFailed: number
  journeyLlmCompleted: number
  journeySkippedByGating: number
  optimizationRetryCount: number    // 新增
}
```

导入失败 warning 引导：**反馈库 → 待 LLM 增强 → 补打**，勿默认全量重打。

### 6.2 UI

- 反馈库筛选项：**待 LLM 增强**（已有）、**待旅程 LLM**（新增）
- 批量重打范围对应 `needs_ticket_llm` / `needs_journey_llm`

### 6.3 回归用例

| ID | 场景 | 预期 |
|----|------|------|
| R-01 | 导入 ticket 第 50 条 429 | 前 48 条已 LLM；warning 含补打指引 |
| R-02 | needs_ticket_llm | 不跑 journey，不 reset 规则初标 |
| R-03 | needs_journey_llm | 仅 journey + themes |

### 6.4 改造触点（已实现）

| 模块 | 变更 |
|------|------|
| `ticketAnalysisSources.js` | `recordNeedsJourneyLlmEnrichment` / `computeJourneyEnrichmentDelta` |
| `importEnrichmentStats.js` | 导入 `enrichmentStats` 与补打 warning |
| `importEnrichment.js` | 返回 stats + 补打指引 |
| `retagSession.js` / `useBulkRetagModal.jsx` | `needs_journey_llm` scope |
| `InsightsContext.jsx` | `journeyLlmOnly` 补打路径 |
| `Feedbacks.jsx` | 「待旅程 LLM」筛选 + 提示条 |
| `Import.jsx` | 展示 enrichmentStats |

---

## 7. 洞察 / 聚类影响评估

| 能力 | 关键字段 | P0 影响 | 需刷新洞察 |
|------|----------|---------|------------|
| 痛点一次聚类 | `painPoint`, `journeyL1` | pain 质量↑；journey 可能暂为规则版 | ✅ |
| 旅程聚类视图 | `journeyL1/L2` | 门控跳过=规则 journey | 旅程补打后 ✅ |
| 综合概述 | 聚类 + 旅程计数 | 与终态 record 一致 | ✅ |
| 行动建议（聚类） | 簇 + pain + optimization | 依赖 pain；optimization 有三层保障 | pain/optimization 补打后 ✅ |
| 单条优化（抽屉） | `optimization*` | P0 用规则 journeyL2 写 optimization | 可选 |
| 情绪分布 | sentiment | ticket 后重算，不变 | 否 |

**聚类分组键**：`product + dataSourceType + journeyL1`（`primaryCluster.js`）。旅程补打后 L1 变化可能导致 record 跨组 — 属预期，刷新快照即可。

---

## 8. 实施顺序

| 阶段 | 内容 | 预估 |
|------|------|------|
| A | P0-1 unified + validate + optimizationRetry + U-01~U-10 | 2~3d |
| B | P0-2 旅程门控 + G-01~G-05 | 1~2d |
| C | P0-3 流水线重排 + O-01~O-05 | 1d |
| D | P0-4 补打 scope/UI + R-01~R-03 | 1~2d |
| E | U-06 / O-golden 对比 + 洞察 spot check | 1~2d |

---

## 9. 验收标准

1. **Token**：500 条 EIP 投诉，`llmChatCompletion` 次数与 prompt 字符较现网降 **≥40%**
2. **质量**：U-06 + O-golden 通过；`optimizationSource=llm` 率 ≥ separate 基线 **90%**
3. **可靠性**：O-02 中断实验 — ticket 批次持久化，旅程调用=0
4. **洞察**：同周期刷新后 cluster 数变化 <10%（允许 pain 精炼致标签变化）
5. **回滚**：§2 配置回滚后 UAT 与现网一致

---

## 10. 测试计划映射（TEST-PLAN 待增）

| 新 ID | 覆盖 |
|-------|------|
| TAG-LLM-01~10 | §3.5 U-01~U-10 |
| TAG-LLM-11~15 | §4.3 G-01~G-05 |
| TAG-LLM-16~20 | §5.3 O-01~O-05、§6.3 R-01~R-03 |

**新增测试文件（建议）**：

- `src/lib/ticketAnalysis/ticketAnalysisUnifiedLLM.test.js`
- `src/lib/ticketAnalysis/validateUnifiedOptimization.test.js`
- `src/lib/journeyMatchConfidence.test.js`

---

## 11. 相关文档

- [TICKET-ANALYSIS-P0-RULES.md](./TICKET-ANALYSIS-P0-RULES.md) — 打标规则与来源字段
- [TEST-PLAN.md](./TEST-PLAN.md) — 系统测试计划
- [DATA-PERSISTENCE.md](./DATA-PERSISTENCE.md) — 批量打标分批写库
