# 行动建议模块 · 完整实现方案（新）

> 2026-09-11 · 基于代码排查 + 历轮对齐编写。本方案以代码为真源。
> 修订记录：2026-09-11 第二轮，确认数据源边界、三方闭环定位、卡片定性概述、概览取数方式、导出格式、TicketStoryView 结构。

---

## 一、目标与数据边界

用新引擎（区分度加权 best-match + 三方闭环）**彻底替换** V2 痛点聚类引擎，覆盖：
- 三个 tab（概览首页 / 投诉 / 咨询）的行动建议展示
- 五个辅助模块的数据适配（快照重建 / 影响聚焦 / 建议反馈 / 导出 / 专题分析桥接）

V2 聚类引擎（`src/lib/painPointClustering/*` + `buildSourcePlanningConclusions` + `buildOverviewConclusions`）整体废弃删除，不留并行。

**数据源边界**（代码确认 `loadTickets.cjs:73` + `buildSourceSnapshot.js:52-65`）：

| 数据源类型 | 进入行动建议引擎 | 用途 |
|---|---|---|
| `complaint_ticket` | 是 | 投诉工单，引擎消费，产出行动建议 |
| `consultation_ticket` | 是 | 咨询工单，引擎消费，产出行动建议 |
| `post_use_rating` | 否 | 用后即评，不进入引擎；仅用于回访满意度指标（`followUpSatisfactionMetrics`），独立于行动建议 |

`post_use_rating` 在快照层有独立处理路径（`buildSourceSnapshot.js:60-63`），走 `buildFollowUpSatisfactionMetrics`，不经过 `buildSourcePlanningConclusions`。新方案保持这个边界不变。

---

## 二、核心改造：离线脚本 -> 在线函数

### 2.1 问题

新引擎当前是**离线脚本**形态（`scripts/validate-action-recs.cjs`）：
- 在脚本顶层直接 `loadTickets()` 读 records -> 全局变量 `d`
- `runPipeline()` 跑分类 -> `analyze()` 分层 -> `emitArtifacts()` 写 `dist/` 文件
- 三方闭环靠 `run-loop.cjs` spawn 独立子进程

V2 引擎当前是**在线内联**形态：
- `buildSourcePlanningConclusions` 在快照重建时被 `buildSourceSnapshot` 直接调用
- 接收 `records`（已限定数据源+周期的 `FeedbackRecord[]`）-> 返回 `OverviewConclusions`
- 无文件 I/O，无子进程

**替换意味着**：新引擎要从"读 records -> 跑分类 -> 写 dist/ 文件"变成"接收 records 数组 -> 跑分类 -> 返回 `ActionRecsResult[]`"，成为快照重建链路中的一个函数调用。

### 2.2 方案：抽取引擎核心为可 require 的模块

**第一步**：把 `validate-action-recs.cjs` 的引擎核心（分类 + 分层 + 分析）抽取为独立模块 `scripts/lib/actionRecsEngine.cjs`：

```
actionRecsEngine.cjs
  ├── classifyScored(rows, tax)     // 已有：区分度加权 best-match
  ├── analyze(rows, tax, T, B, thr, prodName)  // 已有：5 层分层
  ├── mkItem(famName, subName, rs)  // 已有：产出 item
  ├── thresholds(T, B)              // 已有：相对化阈值
  ├── CAUSE_TAX_MAP                 // 已有：curated 分类法
  └── runEngine(records) -> result   // 新增：封装入口函数
```

`runEngine(records)` 干的事：
1. 按产品分组 `records`（替代 `loadTickets()` 的全局 `d`）
2. 对每个产品：算 T/B -> `thresholds()` -> 加载 curated TAX -> `applyOverrides` -> `classifyScored` -> `analyze`
3. 返回 `{ products: [{ p, T, B, thr, items, rowStatus, ... }] }`

**关键**：`runEngine` 不读文件、不写文件、不 spawn 子进程，纯函数接收 records 数组返回结果。

**第二步**：在 `src/snapshots/` 新增 `buildActionRecsConclusions.js`，调用 `runEngine`：

```js
// src/snapshots/buildActionRecsConclusions.js
import { runEngine } from '../../scripts/lib/actionRecsEngine.cjs'
import { toActionRecsResult } from '../lib/actionRecsMapper.js'

export function buildActionRecsConclusions({ period, dataSourceType, records, ... }) {
  const engineResult = runEngine(records)
  const recommendations = engineResult.products.flatMap(p =>
    p.items.map(item => toActionRecsResult(item, p, dataSourceType))
  )
  return { generatedAt, source: 'rule', sampleSize, periodLabel, recommendations, ... }
}
```

**第三步**：`buildSourceSnapshot.js:66` 改调 `buildActionRecsConclusions` 替代 `buildSourcePlanningConclusions`。

### 2.3 三方闭环：在线内联，快照重建时同步执行

三方闭环（Producer / Gate / Fixer）**不是事后行为，而是快照重建流程的有机部分**，与引擎一起在线执行：

