import { sourceSnapshotId } from '../domain/snapshot.js'
import { DEFAULT_TENANT_ID, PIPELINE_VERSION_TICKET } from '../domain/constants.js'
import { getPipelineDescriptor } from '../analysis/registry.js'
import { defaultAnalysisVersions } from '../lib/versioning.js'
import { isTicketSource } from '../lib/importUtils.js'
import { computeStats, monthlyTrend, sentimentStats } from '../lib/analytics.js'
import {
  countByField,
  journeyTree,
  aggregateFieldInsights,
} from '../lib/productAnalytics.js'
import { listProducts } from '../lib/productTaxonomy.js'
import { countComplaintCauseL1 } from '../domain/complaintCause.js'
import { buildSourcePainPointClusterSnapshot } from '../lib/painPointClustering/buildSourceClusterSnapshot.js'
import {
  buildFollowUpSatisfactionMetrics,
  extractFollowUpTicketRecords,
} from '../lib/followUpSatisfactionAnalytics.js'
import { buildSourcePlanningConclusions } from './buildSourcePlanningConclusions.js'

/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/snapshot.js').InsightSnapshot} InsightSnapshot */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */
/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */

/**
 * @param {Object} params
 * @param {string} params.insightPeriodId
 * @param {DataSourceType} params.dataSourceType
 * @param {FeedbackRecord[]} params.records
 * @param {'ready' | 'stale'} [params.status]
 * @param {FeedbackRecord[]} [params.ticketRecordsForFollowUp] 周期内投诉/咨询工单（回访指标数据源）
 * @param {InsightPeriod | null} [params.period] 用于本源典型问题结论
 * @param {import('../lib/storage.js').AppSettings | null} [params.settings]
 * @param {OverviewRecommendation[]} [params.previousRecommendations]
 * @param {string} [params.previousPeriodId]
 */
export function buildSourceSnapshot({
  insightPeriodId,
  dataSourceType,
  records,
  status = 'ready',
  ticketRecordsForFollowUp = [],
  period = null,
  settings = null,
  previousRecommendations = [],
  previousPeriodId,
}) {
  const versions = defaultAnalysisVersions()
  const desc = getPipelineDescriptor(dataSourceType)
  const ticket = isTicketSource(dataSourceType)

  const stats = computeStats(records)
  const sentiment = ticket ? sentimentStats(records) : { total: records.length, distribution: [] }
  const products = listProducts(records)
  const trend = ticket ? monthlyTrend(records, { basis: 'importMonth', limit: 12 }) : []

  const followUpTickets = extractFollowUpTicketRecords(ticketRecordsForFollowUp)
  const followUpSatisfactionMetrics =
    dataSourceType === 'post_use_rating'
      ? buildFollowUpSatisfactionMetrics(followUpTickets)
      : undefined

  const planningConclusions = ticket
    ? buildSourcePlanningConclusions({
        period: period || {
          id: insightPeriodId,
          label: insightPeriodId,
          startDate: '2000-01-01',
          endDate: '2099-12-31',
          status: 'active',
          tenantId: DEFAULT_TENANT_ID,
          schemaVersion: versions.schemaVersion,
          createdAt: '',
          updatedAt: '',
        },
        dataSourceType,
        records,
        previousRecommendations,
        previousPeriodId,
        settings,
      })
    : undefined

  /** @type {InsightSnapshot} */
  const snapshot = {
    id: sourceSnapshotId(dataSourceType, insightPeriodId),
    tenantId: DEFAULT_TENANT_ID,
    insightPeriodId,
    dataSourceType,
    status,
    schemaVersion: versions.schemaVersion,
    pipelineVersion: desc?.pipelineVersion || PIPELINE_VERSION_TICKET,
    tagLibraryVersion: versions.tagLibraryVersion,
    generatedAt: new Date().toISOString(),
    summary: {
      recordCount: records.length,
      negativePct: stats.negativePct,
      openCount: stats.open,
      thisWeek: stats.thisWeek,
      outOfPeriodWarnings: records.filter((r) => r.outOfPeriodWarning).length,
    },
    aggregates: {
      products,
      requestScenes: ticket ? countByField(records, 'requestScene') : [],
      problemTypes: ticket ? countByField(records, 'problemType') : [],
      complaintCauseL1:
        dataSourceType === 'complaint_ticket' ? countComplaintCauseL1(records) : [],
      journeyTree: ticket ? journeyTree(records) : [],
      themes: ticket ? aggregateFieldInsights(records, 'themes', { multi: true }) : [],
      monthlyTrend: trend,
      sentiment: sentiment.distribution,
      painPointClustering: ticket ? buildSourcePainPointClusterSnapshot(records) : undefined,
      followUpSatisfactionMetrics,
      planningConclusions,
    },
    recordIds: records.map((r) => r.id),
  }

  return snapshot
}
