import { overviewSnapshotId } from '../domain/snapshot.js'
import { DEFAULT_TENANT_ID } from '../domain/constants.js'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { defaultAnalysisVersions } from '../lib/versioning.js'
import { getComparableMetrics } from '../metrics/registry.js'
import { monthlyTrend, monthlyTrendByProduct } from '../lib/analytics.js'
import { isTicketSource } from '../lib/importUtils.js'
import { filterRecordsForScope } from './recordScope.js'
import { previousPeriodIdFromPeriod, resolvePreviousInsightPeriod } from '../domain/insightPeriod.js'
import { computeMaxMomGrowthProductForSource } from '../lib/sourceOverviewMetrics.js'

/** @typedef {import('../storage/orderVolumeStore.js').OrderVolumeRow} OrderVolumeRow */

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/snapshot.js').InsightSnapshot} InsightSnapshot */
/** @typedef {import('../domain/snapshot.js').OverviewSnapshot} OverviewSnapshot */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */

/**
 * @param {Object} params
 * @param {string} params.insightPeriodId
 * @param {InsightPeriod} [params.period]
 * @param {FeedbackRecord[]} params.feedbacks
 * @param {Partial<Record<import('../domain/enums.js').DataSourceType, InsightSnapshot>>} [params.sourceSnapshots]
 * @param {OrderVolumeRow[]} [params.orderVolumes]
 * @param {'ready' | 'stale'} [params.status]
 * @param {import('../lib/storage.js').AppSettings | null} [params.settings]
 * @param {import('../domain/overviewConclusions.js').ActionRecsResult[]} [params.mergedRecommendations]
 * @param {object | null} [params.mergedGateReport]
 */
export function buildOverviewSnapshot({
  insightPeriodId,
  period,
  feedbacks,
  sourceSnapshots = {},
  orderVolumes = [],
  status = 'ready',
  settings = null,
  mergedRecommendations = [],
  mergedGateReport = null,
}) {
  const previousPeriod = resolvePreviousInsightPeriod(period)
  const versions = defaultAnalysisVersions()
  /** @type {OverviewSnapshot['sourceSummaries']} */
  const sourceSummaries = {}

  for (const type of DATA_SOURCE_TYPES) {
    const snap = sourceSnapshots[type]
    const scoped = filterRecordsForScope(feedbacks, period, type)
    const maxMomGrowthProduct = computeMaxMomGrowthProductForSource(
      feedbacks,
      period,
      previousPeriod,
      type,
    )
    sourceSummaries[type] = {
      ...(snap?.summary || { recordCount: scoped.length }),
      maxMomGrowthProduct: maxMomGrowthProduct || undefined,
    }
  }

  const ticketRecordsForTrend = DATA_SOURCE_TYPES.flatMap((type) =>
    isTicketSource(type) ? filterRecordsForScope(feedbacks, period, type) : [],
  )

  const comparable = getComparableMetrics()
  /** @type {Record<string, unknown>} */
  const crossSourceMetrics = {}

  for (const metric of comparable) {
    if (metric.id === 'record_count') {
      crossSourceMetrics.record_count = DATA_SOURCE_TYPES.map((type) => ({
        source: type,
        label: DATA_SOURCE_LABELS[type],
        value: sourceSummaries[type]?.recordCount ?? 0,
      }))
    }
    if (metric.id === 'product_distribution') {
      crossSourceMetrics.product_distribution_note =
        '各来源产品命名可能不一致，请在分源 Tab 查看明细'
    }
    if (metric.id === 'monthly_trend') {
      const trend = monthlyTrend(ticketRecordsForTrend, { basis: 'importMonth', limit: 12 })
      crossSourceMetrics.monthly_trend = trend.map(({ date, count }) => ({ date, count }))
      crossSourceMetrics.monthly_trend_by_product = monthlyTrendByProduct(ticketRecordsForTrend, {
        basis: 'importMonth',
        limit: 12,
      })
    }
  }

  const totalRecords = DATA_SOURCE_TYPES.reduce(
    (sum, type) => sum + (sourceSummaries[type]?.recordCount || 0),
    0,
  )

  const crossSourceMetricsFinal = {
    ...crossSourceMetrics,
    totalRecords,
  }

  // 新方案：概览 conclusions 从 source 快照合并 recommendations，不再调 V2 引擎
  const conclusions = {
    generatedAt: new Date().toISOString(),
    source: 'rule',
    sampleSize: totalRecords,
    periodLabel: period?.label || '当前周期',
    insufficientData: totalRecords < 3,
    executiveSummary: '',
    dataCoverageNotes: [],
    highlights: [],
    recommendations: mergedRecommendations,
    recommendationsMeta: {
      recommendationEngine: 'action_recs_v1',
      mergedFrom: 'source_snapshots',
      cappedCount: mergedRecommendations.length,
    },
    gateReport: mergedGateReport || undefined,
  }

  return {
    id: overviewSnapshotId(insightPeriodId),
    tenantId: DEFAULT_TENANT_ID,
    insightPeriodId,
    status,
    schemaVersion: versions.schemaVersion,
    generatedAt: new Date().toISOString(),
    sourceSummaries,
    crossSourceMetrics: crossSourceMetricsFinal,
    conclusions,
  }
}