**当前问题**：三方闭环是 3 个独立子进程（`run-loop.cjs` spawn），通过 `dist/` 文件交换数据。这种形态无法在快照重建时在线调用。

**改造方案**：把三方闭环从"子进程 + 文件 I/O"重构为"函数调用 + 内存数据传递"：

```
scripts/lib/actionRecsEngine.cjs
  ├── runEngine(records) → result          // 引擎核心（2.2 已述）
  │
  ├── runGate(engineResult, taxMap) → gateReport   // 门禁：接收引擎内存结果，不做文件 I/O
  │     · 独立重算未归类率/待确认率（从 engineResult.rowStatus）
  │     · 独立再分类校验（从 engineResult.products + taxMap）
  │     · 42 项检查（完整性 + 准确性 + 出处标注）
  │     · 返回 { passed, checks, failures, accuracyByProduct }
  │
  ├── runFixer(gateReport, engineResult, taxMap) → { overrides, changelog, applied }
  │     · 接收门禁报告，外科式收紧
  │     · 产出 overrides 增量（内存对象，不写文件）
  │     · 返回 { overrides, changelog, applied: boolean }
  │
  └── runLoop(records, taxMap, opts) → { result, gateReport, finalOverrides, rounds, escalated }
        · 最多 N 轮有界循环（默认 5，可配）
        · 每轮：runEngine → runGate → (PASS 则停 / FAIL 则 runFixer → 重跑)
        · 返回最终引擎结果 + 门禁报告 + 生效 overrides + 轮次信息
```

**快照重建链路**（替换后）：

```
buildActionRecsConclusions({ records, ... })
  → runLoop(records, taxMap, { maxRounds: 5 })
    ├── Round 1: runEngine → runGate
    │   ├── PASS → 直接用 result
    │   └── FAIL → runFixer → 更新内存 overrides → Round 2
    ├── Round 2: runEngine(应用新 overrides) → runGate
    │   ├── PASS → 用 result
    │   └── FAIL → runFixer → ...
    └── ... (最多 5 轮，PASS 即停；未过则标记 escalated)
  → 最终 result.products → mapper → ActionRecsResult[]
  → 快照存储 gateReport 摘要（轮次、通过项数、失败项、是否 escalated）
```

**关键设计**：

1. **内存传递，不写文件**：`runGate` 直接接收 `runEngine` 的返回值（内存对象），不经过 `dist/pipeline-results.json`。`runFixer` 直接接收 `runGate` 的返回值，不经过 `dist/gate-report.json`。

2. **overrides 生命周期**：每轮 Fixer 产出的 overrides 是内存对象，直接传给下一轮的 `runEngine`（通过参数注入，而非文件）。快照重建完成后，最终 overrides 可选择持久化到 `taxonomy-overrides.json`（供下次重建冷启动时预加载）。

3. **有界循环，非无限**：最多 5 轮（可配）。PASS 即停；5 轮未过则标记 `escalated: true`，快照仍写入引擎结果（用最后一轮的 result），但前端展示"待人工复核"提示。

4. **门禁结果随快照存储**：快照新增 `planningConclusions.gateReport` 字段（摘要：轮次、通过/失败项数、是否 escalated、失败项列表），前端可展示质量状态。

5. **三方分离原则不变**：`runEngine` 不做判定（只跑分类产出结果）；`runGate` 不跑分类（只独立校验 `runEngine` 的结果）；`runFixer` 不跑分类不改基线（只读 `runGate` 的失败项 + 证据，产出 overrides 增量）。三者是独立函数，各自不信任对方的自报数。

6. **离线人工模式保留**：原 `run-loop.cjs` 仍可作为独立 CLI 运行（人工触发全量验证），但改为调用 `actionRecsEngine.cjs` 的 `runLoop()` 函数而非 spawn 子进程。两种入口共享同一套逻辑。

**与原离线脚本的关系**：

| 原（子进程 + 文件） | 新（函数 + 内存） |
|---|---|
| `run-loop.cjs` spawn 3 进程 | `runLoop()` 函数内 3 次函数调用 |
| `dist/pipeline-results.json` 传递引擎结果 | 函数返回值传递 |
| `dist/gate-report.json` 传递门禁报告 | 函数返回值传递 |
| `dist/evidence-rows.json` 传递逐工单证据 | `engineResult.rowStatus` 已含 |
| `dist/taxonomy-current.json` 传递当前分类法 | `taxMap` 参数已含 |
| `scripts/taxonomy-overrides.json` 持久化 overrides | 内存传递 + 可选持久化 |
| `docs/变更日志-*.md` 审计日志 | `runFixer` 返回 changelog + 可选写文件 |

### 2.4 快照重建与服务端加锁（行动建议生成在其中的位置）

**当前快照重建链路**（代码已确认 `insightRebuildJob.js` + `snapshotService.js`）：

