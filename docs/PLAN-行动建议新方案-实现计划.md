# 行动建议新方案 · 实现计划

> 2026-09-11 · 基于方案文档 `DESIGN-行动建议新方案-完整实现.md` 拆解

---

## 总览

| 阶段 | 名称 | 目标 | 关键产物 |
|---|---|---|---|
| P0 | 引擎模块化 + 三方闭环在线化 | 引擎从离线脚本变成可 require 的纯函数 | `actionRecsEngine.cjs` |
| P1 | 数据契约 + 快照接入 | 新引擎接入快照重建链路，产出新结构数据 | `buildActionRecsConclusions.js` |
| P2 | 举措库 inventory 接入 | 每条建议关联举措状态 | `actionRecsInventory.js` |
| P3 | 前端组件（三 tab 共用） | 用户可见 5 层卡片 + 抽屉 + 导出 | `ActionRecsPanel.jsx` 等 |
| P4 | 辅助模块适配 | 环比/反馈/影响聚焦/导出适配新字段 | 改造现有文件 |
| P5 | 废弃清理 | 删旧代码 + 测试更新 | |

---

## P0：引擎模块化 + 三方闭环在线化

### P0-1：抽取引擎核心为 `scripts/lib/actionRecsEngine.cjs`

**做什么**：把 `validate-action-recs.cjs` 中的引擎核心函数抽到独立模块，暴露纯函数接口。

**从 `validate-action-recs.cjs` 抽出的函数**（行号为当前代码位置）：

| 函数 | 当前行号 | 职责 | 抽出后改造 |
|---|---|---|---|
| `get(r, f)` | L21 | 取字段 | 原样移出 |
| `monthOf(r)` | L22 | 月份提取 | 原样移出 |
| `firstSentence(s)` | L29 | 首句提取 | 原样移出 |
| `cleanFlowNoise(s)` | L36 | 流转噪声清洗 | 原样移出 |
| `voiceOf(r)` | L41 | 真声提取 | 原样移出 |
| `cleanReason(s)` | L60 | 问题原因清洗 | 原样移出 |
| `isBoilerplateReason(r)` | L71 | 样板根因判定 | 原样移出 |
| `topSentence(rows, field)` | L75 | 频次最高首句 | 原样移出 |
| `topK(rows, field, k)` | L79 | 频次 TopK | 原样移出 |
| `TAX` / `EIP_CAUSE_TAX` / `DC_CAUSE_TAX` / `VPC_CAUSE_TAX` / `ELB_CAUSE_TAX` / `CAUSE_TAX_MAP` | L90-628 | 分类法基线 | 原样移出 |
| `loadOverrides()` | L631 | 读 overrides | 改为参数注入，不直接读文件 |
| `applyOverrides(tax, ov)` | L635 | 应用增量 | 原样移出 |
| NLP 辅助函数（`cueWeight` ~ `finalizeName`） | L706-990 | 自动细分 | 原样移出 |
| `autoSplit(...)` | L991 | 自动细分 | 原样移出 |
| `classify(rows, tax)` | L1241 | 正则分类（旧模式） | 原样移出 |
| `classifyScored(rows, tax)` | L1485 | 区分度加权分类 | 原样移出 |
| `mkItem(famName, subName, rs, autoInfo, crossCut)` | L1541 | 产出 item | 原样移出 |
| `analyze(rows, tax, T, B, thr, prodName)` | L1563 | 5 层分层 | 原样移出 |
| `thresholds(T, B)` | L1639 | 相对化阈值 | 原样移出 |
| `deriveDraftTax(p, rows)` | 搜索确认 | 派生草稿分类法 | 原样移出 |

**新增函数**：

