# 工单分析 P0 规则层技术说明

**版本**：2026-06-02（P0 LLM 打标 + **请求场景 V2 决策树**）  
**关联业务规范**：[data/从单条工单提取客户请求内容挖掘需求痛点.md](../data/从单条工单提取客户请求内容挖掘需求痛点.md)（V2）、[data/请求场景标签体系及打标规则.md](../data/请求场景标签体系及打标规则.md)（V2.0）  
**适用范围**：单条工单分析中，**无大模型 API Key** 时的最终输出，以及 **有 Key 时 LLM 层的候选收集与 fallback**。  
**UAT**：[LLM-TAGGING-P0-UAT.md](./LLM-TAGGING-P0-UAT.md)

---

## 1. 定位与边界

| 层级 | 职责 | 主要模块 |
|------|------|----------|
| **P0 规则层** | 全生命周期候选收集、过滤、优先级选取、截断；规则版痛点 | 本文档所列模块 |
| **P1 LLM 层** | 客户请求精炼摘要、痛点语义提炼 | `customerRequestLLM.js`、`painPointLLM.js` |
| **校验层** | 两字段一致性、长度兜底 | `validateTicketAnalysisPair.js` |

P0 **不做**以下事项（由 LLM 负责）：

- IP/资源 ID 概括为「多台云主机」等
- 删除情绪词、重复感谢语
- 咨询类统一「咨询…」「申请…」句式
- 体验反馈的客观改写

规则层输出的是**选出的原话片段 + 截断**，不是 V2 示例中的精炼摘要句。

---

## 2. 模块与调用链

```
工单字段 (rawText / handlingText / customerQuote / sourceColumns)
    │
    ├─ customerRequestFilters.js    清洗、附录过滤、模板检测
    ├─ workflowTextCleanup.js       去掉「协办&网络组：」等组前缀
    ├─ ticketDetailDisplay.js       extractCustomerRequestSegments（受理/追加分段）
    │
    ├─ customerRequestExtract.js    候选 → 选取 → truncate → ruleCustomerRequest
    ├─ painPointExtract.js          规则痛点
    │
    └─ ticketAnalysis.js            analyzeTicketCore（规则初标）
         ├─ analyzeTicket()         无 Key：P0 即最终输出
         └─ analyzeTicketAsync()    有 Key：P0 → LLM → validate → 情绪重算
```

读写记录时，`recordNormalize.js` 会对 `customerRequest` / `painPoint` 再次截断并过滤纯模板内容。

---

## 3. 客户请求内容（规则层）

### 3.1 长度

| 常量 | 值 | 文件 |
|------|-----|------|
| `CUSTOMER_REQUEST_DEFAULT_MAX` | 80 | `customerRequestExtract.js` |
| `CUSTOMER_REQUEST_HARD_MAX` | 120 | `customerRequestExtract.js` |

`truncateCustomerRequest`：最多取 3 句，硬上限 120 字。

### 3.2 候选收集 `collectCustomerRequestCandidates`

| 来源 | phase | order 说明 |
|------|-------|------------|
| `customerQuote`（经 `resolveDisplayCustomerQuote`） | 1 受理 | 0 |
| `extractCustomerRequestSegments` 初次段 | 1 | 10 + index |
| 同上，追加段（`phase === 'append'`） | 3 追加 | 10 + index |
| `extractLifecycleCustomerPhrases`（协办/反馈/详细内容） | 2 | 100 + index |
| handling fallback | 4 | 200 + index |

每条候选经 `cleanCustomerRequestPhrase` 清洗后，须通过：

- 非无意义文本（`isMeaninglessCustomerText`）
- 非平台处理动作（`isPlatformActionContent`）
- 非纯内部话术（`isInternalCsBackendText`）
- 非格式化模板（`isFormattedTemplateContent`）
- 像客户诉求（`isCustomerDemandLike`）

### 3.3 多轮选取 `selectBestCustomerRequest`

对齐 V2 §1.3.2，比较顺序如下（前者优先）：

1. **优先级档** `getCustomerRequestPriorityTier`  
   - tier 1：客户明确修正（`CORRECTION_RE`）  
   - tier 5：已解决表述（`isResolvedCustomerText`）— 优先从非 resolved 池选取  
   - tier 2：其余正常候选  

2. **严重性** `getCustomerRequestSeverityTier`  
   - 1 故障 → 2 性能 → 3 咨询 → 4 其他  

3. **最新** — `order` 更大者优先  

4. **最完整** — `scoreCustomerRequestCandidate` 更高；同分取更长文本  

辅助打分：修正 +100、故障 +40、性能 +25、咨询 +10、defer 短语 -18、已协助 -40、已解决 -60、phase 加权。