```
POST /api/storage/insight-rebuild（用户点击"重建洞察"）
  → enqueueInsightRebuild(periodId, username)
    → 查已有活跃 Job（防重复）→ 创建 Job（status=queued）→ 持久化
    → scheduleInsightRebuildRun(jobId)
      → periodChains 串行排队（同周期不并发）
      → runInsightRebuildJob(jobId)
        → status=running → markPeriodSnapshotsRebuilding（所有快照标 rebuilding）
        → storageRepository.listRecords（取全量 records）
        → rebuildAllSnapshots(adapter, period, records, onProgress, settings)
          → 遍历 DATA_SOURCE_TYPES（complaint_ticket / consultation_ticket / post_use_rating）
            → rebuildSourceSnapshot → buildSourceSnapshot
              → buildSourcePlanningConclusions（V2） ← 新方案改为 buildActionRecsConclusions → runLoop
          → rebuildOverviewSnapshot → buildOverviewSnapshot（合并 source 快照）
        → status=succeeded
```

**加锁机制（两层）**：

| 层 | 机制 | 代码位置 | 作用 |
|---|---|---|---|
| 全局互斥 | `backgroundTaskLock` | `server/backgroundTaskLock.js` | 防止导入/重打标/快照重建并发。acquire 时若已有活跃锁且非同用户 → 抛 `BACKGROUND_TASK_CONFLICT`（409） |
| 周期串行 | `periodChains` Map | `server/insightRebuildJob.js:18` | 同一周期的重建 Job 排队串行执行，前一个完成后才跑下一个 |

**新方案对服务端链路的影响**：

| 维度 | 现状（V2） | 新方案（runLoop） | 影响 |
|---|---|---|---|
| 调用位置 | `buildSourceSnapshot` 内调 `buildSourcePlanningConclusions` | 改调 `buildActionRecsConclusions` → `runLoop` | 调用方不变（`buildSourceSnapshot` 内部） |
| 执行轮次 | 1 轮（跑完聚类即出结果） | 1-5 轮（runEngine → runGate → 可能 runFixer → 重跑） | **耗时会显著增加** |
| 加锁 | 已有 backgroundTaskLock + periodChains | **不变**——行动建议生成内嵌在快照重建中，不加额外锁 | 复用现有两层锁 |
| 异步性 | 已是异步 Job（`enqueueInsightRebuild` 立即返回 jobId，后台执行） | 不变 | 前端已有进度轮询 |
| 进度回调 | `onProgress(source, done, total)` | 需扩展——增加"引擎第 N 轮/共 M 轮"子进度 | 避免前端长时间无响应 |
| 超时风险 | 低（V2 一轮就完） | **中高**（5 轮可能跑很久） | 需考虑：轮次上限可配、或首轮结果先落盘后续异步闭环 |

**关键设计决策**：

1. **行动建议生成不加独立锁**——它内嵌在快照重建中，快照重建已有两层锁（backgroundTaskLock + periodChains），不需要再加。

2. **runLoop 轮次上限可配**——`runLoop(records, taxMap, { maxRounds: N })`，默认 5，可在 `AppSettings` 中配。小产品（T 小）可降到 3 轮。

3. **首轮降级策略**（建议）：如果第 1 轮 runGate 就 PASS（常见情况——分类法稳定时大多数一轮就过），直接用，不跑 Fixer。只有 FAIL 才进 Fixer → 重跑。这样大多数快照重建的实际耗时与 V2 接近。

4. **进度反馈增强**——`onProgress` 回调增加引擎轮次信息：`{ stage: 'engine-round-1/5', done, total }`，前端可展示"引擎第 N 轮校验中"。

5. **Job 超时处理**——`runInsightRebuildJob` 的 try-catch 已覆盖失败场景（status=failed + errorSummary）。runLoop 5 轮未过标记 `escalated: true`，不是 Job 失败——快照仍写入最后一轮结果，前端展示"待人工复核"。

### 2.4 数据契约：`ActionRecsResult`

在 `src/domain/overviewConclusions.js` 的 `OverviewRecommendation` 上扩展字段（不破坏旧字段，保证兼容）：

```ts
interface ActionRecsResult extends OverviewRecommendation {
  // 新增：5 层信号分层
  tier: 'structural' | 'change' | 'sharp' | 'iteration' | 'tail'
  // 新增：规模情况（来自 mkItem 的 n/c/q/u/cr/mom/dAbs）
  scale: {
    ticketCount: number        // N 单
    complaintCount: number     // 投诉工单数 c（mkItem.c）
    consultationCount: number  // 咨询工单数 q（mkItem.q）
    complaintRate: number      // 投诉率 cr（c/n*100）
    urgentRate: number         // 加急率（u/n*100）
    moMPct?: number            // 环比 %（mkItem.mom）
    moMAbs?: number            // 环比绝对（mkItem.dAbs）
  }
  // 新增：问题概述（定性描述，补充定量统计，避免空洞）
  problemSummary: {
    pain: string              // 需求痛点 topSentence（mkItem.pain）
    root: string              // 问题原因 topSentence（mkItem.root）
  }
  // 新增：建议文本（来自 mkItem.recText = curated JSON 的 family/sub rec 字段）
  recommendation: string
  // 新增：真声+摘要（来自 mkItem.voice/pain/root，严格字段出处标注）
  customerVoice: {
    verbatim: string           // 客户原声（voiceOf：客户请求内容/受理内容/处理意见）
    painText: string           // [痛点摘要] = pain(topSentence 需求痛点)
    rootText: string           // [复核根因] = root(topSentence 问题原因)
  }
  // 新增：候选动作（来自 mkItem.mat，topK 产品技术优化，仅作收敛参考）
  actionsLayerA: { text: string; freq: number }[]
  // 新增：举措库 inventory 状态
  inventoryStatus: 'open' | 'done' | 'stopped' | 'none'
  // 保留兼容字段：
  // id / stableKey / priority / summary / scope / evidenceTicketIds / signalType / periodCompare
}
```