```js
// scripts/lib/actionRecsEngine.cjs

/**
 * 引擎入口：接收 records 数组，返回分类结果。纯函数，不读文件不写文件。
 * @param {object[]} records - 工单记录数组（已含 _src 字段）
 * @param {object} [opts] - 可选配置
 * @param {object} [opts.taxMap] - 自定义分类法（默认用内置 CAUSE_TAX_MAP）
 * @param {object} [opts.overrides] - overrides 增量（默认空）
 * @param {string} [opts.productScope] - 产品范围（默认只跑 curated 产品）
 * @returns {{ summary: ProductResult[], allProposals: object[] }}
 */
function runEngine(records, opts = {}) {
  const taxMap = opts.taxMap || CAUSE_TAX_MAP;
  const OV = opts.overrides || {};
  // 按 runPipeline L1761-1794 的逻辑，改为接收 records 而非全局 d
  // 返回 { summary, allProposals } —— summary 每项含 items/rowStatus/thr 等
}

/**
 * 门禁：接收引擎内存结果，独立重算+42项检查。不读文件。
 * @param {object} engineResult - runEngine 的返回值
 * @param {object} taxMap - 分类法（用于独立再分类校验）
 * @returns {{ passed: boolean, checks: object[], failures: string[], accuracyByProduct: object }}
 */
function runGate(engineResult, taxMap) {
  // 从 gate-check.cjs L78 main() 抽取核心逻辑：
  //   - 读 engineResult.summary 而非 dist/pipeline-results.json
  //   - 独立重算未归类率/待确认率
  //   - 独立再分类校验（用 famMatchers 对比）
  //   - 42 项检查（完整性 + 准确性 + 出处标注）
}

/**
 * 修复器：接收门禁报告，外科式收紧。不读文件。
 * @param {object} gateReport - runGate 的返回值
 * @param {object} engineResult - 引擎结果（含 rowStatus 证据）
 * @param {object} taxMap - 当前分类法
 * @returns {{ overrides: object, changelog: object[], applied: boolean }}
 */
function runFixer(gateReport, engineResult, taxMap) {
  // 从 fix-classification.cjs L122 main() 抽取核心逻辑：
  //   - 读 gateReport.failures 而非 dist/gate-report.json
  //   - 读 engineResult.summary[].rowStatus 而非 dist/evidence-rows.json
  //   - 产出 overrides 增量（内存对象）+ changelog
}

/**
 * 有界闭环：runEngine → runGate → (FAIL → runFixer → 重跑) → 最多 N 轮
 * @param {object[]} records
 * @param {object} taxMap
 * @param {object} [opts] - { maxRounds: 5, initialOverrides: {} }
 * @returns {{ result, gateReport, finalOverrides, rounds, escalated }}
 */
function runLoop(records, taxMap, opts = {}) {
  const maxRounds = opts.maxRounds || 5;
  let overrides = opts.initialOverrides || {};
  let result, gateReport;
  for (let round = 1; round <= maxRounds; round++) {
    result = runEngine(records, { ...opts, overrides });
    gateReport = runGate(result, taxMap);
    if (gateReport.passed) return { result, gateReport, finalOverrides: overrides, rounds: round, escalated: false };
    const fixResult = runFixer(gateReport, result, taxMap);
    if (!fixResult.applied) break;  // Fixer 无可修 → 不再重跑
    overrides = mergeOverrides(overrides, fixResult.overrides);
  }
  return { result, gateReport, finalOverrides: overrides, rounds: maxRounds, escalated: true };
}

module.exports = { runEngine, runGate, runFixer, runLoop, /* + 所有抽出的函数 */ };
```

**对 `validate-action-recs.cjs` 的改造**：
- 删除被抽出的函数体（改为 `require('./lib/actionRecsEngine.cjs')`）
- `runPipeline()` 改为调 `runEngine(d, { taxMap })`
- `emitArtifacts()` 保留（仍写 dist/ 文件，供 CLI 模式查看）
- 文件顶层的 `loadTickets()` 全局 `d` 改为模块内局部变量

**对 `gate-check.cjs` 的改造**：
- `main()` 中的文件读取部分（`readJSON(dist/pipeline-results.json)`）改为接收参数
- 核心校验逻辑抽到 `runGate()` 函数（放 `actionRecsEngine.cjs`）
- `main()` 保留为 CLI 入口，但调 `runGate()` 函数

**对 `fix-classification.cjs` 的改造**：
- `main()` 中的文件读取部分改为接收参数
- 核心修复逻辑抽到 `runFixer()` 函数（放 `actionRecsEngine.cjs`）
- `main()` 保留为 CLI 入口