### 3.4 Fallback `extractCustomerRequestRule`

候选为空时依次尝试：

1. `customerQuote`（非模板）
2. `extractCustomerRequestFromHandling(handlingText)`
3. 原始 `customerQuote` 截断

对外导出别名：`extractCustomerRequest` = `extractCustomerRequestRule`。

LLM 上下文：`buildCustomerRequestExtractionContext` 返回 `{ candidates, ruleFallback }`。

---

## 4. 干扰信息过滤

### 4.1 模块 `customerRequestFilters.js`

**整段视为内部话术**（`INTERNAL_CS_BACKEND_RE`，且文本较短或无诉求特征时）：

- 请网络/安全/计算组抓包排查、已返单、建群处理、已建临时群、请服务台拉群  
- 工单保留、暂未回复、待客户补充、已联系客户表示稍后  
- 请扫码进群、已指导/已协助客户、已RAM授权、授权后台处理  
- 请客户验证、回单口径、请提供MTR截图  

若文本较长且含诉求关键词（`CUSTOMER_DEMAND_HINT`），**不**整段丢弃（保留「专线不通，请网络组排查」类混合句）。

**句内删除**（`stripInternalInstructionPhrases`）：删除指令短句，保留前面客户诉求。  
在 `cleanCustomerRequestPhrase` 中与组前缀清理一并执行。

**模板检测**（`isFormattedTemplateContent`）：≥2 个工单字段名堆叠，且去掉字段名后有效内容占比 < 60%。

### 4.2 组前缀 `workflowTextCleanup.js`

`stripInternalWorkflowPrefix`：循环去掉 `首处理&应用一组：`、`详细内容：` 等前缀（最多 4 轮）。

---

## 5. 需求痛点挖掘（规则层）

### 5.1 长度

| 常量 | 值 |
|------|-----|
| `PAIN_POINT_DEFAULT_MAX` | 60 |
| `PAIN_POINT_HARD_MAX` | 80 |

### 5.2 提取优先级 `extractPainPoint`

```
1. customerRequest → rewriteDemandPainPoint
2. 工单正文：客户反馈 / 故障现象 / 问题现象
3. rootCause（根因列，或「定位为/经排查」句，需含 OBJECTIVE_HINT_RE）
4. 工单标题
```

`ticketAnalysis.js` 中若以上皆空，fallback 为 `extractProblemSummary(taggingText).slice(0, 80)`。

### 5.3 需求类规则改写 `rewriteDemandPainPoint`

| 匹配模式 | 输出 |
|----------|------|
| 希望/建议/想要 + 批量删除 | 删除资源需逐个操作，效率低。 |
| 希望/建议/想要 + 批量导出/操作 | 不支持批量操作，效率低。 |
| 希望/建议 + 夜间/深色模式 | 控制台缺少夜间模式切换。 |
| 以「希望/建议/想要」开头 | 去掉引导语后 truncate |

### 5.4 后处理 `truncatePainPoint`

- 去掉「用户希望/建议/反馈…」等引导语  
- 去掉纯情绪词（`太垃圾了`、`烦死了` 等）；**未**去掉「非常慢」「持续卡顿」  
- 取第一分句，补全句号，硬上限 80 字  

---

## 5.5 请求场景 V2 决策树（2026-06-02）

对齐 [data/请求场景标签体系及打标规则.md](../data/请求场景标签体系及打标规则.md) V2.0：**9 类**、序号 1→9 **命中即停**（与问题类型 `problemTypeClassifier.js` 同模式）。

| 模块 | 职责 |
|------|------|
| `requestSceneClassifier.js` | `classifyRequestScene()` / `matchRequestSceneByDecisionTree()` |
| `sharedTagDefs.js` | `REQUEST_SCENES_BUILTIN`（SSOT）、`REQUEST_SCENE_LABEL_MIGRATION`（V1→V2） |
| `dimensionTagging.js` | `resolveRequestSceneFromConfig()` — 决策树优先，回退 `matchSharedLabel` |
| `ticketDimensionTagging.js` | 单条导入四维打标 |

**9 类标签**（优先级从高到低）：报障与排错 → 资源操作申请 → 操作指导 → 进度催办与协同 → 产品信息咨询 → 方案咨询与设计 → 费用与账务 → 信息查询 → 服务申诉与投诉。

**默认类**：无有效关键词时归 **产品信息咨询**（`REQUEST_SCENE_DEFAULT`）。

**否定 / 互斥**（代码内实现，非 Excel 配置）：如「如何退订」不归资源操作申请；「退订时报错」归资源操作申请；「申请+催办」归资源操作申请；强服务投诉优先于纯催办等（见 `requestSceneClassifier.test.js` §4 golden）。

