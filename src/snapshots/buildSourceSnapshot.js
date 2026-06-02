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

/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/snapshot.js').InsightSnapshot} InsightSnapshot */

/**
 * @param {Object} params
 * @param {string} params.insightPeriodId
 * @param {DataSourceType} params.dataSourceType
 * @param {FeedbackRecord[]} params.records
 * @param {'ready' | 'stale'} [params.status]
 */
export function buildSourceSnapshot({ insightPeriodId, dataSourceType, records, status = 'ready' }) {
  const versions = defaultAnalysisVersions()
  const desc = getPipelineDescriptor(dataSourceType)
  const ticket = isTicketSource(dataSourceType)

  const stats = computeStats(records)
  const sentiment = ticket ? sentimentStats(records) : { total: records.length, distribution: [] }
  const products = listProducts(records)
  const trend = ticket ? monthlyTrend(records, { basis: 'importMonth', limit: 12 }) : []

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
    },
    recordIds: records.map((r) => r.id),
  }

  return snapshot
}