**对 `run-loop.cjs` 的改造**：
- spawn 子进程逻辑改为调 `runLoop()` 函数
- 保留 CLI 入口（`node scripts/run-loop.cjs` 仍可运行）

**验收标准**：
- [ ] `require('./scripts/lib/actionRecsEngine.cjs')` 可被 `src/` 代码导入
- [ ] `runEngine(records)` 返回与原 `runPipeline()` 相同结构的 `summary`
- [ ] `runGate(result)` 返回与原 `gate-check.cjs` 相同的检查结果
- [ ] `runFixer(gateReport, result)` 返回与原 `fix-classification.cjs` 相同的 overrides
- [ ] `runLoop(records, taxMap)` 能在有界轮次内 PASS 或 escalate
- [ ] CLI 模式 `node scripts/run-loop.cjs` 仍正常工作

**涉及文件**：
- 新增：`scripts/lib/actionRecsEngine.cjs`
- 改造：`scripts/validate-action-recs.cjs`、`scripts/gate-check.cjs`、`scripts/fix-classification.cjs`、`scripts/run-loop.cjs`

---

### P0-2：扩展类型定义

**做什么**：在 `src/domain/overviewConclusions.js` 中扩展 `ActionRecsResult` 类型。

**具体改动**：在现有 `OverviewRecommendation` JSDoc 类型上新增字段：
- `tier`：`'structural' | 'change' | 'sharp' | 'iteration' | 'tail'`
- `scale`：`{ ticketCount, complaintCount, consultationCount, complaintRate, urgentRate, moMPct?, moMAbs? }`
- `problemSummary`：`{ pain: string, root: string }`
- `recommendation`：`string`
- `customerVoice`：`{ verbatim: string, painText: string, rootText: string }`
- `actionsLayerA`：`{ text: string, freq: number }[]`
- `inventoryStatus`：`'open' | 'done' | 'stopped' | 'none'`
- `gateReport`（快照级，非单条）：`{ rounds, passed, failures, escalated }`

**涉及文件**：
- 改造：`src/domain/overviewConclusions.js`

**验收标准**：
- [ ] JSDoc 类型定义完整，IDE 可提示新字段

---

### P0-3：新增 mapper

**做什么**：`src/lib/actionRecsMapper.js`，把引擎 item 映射为 `ActionRecsResult`。

**核心函数**：
```js
function toActionRecsResult(item, productResult, dataSourceType) {
  return {
    id: hashId(productResult.p, item.fam, item.sub),
    stableKey: hashId(productResult.p, item.fam, item.sub),
    tier: item.tier,
    scale: {
      ticketCount: item.n,
      complaintCount: item.c,
      consultationCount: item.q,
      complaintRate: item.cr,
      urgentRate: item.n ? item.u / item.n * 100 : 0,
      moMPct: item.mom,
      moMAbs: item.dAbs,
    },
    problemSummary: {
      pain: item.pain || '',
      root: item.root || '',
    },
    recommendation: item.recText || '',
    customerVoice: {
      verbatim: item.voice?.v || '',
      painText: item.pain || '',
      rootText: item.root || '',
    },
    actionsLayerA: (item.mat || []).map(m => ({ text: m.s, freq: m.c })),
    evidenceTicketIds: collectTicketIds(item),  // 从 item 关联的工单号
    scope: { product: productResult.p },
    summary: `${item.fam} - ${item.sub}`,
    inventoryStatus: 'none',  // P2 填充
    signalType: 'tier',       // 兼容旧字段
    priority: tierToPriority(item.tier),  // 兼容旧字段
  }
}
```

**涉及文件**：
- 新增：`src/lib/actionRecsMapper.js`

**验收标准**：
- [ ] 给定一个引擎 item，产出完整的 `ActionRecsResult` 对象
- [ ] `problemSummary.pain` 和 `problemSummary.root` 来自 `mkItem.pain` / `mkItem.root`

---

## P1：数据契约 + 快照接入

### P1-1：新增 `buildActionRecsConclusions.js`

**做什么**：`src/snapshots/buildActionRecsConclusions.js`，替代 `buildSourcePlanningConclusions.js`。