**配置发布**：`npm run generate:taxonomy-xlsx` 从 `REQUEST_SCENES_BUILTIN` 生成 Excel/`index.json`（`index.version` ≥ 5）。标签管理「发布打标配置」与之 sheet 顺序一致。

**历史数据**：旧标签名（如 `报障与恢复`）经 `migrateRequestSceneLabel()` 映射；**决策树结果**需反馈库 **批量重新打标** 后才会刷新。

**Post-LLM 维度重打**（`retagDimensionsAfterTicketLlm`，默认 **开**）：

| 模块 | 职责 |
|------|------|
| `dimensionTaggingText.js` | `buildDimensionTaggingTextForRecord({ llmCorpusOnly })`、`buildFullTaggingTextForRecord` |
| `dimensionTagging.js` | `retagRecordsSharedDimensionsAfterTicketLlm()`、`resolveProblemTypeWithPeerFallback()` |
| `applyThemes.js` / `importEnrichment.js` | ticket LLM 成功后调用重打（旅程 LLM 之前） |

- **触发**：仅 `customerRequestSource='llm'` 或 `painPointSource='llm'` 的工单（本次 ticket LLM 成功写入）
- **语料**：主决策 = LLM `customerRequest` + LLM `painPoint`；问题类型 §3 对端排除扫描 **全文**（受理 + 处理意见，方案 A）
- **尊重** `manualTagFields`；批量重打可勾选「强制覆盖人工内容」
- **设置**：团队共享 `retagDimensionsAfterTicketLlm`（设置 → 维度打标）；批量重打弹窗可单次覆盖

---

## 6. 与 LLM 层协作

| 场景 | P0 输出用途 | 最终字段来源 |
|------|-------------|--------------|
| 无 API Key | 直接写入 record | `customerRequestSource='rule'`，`painPointSource='rule'` |
| 有 API Key | 候选 + `ruleFallback` 传入 LLM | LLM 成功则 `llm`，失败回退 P0 |
| 四维打标 | 初标用受理/追加/处理意见；**ticket LLM 后**（默认）用 LLM 客户请求/痛点重打请求场景与问题类型 | 见 §5.5 Post-LLM 维度重打 |
| **请求场景** | 决策树 + 关键词（`requestSceneClassifier.js`） | **不走 LLM**；与投诉/咨询工单的问题类型一致 |
| **问题类型**（投诉/咨询） | 决策树 + 关键词 | **不走 LLM** |
| **用户旅程** | 本地 + 可选 LLM（`themeMatchMode`） | 设置页「用户旅程匹配方式」 |

**导入 / 批量重新打标**（有 API Key）阶段顺序（默认 `taggingPipelineOrder=ticket_first`）：

1. 规则初标（`analyzeTicket`）— 重置 `*Source` 为 `rule`（「仅未完成 LLM 增强 / 旅程 LLM 增强」范围 **跳过** 此步）
2. 请求场景 / 问题类型（本地，受理/追加/处理意见语料）
3. **客户请求 / 痛点 / 优化**（`ticketLlmMode=unified` 时 **1 次 LLM** + optimization 按需 compact 补打；`separate` 时为三次独立调用）
3b. **请求场景 / 问题类型（LLM 语料重打）** — 默认开；仅步骤 3 成功写入 LLM 字段的工单
4. **用户旅程**（hybrid + `journeyLlmGating=true` 时高置信本地命中可跳过 LLM；记录 `journeySource` / `journeyMatchScore`）
5. 用户情绪（规则，基于 ticket LLM 后的 request/pain）
6. 写库（ticket LLM 批量 **每 4 条** 增量 persist）

`taggingPipelineOrder=legacy` 时步骤 3 与 4 对调（旅程先于 ticket LLM）；步骤 3b 仍在 ticket LLM 之后执行。

**来源字段**（用于反馈库「LLM 打标状态」筛选与导出）：

- `customerRequestSource`、`painPointSource`、`optimizationSource`：`'rule' | 'llm'`
- `journeySource`：`'rule' | 'llm'`（门控跳过时为 `rule`）
- `journeyMatchScore`：本地匹配置信分（关键词 +3）
- 「LLM 已增强」= 上述三项均为 `llm`（优化建议若有人工复核则不计入缺失）
- 识别辅助：`recordNeedsTicketLlmEnrichment()`、`recordNeedsJourneyLlmEnrichment()`（`ticketAnalysisSources.js`）

**批量打标持久化**（2026-06-02）：

- 客户请求/痛点/优化 LLM **每 4 条一批即时 `putRecords`**，额度用尽或页面中断时，已完成批次仍保留
- 任务结束后再全量 `persistRecordUpdates` 一次（旅程/情绪等最终态）
- 单条重新打标仍为「每条完成即写库」