**`id` / `stableKey` 生成**：由 `actionRecsMapper.js` 在映射时生成，格式为 `product + fam + sub` 的哈希，与 V2 的 `stableKey` 体系不同（接受旧反馈断链，新周期建立新反馈）。

**`problemSummary` 具体方案 — 纯动态生成，pain + root 双字段并列**：

问题概述从本期工单的实际内容动态生成，不使用 curated JSON 的静态文案。包含两个字段，分别来自工单的不同字段，互为补充：

```
problemSummary 取值逻辑（actionRecsMapper.js 中实现）：

problemSummary.pain = mkItem.pain = topSentence(rows, '需求痛点')
  → 来源：validate-action-recs.cjs L1556，该组工单中"需求痛点"字段频次最高的首句
  → 反映客户表达的具体痛点和需求
  → 示例："专线丢包严重，业务受到影响"

problemSummary.root = mkItem.root = topSentence(rows, '问题原因')
  → 来源：validate-action-recs.cjs L1557，该组工单中"问题原因"字段频次最高的首句
  → 反映排查后的根因描述
  → 示例："跨网互联节点带宽不足导致丢包"

两个字段独立取值，各自可能为空（该组工单未填对应字段时留空）。
```

**为什么 pain 和 root 都需要**：
- `pain`（需求痛点）= 客户视角的痛点和需求，偏"客户感受到了什么"
- `root`（问题原因）= 排查后的根因，偏"为什么会这样"
- 两者视角不同，互为补充，只展示一个会丢失信息

**为什么不加静态字段**：
- 静态文案每次出现都一样，不反映本期工单的具体变化
- 动态从工单生成，直接反映客户本期实际反馈内容，信息量更高
- `mkItem.pain` 和 `mkItem.root` 已在引擎中产出，mapper 直接取值即可，无需改 curated JSON

**与 `customerVoice` 的关系**：
- `problemSummary.pain` / `problemSummary.root` = 卡片正文中展示的定性概述（简洁，一句话）
- `customerVoice.painText` / `customerVoice.rootText` = 详情抽屉中展示的带字段出处的完整摘要
- 数据源相同（都是 `mkItem.pain` / `mkItem.root`），但展示位置和标注方式不同
- 卡片用概述（定性，补充定量统计），抽屉用带字段出处的完整摘要 + 客户原声

**`recText` → `recommendation` 映射**：curated JSON 中 `family.rec` / `sub.rec` 在 `analyze()` L1626-1630 已挂接到 `it.recText`。mapper 直接取 `it.recText` 映射为 `recommendation`。若 `recText` 为空（非 curated 产品），`recommendation` 留空，前端展示"待人工收敛"。

### 2.5 引擎产物 -> ActionRecsResult 映射

`src/lib/actionRecsMapper.js` 负责把 `mkItem` 产出的 item 映射为 `ActionRecsResult`：

| mkItem / curated JSON 字段 | ActionRecsResult 字段 |
|---|---|
| `fam` + `sub` | `summary`（标题：L1家族 - L2子议题）/ `scope.product` |
| `tier` | `tier` |
| `n` | `scale.ticketCount` |
| `c` | `scale.complaintCount` |
| `q` | `scale.consultationCount` |
| `cr` | `scale.complaintRate` |
| `u` -> `u/n*100` | `scale.urgentRate` |
| `mom` | `scale.moMPct` |
| `dAbs` | `scale.moMAbs` |
| `mkItem.pain`（topSentence 需求痛点）| `problemSummary.pain`（定性概述·客户视角） |
| `mkItem.root`（topSentence 问题原因）| `problemSummary.root`（定性概述·根因视角） |
| curated JSON `sub.rec` / `family.rec` -> `mkItem.recText` | `recommendation`（建议文本） |
| `voice` | `customerVoice.verbatim`（voiceOf 的返回） |
| `pain` | `customerVoice.painText`（[痛点摘要]，与 problemSummary.pain 同源） |
| `root` | `customerVoice.rootText`（[复核根因]，与 problemSummary.root 同源） |
| `mat` | `actionsLayerA`（topK 产品技术优化，freq=count） |
| 工单号列表 | `evidenceTicketIds` |

---

## 三、概览快照：去掉跨源融合

### 3.1 当前 V2 做法

V2 为投诉/咨询各跑一遍聚类（`buildSourcePlanningConclusions`），再在概览层融合（`buildOverviewConclusions` -> `buildOverviewFusedRecommendations`，以 `fingerprintV2` 合并投诉+咨询同类群组，跨源加 0.45 分）。

