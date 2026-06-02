import * as XLSX from 'xlsx'
import { PLANNING_SECTION_LABELS, CLUSTER_SUB_LABELS } from './planningRecommendationSections.js'
import {
  formatClusterRootCauseForExport,
  normalizeClusterRootCause,
  painClusterScoresToExportFields,
  resolveRecommendationSummary,
} from './planningRecommendationDisplay.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */

const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' }

/**
 * V2 行动建议 Excel 行（列与概览页 PlanningRecommendationSectionsView 一致）
 * @param {OverviewRecommendation} rec
 * @param {number} index
 */
export function planningRecommendationToExportRow(rec, index) {
  const sections = rec.sections
  const summary = resolveRecommendationSummary(rec)
  const cluster = normalizeClusterRootCause(sections?.clusterRootCause)

  return {
    序号: index + 1,
    优先级: PRIORITY_LABELS[rec.priority] || rec.priority,
    产品: rec.scope?.product || '',
    ...painClusterScoresToExportFields(sections?.painClusterScores, summary),
    [PLANNING_SECTION_LABELS.clusterRootCause]: formatClusterRootCauseForExport(cluster),
    [CLUSTER_SUB_LABELS.painClusters]: (cluster?.painClusters || [])
      .map((p) => `「${p.text}」${p.count} 单`)
      .join('\n'),
    [CLUSTER_SUB_LABELS.businessImpact]: cluster?.businessImpact || '',
    [PLANNING_SECTION_LABELS.productActions]: (sections?.productActions || []).join('\n'),
    [PLANNING_SECTION_LABELS.serviceActions]: (sections?.serviceActions || []).join('\n'),
    依据工单号: (rec.evidenceTicketIds || []).slice(0, 50).join('、'),
    入选原因: rec.generationMeta?.selectedReason || '',
  }
}

/**
 * @param {OverviewRecommendation[]} recommendations
 * @param {string} [filePrefix]
 */
export function exportPlanningRecommendationsXlsx(recommendations, filePrefix = '行动建议') {
  const rows = (recommendations || []).map((rec, i) => planningRecommendationToExportRow(rec, i))
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 说明: '暂无行动建议' }])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '行动建议')
  const safePrefix = filePrefix.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40)
  XLSX.writeFile(wb, `${safePrefix}.xlsx`)
}