**核心函数**：
```js
import { runLoop } from '../../scripts/lib/actionRecsEngine.cjs'
import { toActionRecsResult } from '../lib/actionRecsMapper.js'

export function buildActionRecsConclusions({ period, dataSourceType, records, previousRecommendations, previousPeriodId, settings }) {
  const taxMap = loadTaxMap();  // 内置 CAUSE_TAX_MAP
  const initialOverrides = loadOverridesFile();  // 冷启动预加载

  const { result, gateReport, rounds, escalated } = runLoop(records, taxMap, {
    maxRounds: settings?.actionRecsMaxRounds || 5,
    initialOverrides,
  });

  const recommendations = result.summary.flatMap(p =>
    p.items
      .filter(item => item.tier !== 'unloc')
      .map(item => toActionRecsResult(item, p, dataSourceType))
  );

  return {
    generatedAt: new Date().toISOString(),
    source: 'rule',
    sampleSize: records.length,
    periodLabel: period.label,
    recommendations,
    gateReport: {
      rounds,
      passed: gateReport.passed,
      failureCount: gateReport.failures?.length || 0,
      escalated,
      failures: gateReport.failures?.slice(0, 10) || [],  // 摘要，不全存
    },
  };
}
```

**涉及文件**：
- 新增：`src/snapshots/buildActionRecsConclusions.js`

---

### P1-2：改 `buildSourceSnapshot.js` 调新函数

**做什么**：把 `buildSourceSnapshot.js:66` 的 `buildSourcePlanningConclusions` 改为 `buildActionRecsConclusions`。

**具体改动**：
```diff
- import { buildSourcePlanningConclusions } from './buildSourcePlanningConclusions.js'
+ import { buildActionRecsConclusions } from './buildActionRecsConclusions.js'
```
```diff
  const planningConclusions = ticket
-   ? buildSourcePlanningConclusions({ ... })
+   ? buildActionRecsConclusions({ ... })
    : undefined
```

**涉及文件**：
- 改造：`src/snapshots/buildSourceSnapshot.js`

---

### P1-3：改 `snapshotService.js`

**做什么**：
1. source 快照：已通过 P1-2 间接调新函数
2. 概览快照：改为合并 source 快照 recommendations（选项 A，不重跑引擎）
3. 移除 `recommendationsLlm` 保留逻辑
4. 新增 `gateReport` 随快照存储（已在 P1-1 产出）

**具体改动**：

`rebuildOverviewSnapshot` 中 `buildOverviewSnapshot` 调用——改为从 `sourceSnapshots` 合并 recommendations：
```js
// 概览 conclusions.recommendations = 投诉 recs + 咨询 recs 合并
const complaintRecs = sourceSnapshots.complaint_ticket?.aggregates?.planningConclusions?.recommendations || [];
const consultationRecs = sourceSnapshots.consultation_ticket?.aggregates?.planningConclusions?.recommendations || [];
// buildOverviewSnapshot 接收合并后的 recommendations，不再调 buildOverviewConclusions
```

移除 L168-176 的 `recommendationsLlm` 保留逻辑。

**涉及文件**：
- 改造：`src/snapshots/snapshotService.js`
- 改造：`src/snapshots/buildOverviewSnapshot.js`（适配合并 recommendations 参数）

---

### P1-4：进度回调增强

**做什么**：`runInsightRebuildJob` 的 `onProgress` 回调增加引擎轮次信息。

**涉及文件**：
- 改造：`server/insightRebuildJob.js`（`onProgress` 回调扩展）
- 改造：`src/snapshots/snapshotService.js`（`rebuildAllSnapshots` 透传轮次信息）

**验收标准（P1 整体）**：
- [ ] 快照重建后 `snapshot.aggregates.planningConclusions.recommendations` 为 `ActionRecsResult[]`
- [ ] 每条 rec 含 `tier` / `scale` / `problemSummary` / `recommendation` / `customerVoice`
- [ ] `planningConclusions.gateReport` 含轮次/通过状态/失败摘要
- [ ] 概览快照 `conclusions.recommendations` 为投诉+咨询 source recs 合并
- [ ] 旧字段 `signalType` / `priority` 兼容填充
- [ ] 快照重建 Job 进度展示引擎轮次