### 3.2 新引擎做法

新引擎的 `runEngine` 接收 records 时已经包含投诉+咨询全量数据（`mkItem` 内部按 `_src` 字段拆分 c/q）。**不需要额外跨源融合步骤**——概览快照直接取全量结果，投诉/咨询 tab 按 `scale.complaintCount > 0` / `scale.consultationCount > 0` 过滤。

**影响**：`buildOverviewConclusions`（概览跨源融合）废弃删除，`src/lib/painPointClustering/overviewClusterFusion.js` 废弃。

### 3.3 快照链路（替换后）

**已确认：概览快照取数方式 = 选项 A（从 source 快照合并 recommendations）**

```
快照重建（rebuildSourceSnapshot，投诉/咨询各一次）：
  records(本源+周期) -> runEngine -> ActionRecsResult[]
    -> snapshot.aggregates.planningConclusions.recommendations

快照重建（rebuildOverviewSnapshot，概览）：
  选项 A：直接从 sourceSnapshots 合并 recommendations（不重跑 runEngine）
  → 概览 conclusions.recommendations = 投诉source recs + 咨询source recs 合并
```

**环比**：`snapshotService.js` 读取上一周期 `planningConclusions.recommendations` 作为 `previousRecommendations`，按 `stableKey` 匹配——路径和字段名不变。

---

## 四、三 tab 呈现替换

### 4.1 TicketStoryView 结构说明

`TicketStoryView` 是投诉/咨询 tab 的**主内容渲染组件**，被 `TicketDashboardView.jsx:232` 挂载。它渲染 7 个区块：

| 区块 | 内容 | 替换关系 |
|---|---|---|
| 综合结论 | 4 张结论卡片 | 保留 |
| 规模与体验现状 | 工单量/负向/万投比/紧急等指标卡 + 产品总览表 | 保留 |
| 趋势与变化 | 工单量趋势图 + 万投比/负向占比趋势图 | 保留 |
| 问题发生位置 | 用户旅程图（TicketJourneyMap） | 保留 |
| **原因与用户需求** | **V2 痛点聚类表 + 小样本参考项** | **替换为 ActionRecsPanel** |
| 影响与证据 | 重点关注 + 主题证据表 | 保留 |
| **行动与效果验证** | **问题与行动表（含创建举措按钮）+ 效果验证表** | **保留，数据源改为消费 ActionRecsResult** |

**关键**：只替换"原因与用户需求"区块的聚类表部分，其他 6 个区块全部保留。"行动与效果验证"区块保留，但其"问题与行动表"的数据源从 V2 recommendations 改为消费 ActionRecsResult 卡片数据。

### 4.2 组件树

```
src/components/workbench/
  ActionRecsPanel.jsx              // 分层容器（替代 PlanningRecommendationsPanel / TicketStoryView 中 V2 聚类表区块）
    ├── ActionTierSection.jsx      // 单层（标题 + 卡片列表，可折叠）
    │   └── ProblemCard.jsx       // 单卡（问题概述/规模/建议/纳入优化徽章）
    ├── ProblemDetailDrawer.jsx   // 详情抽屉（关联举措 + 涉及工单 + 真声摘要）
    └── ActionRecsToolbar.jsx     // 筛选（产品）/ 导出（MD/Excel）
  ActionEffectTable.jsx            // 效果验证表（投诉/咨询 tab 专用，保留现有功能）
src/lib/
  useActionRecommendations.js      // 数据 hook：取 recs + 解析 ActionItem 状态 + 工单
  actionReportMd.js                // 结构化 recs -> MD 渲染器
  actionReportExcel.js             // 结构化 recs -> Excel 导出
  actionRecsInventory.js           // 举措库 inventory 查询（复用 topicAnalysis collectEvidence）
  actionRecsMapper.js              // 引擎产物 -> ActionRecsResult 映射
```

### 4.3 三 tab 差异

| tab | 数据来源 | 数据过滤 | 额外功能 |
|---|---|---|---|
| 概览首页 | `snapshot.conclusions.recommendations` | 全量（c + q） | 导出（MD/Excel） |
| 投诉 tab | `snapshot.aggregates.planningConclusions.recommendations` | `scale.complaintCount > 0` | 创建举措按钮 + 效果验证表 |
| 咨询 tab | 同上 | `scale.consultationCount > 0` | 创建举措按钮 + 效果验证表 |

`ActionRecsPanel` 接收 `sourceFilter` prop（`'all' | 'complaint_ticket' | 'consultation_ticket'`），内部按 `scale.complaintCount`/`scale.consultationCount` 过滤卡片。投诉/咨询 tab 在卡片列表下方渲染 `<ActionEffectTable>`。

### 4.4 挂载替换

| 当前 | 替换后 |
|---|---|
| `OverviewTab.jsx:140` `<PlanningRecommendationsPanel>` | `<ActionRecsPanel sourceFilter="all" />` |
| `TicketStoryView.jsx` 中"原因与用户需求"区块（V2 聚类表 + 小样本参考项） | `<ActionRecsPanel sourceFilter={sourceType} />` |

