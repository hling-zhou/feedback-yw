import { overviewSnapshotId } from '../domain/snapshot.js'
import { DEFAULT_TENANT_ID } from '../domain/constants.js'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { defaultAnalysisVersions } from '../lib/versioning.js'
import { getComparableMetrics } from '../metrics/registry.js'
import { filterRecordsForScope } from './recordScope.js'
import { buildOverviewConclusions } from './buildOverviewConclusions.js'
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
 * @param {import('../domain/overviewConclusions.js').OverviewRecommendation[]} [params.previousRecommendations]
 * @param {string} [params.previousPeriodId]
 * @param {import('../lib/storage.js').AppSettings | null} [params.settings]
 */
export function buildOverviewSnapshot({
  insightPeriodId,
  period,
  feedbacks,
  sourceSnapshots = {},
  orderVolumes = [],
  status = 'ready',
  previousRecommendations = [],
  previousPeriodId: previousPeriodIdParam,
  settings = null,
}) {
  const previousPeriodId =
    previousPeriodIdParam ?? (period ? previousPeriodIdFromPeriod(period) : null)
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
      const totalByMonth = new Map()
      for (const type of DATA_SOURCE_TYPES) {
        const snap = sourceSnapshots[type]
        const trend = snap?.aggregates?.monthlyTrend
        if (Array.isArray(trend)) {
          for (const row of trend) {
            const key = row.date
            totalByMonth.set(key, (totalByMonth.get(key) || 0) + row.count)
          }
        }
      }
      crossSourceMetrics.monthly_trend = [...totalByMonth.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, count]) => ({ date, count }))
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

  const conclusions = buildOverviewConclusions({
    period,
    feedbacks,
    sourceSnapshots,
    crossSourceMetrics: crossSourceMetricsFinal,
    orderVolumes,
    previousRecommendations,
    previousPeriodId: previousPeriodId || undefined,
    settings,
  })

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