单条流水线（异步）：规则初标 → 客户请求 LLM → 痛点 LLM → `validateTicketAnalysisPair` → 重算情绪 → 优化建议 LLM。

---

## 7. 数据字段

| 字段 | 说明 |
|------|------|
| `customerRequest` | 客户请求内容（规则 ≤120；LLM 精炼 ≤120） |
| `customerRequestSource` | `'rule' \| 'llm'` |
| `painPoint` / `problemSummary` | 需求痛点（规则/LLM，≤80） |
| `painPointSource` | `'rule' \| 'llm'` |
| `optimizationSource` | `'rule' \| 'llm'`（有人工复核优化时 UI 显示「人工复核」） |
| `journeySource` | `'rule' \| 'llm'` |
| `journeyMatchScore` | 本地旅程匹配分（门控阈值默认 ≥3） |

反馈库可筛 **待 LLM 增强** / **待旅程 LLM** / **LLM 已增强**；批量重打可选 **仅未完成 LLM 增强** 或 **仅未完成旅程 LLM 增强**（见 [LLM-TAGGING-P0-UAT.md](./LLM-TAGGING-P0-UAT.md) §4）。

---

## 8. 单元测试

| 文件 | 覆盖点 |
|------|--------|
| `customerRequestExtract.test.js` | 生命周期、append 覆盖首句、模板过滤、120 字截断 |
| `painPointExtract.test.js` | customerRequest 优先于 rootCause、需求改写、80 字上限 |
| `ticketAnalysis.test.js` | `analyzeTicket (P0 rules)` 端到端 |
| `requestSceneClassifier.test.js` | V2.0 §4 golden 10 条 + 默认类 / 互斥边界 |
| `dimensionTagging.test.js` | 请求场景决策树 + 投诉工单不调 LLM + Post-LLM 重打 |
| `v2TicketExamples.test.js` | V2 §1.4 客户请求 + §2.4 痛点 golden（TAG-CR / TAG-PP） |
| `validateTicketAnalysisPair.test.js` | 空值 fallback、引导语拒绝、总长压缩 |

```bash
npm test -- --run src/lib/ticketAnalysis/customerRequestExtract.test.js
npm test -- --run src/lib/ticketAnalysis/painPointExtract.test.js
npm test -- --run src/lib/ticketAnalysis/ticketAnalysis.test.js
npm test -- --run src/lib/requestSceneClassifier.test.js
npm test -- --run src/lib/dimensionTagging.test.js
npm test -- --run src/lib/ticketAnalysis/dimensionTaggingText.test.js
npm test -- --run src/lib/ticketAnalysis/v2TicketExamples.test.js
```

---

## 9. 已知限制与后续

- 规则层不产出 V2 §1.4 式精炼摘要，需配置 LLM API Key。  
- V2 §1.4 / §2.4 示例已纳入 `fixtures/v2TicketExamples.js`（规则层关键词 + LLM golden Jaccard）；规则层痛点仍为片段/截断，精炼摘要依赖 LLM。  
- 「客户提供了 MTR 结果则保留结果描述」暂未单独实现，依赖句内删除 + 候选保留逻辑。  
- **Post-LLM 维度重打**（默认开）：仅当 `customerRequestSource='llm'` 或 `painPointSource='llm'` 时，按 LLM 语料重打请求场景/问题类型；可在设置或批量重打弹窗关闭。单条 `analyzeTicketAsync` 路径仍只做规则初标 + ticket LLM，不自动重打（需批量重打或重新导入增强段）。  
- 历史 V1 请求场景标签需 **批量重新打标**（建议含 ticket LLM）后才会刷新为 V2 决策树结果。

---

## 10. 相关文档

- [从单条工单提取客户请求内容挖掘需求痛点.md](../data/从单条工单提取客户请求内容挖掘需求痛点.md) — 业务规范 V2  
- [请求场景标签体系及打标规则.md](../data/请求场景标签体系及打标规则.md) — 请求场景 V2.0 业务规则  
- [问题类型自动化分类（问题类型分类与判定规则）.md](../data/问题类型自动化分类（问题类型分类与判定规则）.md) — 问题类型 V2.0  
- [LLM-TAGGING-P0-DESIGN.md](./LLM-TAGGING-P0-DESIGN.md) — P0 改造设计  
- [LLM-TAGGING-P0-UAT.md](./LLM-TAGGING-P0-UAT.md) — 发布 / UAT 检查清单  
- [TEST-PLAN.md](./TEST-PLAN.md) — 系统测试计划（含 TAG-RS V2）