**注意**：`TicketStoryView` 的其他 6 个区块（综合结论/规模现状/趋势/旅程/影响证据/行动验证）全部保留不动。`TicketDashboardView.jsx` 调 `buildTicketStoryModel` 的逻辑需调整——`recommendations` 参数改为传 `ActionRecsResult[]`，`buildTicketStoryModel` 内部消费 recommendations 的部分适配新字段。

### 4.5 卡片四要素（沿用已拍板决策 + 新增定性概述）

每张 `ProblemCard` 展示：

1. **标题**：`L1家族 - L2子议题`（item.fam + item.sub）
2. **问题概述**（定性，新增）：`problemSummary`——两行并列：
   - [痛点] `problemSummary.pain`（需求痛点 topSentence，客户视角的痛点）
   - [根因] `problemSummary.root`（问题原因 topSentence，排查后的根因）
   - 两个字段独立取值，各自可能为空；纯动态生成，反映本期工单实际反馈
3. **规模情况**（定量）：N 单 / 环比 +-X% / 投诉率 Y%（c 投诉 / q 咨询）/ 加急率 Z%
4. **建议**：一条清晰动作（`recommendation`，来自 curated JSON 的 `rec` 字段）
5. **纳入优化徽章**：
   - `已纳入 - 进行中` -> 蓝/黄（inventoryStatus='open'）
   - `已纳入 - 已完成` -> 绿（inventoryStatus='done'，done != 已根治，需效果验证）
   - `未纳入 - 盲区` -> 红（inventoryStatus='none'）

### 4.6 详情抽屉

- **定性描述**：与卡片一致的双字段，但带完整字段出处标注
  - [痛点摘要] = `需求痛点`字段（`customerVoice.painText`，来自 `mkItem.pain`）
  - [复核根因] = `问题原因`字段（`customerVoice.rootText`，来自 `mkItem.root`）
  - 两者独立展示，各自可能为空
- **客户原声**：`customerVoice.verbatim`（voiceOf 的返回，来自 `客户请求内容` / `受理内容` / `处理意见`）
  - 严格标注原声来源字段
- **关联举措**：层B（`ActionItem` 经 `requirementTicketProgress` -> `derivedStatus`）+ 层A（`actionsLayerA` 候选动作）
- **涉及工单表**：按投诉/咨询筛选（`evidenceTicketIds` -> 工单解析），支持「全部/仅投诉/仅咨询」切换

---

## 五、辅助模块改造

### 5.1 快照重建服务 `snapshotService.js`

| 当前 | 改造后 |
|---|---|
| `buildSourcePlanningConclusions` 生成 V2 recommendations | 改调 `buildActionRecsConclusions`（调 `runLoop`，含三方闭环在线执行） |
| `previousRecommendations` 读取 `.planningConclusions.recommendations` | 路径不变（字段名 `planningConclusions` 保持兼容） |
| `buildImpactFocusSummaries({ recommendations })` | 适配新字段（`tier`/`scale` 替代 `signalType`/`priority`） |
| `existingOverview?.conclusions?.recommendationsLlm` 保留 | 移除（新引擎不使用 LLM 润色） |
| 无门禁报告 | 快照新增 `planningConclusions.gateReport`（摘要：轮次、通过/失败项数、是否 escalated） |

### 5.2 影响聚焦引擎 `lib/ticketImpactFocus.js`

当前接收 `OverviewRecommendation[]` 构建 `themeIdOf` / `buildImpactThemeLink` / `collectThemeRecommendations` / `resolveClusterTicketIds`。

改造：适配 `ActionRecsResult` 新字段——用 `tier` + `scope.product` 替代 `signalType` + `priority` 做主题分组。函数签名不变，内部逻辑调整。

### 5.3 LLM 润色：移除

新引擎产物质量由三方闭环保证（Gate 42 项检查含全量准确性校验），**不需要 LLM 二次润色**。

删除/废弃：
- `src/lib/overviewConclusionsLLM.js`
- `InsightsContext.jsx` 中 `polishPlanningRecommendationsWithLLM` 调用
- `snapshotService.js` 中 `recommendationsLlm` 保留逻辑

### 5.4 建议反馈：接受断链

反馈绑定在 `recommendation id` 上。新引擎的 `id` 体系（`product + fam + sub` 哈希）与 V2 的 `stableKey`（`product + 类名 + problemType` 哈希）不同——**旧反馈数据将失去关联**。

处理：接受断链，新周期建立新反馈。`planningRecommendationFeedback.js` 改造为消费新 `id` 体系，旧 KV 数据（`recommendation_feedback_v1`）保留但不再关联。

### 5.5 导出：保留，格式可选 MD 或 Excel

**已确认：xlsx 导出保留，支持格式选择。**

- `planningRecommendationsExport.js` 改造为消费 `ActionRecsResult` 新字段
- 新增 `actionReportMd.js`（MD 渲染器，展示与导出共用数据模型）
- 新增 `actionReportExcel.js`（Excel 导出，复用原有 xlsx 导出逻辑但适配新数据契约）
- `ActionRecsToolbar` 提供格式选择：MD / Excel