---

## P2：举措库 inventory 接入

### P2-1：新增 `actionRecsInventory.js`

**做什么**：复用 `topicAnalysis/collectEvidence.js` 的 `collectEvidence` 函数，查询每条建议的举措状态。

**核心函数**：
```js
import { collectEvidence } from './topicAnalysis/collectEvidence.js'

export async function enrichWithInventory(recommendations, { actionItemRepository, requirementTicketProgress }) {
  for (const rec of recommendations) {
    const evidence = await collectEvidence({
      productId: rec.scope.product,
      painKey: rec.stableKey,
      actionItemRepository,
      requirementTicketProgress,
    })
    if (evidence.open?.length > 0) rec.inventoryStatus = 'open'
    else if (evidence.done?.length > 0) rec.inventoryStatus = 'done'
    else if (evidence.stopped?.length > 0) rec.inventoryStatus = 'stopped'
    else rec.inventoryStatus = 'none'
  }
  return recommendations
}
```

### P2-2：在 `buildActionRecsConclusions` 中调用

**做什么**：在 mapper 产出 recommendations 后、返回前调 `enrichWithInventory`。

**涉及文件**：
- 新增：`src/lib/actionRecsInventory.js`
- 改造：`src/snapshots/buildActionRecsConclusions.js`（调 inventory）

**验收标准**：
- [ ] 每条 rec 有 `inventoryStatus`（open/done/stopped/none）
- [ ] 口径与 topicAnalysis 一致（同一 action item 查询结果）
- [ ] `done` 不等于"已根治"（口径已对齐）

---

## P3：前端组件（三 tab 共用）

### P3-1：数据 hook

**做什么**：`src/lib/useActionRecommendations.js`，从快照取 recs + 解析 ActionItem 状态。

```js
function useActionRecommendations({ sourceFilter, snapshot }) {
  const recs = useMemo(() => {
    const all = sourceFilter === 'all'
      ? snapshot?.conclusions?.recommendations || []
      : snapshot?.aggregates?.planningConclusions?.recommendations || []
    if (sourceFilter === 'complaint_ticket') return all.filter(r => r.scale?.complaintCount > 0)
    if (sourceFilter === 'consultation_ticket') return all.filter(r => r.scale?.consultationCount > 0)
    return all
  }, [snapshot, sourceFilter])
  return { recs }
}
```

**涉及文件**：新增 `src/lib/useActionRecommendations.js`

---

### P3-2：ProblemCard 组件

**做什么**：`src/components/workbench/ProblemCard.jsx`，单卡展示四要素。

**渲染结构**：
```
ProblemCard
├── 标题行：{fam} · {sub} [{tierLabel}]
├── 问题概述行：
│   ├── [痛点] {problemSummary.pain}
│   └── [根因] {problemSummary.root}
├── 规模行：{N}单 · 环比 {mom} · 投诉率 {cr}%（{c}投诉/{q}咨询）· 加急 {u}
├── 建议行：{recommendation}
└── 徽章行：{inventoryStatus → 颜色+文案}
    → 点击卡片 → onCardClick(rec) → 打开 ProblemDetailDrawer
```

**涉及文件**：新增 `src/components/workbench/ProblemCard.jsx`

---

### P3-3：ActionTierSection 组件

**做什么**：单层容器，标题 + 卡片列表，可折叠。

```
ActionTierSection
├── 标题行：{tierLabel}（可点击折叠/展开）
└── 卡片列表：recs.map(rec => <ProblemCard rec={rec} />)
```

**涉及文件**：新增 `src/components/workbench/ActionTierSection.jsx`

---

### P3-4：ProblemDetailDrawer 组件

**做什么**：详情抽屉，展示定性描述+原声+关联举措+涉及工单。

