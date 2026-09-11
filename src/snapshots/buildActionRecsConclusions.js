import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { mapEngineResult, mapGateReport } from '../lib/actionRecsMapper.js'
import { enrichWithInventory } from '../lib/actionRecsInventory.js'
import { attachRecommendationPeriodCompare } from '../lib/planningRecommendationCompare.js'

// 引擎 .cjs 仅在服务端快照构建时加载，通过 dynamic import 避免被 Vite 静态分析拉入浏览器 bundle
let _runLoop = null
async function getRunLoop() {
  if (_runLoop) return _runLoop
  // Vite external 配置使 'module' 在浏览器构建时被跳过，仅服务端/测试环境可用
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const mod = require('../../scripts/lib/actionRecsEngine.cjs')
  _runLoop = mod.runLoop
  return _runLoop
}

/** @typedef {import('../domain/overviewConclusions.js').ActionRecsConclusions} ActionRecsConclusions */
/** @typedef {import('../domain/overviewConclusions.js').ActionRecsResult} ActionRecsResult */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/**
 * @param {InsightPeriod | null | undefined} period
 */
function periodMonthKey(period) {
  if (period?.granularity === 'month' && period.anchorYear && period.anchorMonth) {
    return `${period.anchorYear}-${String(period.anchorMonth).padStart(2, '0')}`
  }
  if (period?.granularity === 'custom' && period.customToMonth) {
    return period.customToMonth
  }
  return undefined
}

/**
 * 用新引擎（区分度加权 best-match + 三方闭环）生成行动建议，替代 buildSourcePlanningConclusions。
 *
 * 返回结构与 OverviewConclusions 兼容（字段名 planningConclusions 不变），
 * 但 recommendations 是 ActionRecsResult[] 而非旧 OverviewRecommendation[]。
 *
 * @param {Object} params
 * @param {InsightPeriod | null | undefined} params.period
 * @param {DataSourceType} params.dataSourceType
 * @param {FeedbackRecord[]} params.records 已限定为本源 + 周期的工单
 * @param {ActionRecsResult[]} [params.previousRecommendations]
 * @param {string} [params.previousPeriodId]
 * @param {import('../lib/storage.js').AppSettings | null} [params.settings]
 * @returns {Promise<ActionRecsConclusions>}
 */
export async function buildActionRecsConclusions({
  period,
  dataSourceType,
  records,
  previousRecommendations = [],
  previousPeriodId,
  settings = null,
}) {
  const periodLabel = period?.label || '当前周期'
  const periodMonth = periodMonthKey(period)
  const sampleSize = records.length
  const sourceLabel = DATA_SOURCE_LABELS[dataSourceType] || dataSourceType
  const maxRounds = settings?.actionRecsMaxRounds || 5

  /** @type {string[]} */
  const dataCoverageNotes = []

  if (sampleSize < 3) {
    return {
      generatedAt: new Date().toISOString(),
      source: 'rule',
      sampleSize,
      periodLabel,
      periodMonth,
      insightPeriodId: period?.id,
      insufficientData: true,
      executiveSummary: '',
      dataCoverageNotes: [
        `${sourceLabel}本周期样本不足（${sampleSize} 条），暂不生成行动建议。`,
      ],
      highlights: [],
      recommendations: [],
      recommendationsMeta: {
        recommendationEngine: 'action_recs_v1',
        dataSourceType,
        previousPeriodId: previousPeriodId || undefined,
      },
    }
  }

  // 运行三方闭环（runEngine → runGate → [FAIL → runFixer → 重跑] → 最多 maxRounds 轮）
  const runLoop = await getRunLoop()
  const loop = runLoop(records, { maxRounds })

  // 映射引擎结果为 ActionRecsResult[]
  const recommendations = mapEngineResult(loop.result, dataSourceType, records)

  // 环比标注：与上一周期按 stableKey 匹配，注入 periodCompare
  if (previousRecommendations.length > 0) {
    const { recommendations: withCompare } = attachRecommendationPeriodCompare(
      recommendations, previousRecommendations
    )
    recommendations.length = 0
    recommendations.push(...withCompare)
  }

  // 接入举措库 inventory（填充 inventoryStatus + inventoryActions）
  if (settings?.actionItemRepository) {
    enrichWithInventory(recommendations, settings.actionItemRepository)
  }

  // 生成门禁报告摘要
  const gateReport = mapGateReport(loop)

  // 数据覆盖说明
  const unclassifiedProducts = (loop.result.summary || []).filter(
    (s) => s.T > 0 && s.unclassified / s.T > 0.05,
  )
  if (unclassifiedProducts.length) {
    dataCoverageNotes.push(
      `${unclassifiedProducts
        .map((s) => `${s.p} 未归类率 ${(s.unclassified / s.T * 100).toFixed(1)}%`)
        .join('，')}，建议补充分类法正则或人工复核。`,
    )
  }

  if (gateReport.escalated) {
    dataCoverageNotes.push(
      `三方闭环 ${gateReport.rounds} 轮未通过门禁（${gateReport.failureCount} 项失败），已升级人工复核。`,
    )
  }

  if (!recommendations.length) {
    dataCoverageNotes.push('本周期未生成行动建议——可能数据量不足或分类法未覆盖。')
  }

  return {
    generatedAt: new Date().toISOString(),
    source: 'rule',
    sampleSize,
    periodLabel,
    periodMonth,
    insightPeriodId: period?.id,
    insufficientData: false,
    executiveSummary: '',
    dataCoverageNotes,
    highlights: [],
    recommendations,
    recommendationsMeta: {
      recommendationEngine: 'action_recs_v1',
      dataSourceType,
      previousPeriodId: previousPeriodId || undefined,
      generatedRecommendationCount: recommendations.length,
      cappedCount: recommendations.length,
      gateRounds: gateReport.rounds,
      gatePassed: gateReport.passed,
      gateEscalated: gateReport.escalated,
    },
    gateReport,
  }
}