### 5.6 专题分析（仅验证不断裂）

专题分析通过 `sourceRecommendationId === rec.id` 反向关联概览建议。新引擎 `id` 体系变了，旧关联会断——但专题分析有自己的 `analysis.recommendations`（LLM 建议），不依赖概览 recommendations 数据本身，只是失去反向关联。新周期后桥接自然恢复。

---

## 六、举措库 inventory 去重护栏

在 `buildActionRecsConclusions` 中接入（方案定稿 10 待办5）：

```js
// buildActionRecsConclusions 内，对每个 ActionRecsResult 查举措库关联
const inventory = await collectEvidence({
  productId: rec.scope.product,
  painKey: rec.stableKey,
  actionItemRepository,
  requirementTicketProgress,
})

if (inventory.open.length > 0) {
  rec.inventoryStatus = 'open'  // 已确立 - 先跟进效果验证 / 避免重复立项
} else if (inventory.done.length > 0) {
  rec.inventoryStatus = 'done'  // 已落地 - 待效果验证（!= 已根治）
} else if (inventory.stopped.length > 0) {
  rec.inventoryStatus = 'stopped'  // 已停摆 - 升级换方向
} else {
  rec.inventoryStatus = 'none'  // 无关联举措 -> 纳入新优化建议
}
```

**口径对齐**（已拍板）：
- `done` 只证明动作落地，**不等于已根治**。根治需效果验证/复发观测信号。
- 工单 `确立举措` 字段仅作"动作已落地"逐单佐证，不是权威来源。
- 权威来源 = 举措库关联（带状态的 action item 仓储）。

---

## 七、阈值与 5 层分层（沿用已验证基线）

```
H(高害门槛) = min(100, max(17, round(1.5 * B)))  // 小而锐
S(结构性门槛) = max(10, round(0.10 * T))            // 长期结构性
L(长尾门槛) = max(3, min(10, round(0.01 * T)))     // 常规迭代池 vs 长尾
delta(异动绝对阈值) = clamp(round(0.05 * T), 3, 12)  // 本月异动双判据
```

| 层 | 判定条件（代码 analyze() L1617-1622） |
|---|---|
| Tier 1 长期结构性 | `n >= thr.S` |
| Tier 2 本月异动 | `mom !== null && abs(mom) >= 50 && abs(dAbs) >= thr.delta` |
| Tier 3 小而锐 | `cr >= thr.H && n >= 3`（且未入 structural/change） |
| Tier 4 常规迭代池 | `n >= thr.L`（且未入 structural/change/sharp） |
| Tier 5 长尾 | 其余 |

---

## 八、废弃清单

替换完成后删除/标记 deprecated：

| 文件 | 状态 |
|---|---|
| `src/components/workbench/PlanningRecommendationsPanel.jsx` | 删除 |
| `src/components/workbench/PlanningRecommendationSectionsView.jsx` | 删除 |
| `src/components/workbench/PlanningRecommendationsHelpModal.jsx` | 删除 |
| `src/lib/planningRecommendations.js` 中 `buildPlanningRecommendations` 死代码 | 删除 |
| `src/lib/planningRecommendationSections.js` | 删除 |
| `src/lib/painPointClustering/*` V2 聚类引擎 | 删除 |
| `src/lib/painPointClustering/overviewClusterFusion.js` | 删除（跨源融合废弃） |
| `src/snapshots/buildSourcePlanningConclusions.js` | 删除 |
| `src/snapshots/buildOverviewConclusions.js` | 删除（跨源融合废弃） |
| `src/lib/overviewConclusionsLLM.js` | 删除 |
| `src/lib/rehydrateOverviewRecommendations.js` | 删除（新引擎不需 rehydrate） |
| `src/lib/report/buildReportModel.js` + `resolveOverviewRecommendationsForReport.js` | 删除（疑似死代码） |

**保留改造**：
- `src/domain/overviewConclusions.js` — 类型定义扩展
- `src/lib/ticketImpactFocus.js` — 适配新字段
- `src/lib/planningRecommendationFeedback.js` — 适配新 id 体系
- `src/lib/planningRecommendationCompare.js` — 环比逻辑改造
- `src/lib/planningRecommendationsExport.js` — 适配新数据契约（Excel 导出保留）
- `src/components/workbench/TicketStoryView.jsx` — 保留 6 个非聚类区块，聚类表区块替换为 ActionRecsPanel
- `src/lib/ticketStoryModel.js` — 适配 recommendations 参数为 ActionRecsResult[]
- `src/snapshots/snapshotService.js` — 改调用方

**不变**：
- `src/domain/actionItem.js` + `requirementTicketProgress.js` — 举措域不变
- `server/routes/storage.js` — 快照 API 不变（recommendations 随快照 blob 下发）
- `server/actionItemRepository.js` — 举措仓储不变

---

## 九、实施路径