```
ProblemDetailDrawer
├── 定性描述区：
│   ├── [痛点摘要] {customerVoice.painText}（出处：需求痛点字段）
│   ├── [复核根因] {customerVoice.rootText}（出处：问题原因字段）
│   └── 客户原声 {customerVoice.verbatim}（出处：客户请求内容/受理内容/处理意见）
├── 关联举措区：
│   ├── 层B：ActionItem 列表（经 requirementTicketProgress → derivedStatus）
│   └── 层A：actionsLayerA 候选动作
├── 涉及工单表：
│   └── evidenceTicketIds → 工单详情表（全部/仅投诉/仅咨询 切换）
└── 效果验证表（投诉/咨询 tab 专用）
```

**涉及文件**：新增 `src/components/workbench/ProblemDetailDrawer.jsx`

---

### P3-5：ActionRecsPanel + Toolbar 组件

**做什么**：分层容器 + 筛选/导出工具栏。

```
ActionRecsPanel
├── ActionRecsToolbar（产品筛选 / 导出 MD / 导出 Excel）
├── ActionTierSection × 5（Tier 1-5，默认 Tier 1-3 展开、4-5 收起）
└── ProblemDetailDrawer（受控显示）
```

**涉及文件**：新增 `src/components/workbench/ActionRecsPanel.jsx`、`ActionRecsToolbar.jsx`

---

### P3-6：导出模块

**做什么**：MD 导出 + Excel 导出，共用数据模型。

- `src/lib/actionReportMd.js`：recs → Markdown 文本
- `src/lib/actionReportExcel.js`：recs → xlsx（复用 `planningRecommendationsExport.js` 的 xlsx 逻辑，适配新字段）

**涉及文件**：新增 `src/lib/actionReportMd.js`、`src/lib/actionReportExcel.js`

---

### P3-7：替换挂载

**做什么**：三 tab 替换。

| 位置 | 旧 | 新 |
|---|---|---|
| `OverviewTab.jsx:140` | `<PlanningRecommendationsPanel>` | `<ActionRecsPanel sourceFilter="all" />` |
| `TicketStoryView.jsx` 中"原因与用户需求"区块 | V2 聚类表 + 小样本参考项 | `<ActionRecsPanel sourceFilter={sourceType} />` |

**涉及文件**：
- 改造：`src/components/workbench/OverviewTab.jsx`（或 `src/pages/` 下入口）
- 改造：`src/components/workbench/TicketStoryView.jsx`（只替换聚类表区块，保留其他 6 个区块）

---

### P3-8：改 `ticketStoryModel.js`

**做什么**：`buildTicketStoryModel` 中 `recommendations` 参数改为消费 `ActionRecsResult[]`。

**涉及文件**：改造 `src/lib/ticketStoryModel.js`

---

### P3-9：效果验证表

**做什么**：`ActionEffectTable.jsx`，投诉/咨询 tab 专用，保留现有效果验证功能。

**涉及文件**：新增 `src/components/workbench/ActionEffectTable.jsx`

**验收标准（P3 整体）**：
- [ ] 概览首页展示 5 层卡片，Tier 1-3 默认展开
- [ ] 投诉 tab 展示 `complaintCount > 0` 的卡片 + 创建举措 + 效果验证表
- [ ] 咨询 tab 展示 `consultationCount > 0` 的卡片 + 创建举措 + 效果验证表
- [ ] 点击卡片打开详情抽屉，抽屉展示定性描述+原声+举措+工单
- [ ] MD 导出可用，Excel 导出可用
- [ ] TicketStoryView 其他 6 个区块不受影响

---

## P4：辅助模块适配

### P4-1：影响聚焦 `ticketImpactFocus.js`

**做什么**：适配 `ActionRecsResult` 新字段——用 `tier` + `scope.product` 替代 `signalType` + `priority`。

**涉及文件**：改造 `src/lib/ticketImpactFocus.js`

### P4-2：环比 `planningRecommendationCompare.js`

**做什么**：按新 `stableKey` 匹配环比。

**涉及文件**：改造 `src/lib/planningRecommendationCompare.js`

### P4-3：建议反馈 `planningRecommendationFeedback.js`

**做什么**：适配新 `id` 体系，旧反馈数据保留但不再关联。

**涉及文件**：改造 `src/lib/planningRecommendationFeedback.js`

### P4-4：Excel 导出适配

**做什么**：`planningRecommendationsExport.js` 适配新数据契约，或被 `actionReportExcel.js` 替代。

**涉及文件**：改造/删除 `src/lib/planningRecommendationsExport.js`

### P4-5：专题分析桥接验证

**做什么**：验证 `sourceRecommendationId` 桥不断裂（新周期后自然恢复）。

**涉及文件**：无代码改动，验证即可

**验收标准**：
- [ ] 影响聚焦按新字段分组正常
- [ ] 环比按新 stableKey 匹配正常
- [ ] 建议反馈新 id 体系工作正常
- [ ] 专题分析 `sourceRecommendationId` 桥新周期恢复

---

## P5：废弃清理

### P5-1：删除废弃文件

| 文件 | 操作 |
|---|---|
| `src/components/workbench/PlanningRecommendationsPanel.jsx` | 删除 |
| `src/components/workbench/PlanningRecommendationSectionsView.jsx` | 删除 |
| `src/components/workbench/PlanningRecommendationsHelpModal.jsx` | 删除 |
| `src/lib/planningRecommendations.js`（死代码部分） | 删除 |
| `src/lib/planningRecommendationSections.js` | 删除 |
| `src/lib/painPointClustering/*` | 删除 |
| `src/lib/painPointClustering/overviewClusterFusion.js` | 删除 |
| `src/snapshots/buildSourcePlanningConclusions.js` | 删除 |
| `src/snapshots/buildOverviewConclusions.js` | 删除 |
| `src/lib/overviewConclusionsLLM.js` | 删除 |
| `src/lib/rehydrateOverviewRecommendations.js` | 删除 |
| `src/lib/report/buildReportModel.js` + `resolveOverviewRecommendationsForReport.js` | 删除（疑似死代码） |

### P5-2：更新测试

**涉及文件**：
- `src/snapshots/buildSourcePlanningConclusions.test.js` → 改为 `buildActionRecsConclusions.test.js`
- `src/snapshots/buildOverviewConclusions.test.js` → 删除或改为概览合并测试
- `src/snapshots/painPointClusteringIntegration.test.js` → 删除
- `src/snapshots/insightClusterStability.test.js` → 删除或适配

### P5-3：全量自测

- [ ] 快照重建全流程跑通（投诉+咨询+概览）
- [ ] 三 tab 展示正常
- [ ] 旧代码无残留引用
- [ ] 测试通过

---

## 依赖关系

```
P0-1（引擎模块化） → P0-2（类型定义） → P0-3（mapper）
                                              ↓
                                    P1-1（buildActionRecsConclusions）
                                              ↓
                              P1-2（buildSourceSnapshot） → P1-3（snapshotService） → P1-4（进度回调）
                                              ↓
                                    P2-1（inventory） → P2-2（接入）
                                              ↓
                          P3-1（hook） → P3-2（Card） → P3-3（TierSection） → P3-4（Drawer） → P3-5（Panel） → P3-6（导出） → P3-7（替换挂载） → P3-8（storyModel） → P3-9（效果表）
                                              ↓
                                    P4-1 ~ P4-5（辅助适配）
                                              ↓
                                    P5-1 ~ P5-3（清理 + 测试）
```

**P0 是关键路径**——引擎模块化完成后，P1/P2 可并行推进，P3 依赖 P1 产出。

---

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| `runLoop` 5 轮导致快照重建耗时过长 | 首轮 PASS 即停（常见）；轮次上限可配；进度回调增强 |
| CJS/ESM 互操作问题（`scripts/` 是 .cjs，`src/` 是 ESM） | `actionRecsEngine.cjs` 用 `module.exports`，`src/` 侧用动态 `import()` 或 `createRequire` 桥接 |
| 旧反馈/环比数据断链 | 接受断链，新周期建立新反馈。`planningRecommendationCompare.js` 按新 stableKey 匹配 |
| 删除 V2 代码后其他模块报错 | P5 废弃清理在 P4 辅助适配之后做，确保无残留引用 |
| `TicketStoryView` 改造影响其他区块 | 只替换聚类表区块，其他 6 个区块代码不动 |