### P0：引擎模块化 + 三方闭环在线化 + 数据契约（后端）
1. 从 `validate-action-recs.cjs` 抽取 `scripts/lib/actionRecsEngine.cjs`：
   - `runEngine(records) -> result`（纯函数，引擎核心）
   - `runGate(engineResult, taxMap) -> gateReport`（门禁：内存校验，不读文件）
   - `runFixer(gateReport, engineResult, taxMap) -> { overrides, changelog, applied }`（修复：内存传递）
   - `runLoop(records, taxMap, opts) -> { result, gateReport, finalOverrides, rounds, escalated }`（有界闭环）
2. 在 `overviewConclusions.js` 扩展 `ActionRecsResult` 类型定义（含 `problemSummary` 字段）
3. 新增 `src/lib/actionRecsMapper.js`（引擎 item -> `ActionRecsResult`，含 problemSummary 三层回退逻辑）
4. 新增 `src/snapshots/buildActionRecsConclusions.js`（调 `runLoop` + mapper + inventory）
5. 改 `buildSourceSnapshot.js` 调新函数
6. 改 `snapshotService.js`：source 快照调新函数、概览快照改为合并 source 快照 recommendations（选项 A，不再跑融合）、快照新增 `planningConclusions.gateReport`
7. 改造原 `run-loop.cjs` 为调用 `runLoop()` 函数（保留 CLI 入口，不再 spawn 子进程）
8. 验证：快照重建产出新结构数据 + 门禁报告

### P1：举措库 inventory 接入
1. 新增 `src/lib/actionRecsInventory.js`，复用 `topicAnalysis/collectEvidence.js`
2. 在 `buildActionRecsConclusions` 中调用，填 `inventoryStatus`
3. 验证：每条 rec 有 inventoryStatus，口径与 topicAnalysis 一致

### P2：前端组件（三 tab 共用）
1. 新增 `ActionRecsPanel` + `ActionTierSection` + `ProblemCard` + `ProblemDetailDrawer` + `ActionRecsToolbar`
2. 新增 `useActionRecommendations.js` 数据 hook
3. 新增 `actionReportMd.js` MD 导出 + `actionReportExcel.js` Excel 导出
4. 替换 `OverviewTab.jsx` 挂载
5. 替换 `TicketStoryView.jsx` 中"原因与用户需求"区块（保留其他 6 个区块）
6. 改 `ticketStoryModel.js` 适配 recommendations 参数为 ActionRecsResult[]
7. 新增 `ActionEffectTable.jsx`（投诉/咨询 tab 效果验证表）
8. 验证：三 tab 均展示 5 层卡片，抽屉可用，MD/Excel 导出可用

### P3：辅助模块适配
1. 改 `ticketImpactFocus.js` 适配新字段
2. 改 `planningRecommendationCompare.js` 环比逻辑（按新 stableKey）
3. 改 `planningRecommendationFeedback.js` 适配新 id 体系
4. 改 `planningRecommendationsExport.js` 适配新数据契约
5. 验证专题分析桥接（新周期后自然恢复）

### P4：废弃清理
1. 删除废弃组件/文件（见第八节）
2. 更新测试
3. 全量自测

---

## 十、已确认决策（本轮对齐）

| # | 问题 | 决策 |
|---|---|---|
| 1 | 用后即评数据是否进入引擎 | **不进入**。`post_use_rating` 走独立路径（`followUpSatisfactionMetrics`），与行动建议引擎无关。代码已确认。 |
| 2 | 三方闭环定位 | **在线内联，快照重建时同步执行**。从子进程+文件 I/O 重构为函数调用+内存传递，成为快照重建流程的有机部分。门禁报告随快照存储。 |
| 3 | 卡片需补充定性概述 | **新增 `problemSummary` 字段，纯动态生成**。来源 = `mkItem.pain`（topSentence 需求痛点），不用 curated JSON 静态文案。卡片从"三要素"升级为"四要素"（标题/问题概述/规模情况/建议+徽章）。 |
| 4 | 概览快照取数方式 | **选项 A**：从 source 快照合并 recommendations，概览不重跑 `runEngine`。 |
| 5 | xlsx 导出是否保留 | **保留，格式可选 MD 或 Excel**。`ActionRecsToolbar` 提供格式选择。 |
| 6 | TicketStoryView 是什么 | 投诉/咨询 tab 的**主内容渲染组件**（7 个区块）。只替换"原因与用户需求"区块的聚类表部分，其他 6 个区块保留。 |
| 7 | problemSummary 用静态还是动态 | **纯动态生成**，pain + root 双字段并列。`problemSummary.pain` = `mkItem.pain`（需求痛点 topSentence），`problemSummary.root` = `mkItem.root`（问题原因 topSentence）。两个视角互为补充。不用 curated JSON 静态文案。 |
| 8 | 行动建议生成与快照重建的关系 | **内嵌在快照重建中**，不加独立锁。复用现有两层锁（`backgroundTaskLock` 全局互斥 + `periodChains` 周期串行）。`runLoop` 轮次上限可配，首轮 PASS 即停（常见情况），耗时不显著增加。 |
