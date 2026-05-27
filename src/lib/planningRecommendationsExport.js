import * as XLSX from 'xlsx'
import { formatRecommendationForExport } from './planningRecommendations.js'
import { PERIOD_COMPARE_LABELS } from './planningRecommendationCompare.js'
import { resolveEffectiveRecommendation, WORKFLOW_STATUS_LABELS } from './planningRecommendationDisplay.js'

const CATEGORY_LABELS = {
  product: '产品优化',
  process: '流程运营',
  docs: '文档自助',
  monitoring: '监控预警',
}

/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */

const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' }
const STRENGTH_LABELS = { strong: '强', moderate: '一般', weak: '弱（推断型）' }

/**
 * @param {OverviewRecommendation} rec
 * @param {number} index
 */
function recommendationToRow(rec, index) {
  const effective = resolveEffectiveRecommendation(rec)
  const exported = formatRecommendationForExport(effective)
  const details = effective.details || rec.details || []
  return {
    序号: index + 1,
    优先级: PRIORITY_LABELS[rec.priority] || rec.priority,
    类别: CATEGORY_LABELS[rec.category] || rec.category,
    产品: rec.scope?.product || '',
    旅程一级: rec.scope?.journeyL1 || '',
    旅程二级: rec.scope?.journeyL2 || '',
    问题类型: rec.scope?.problemType || '',
    请求场景: rec.scope?.requestScene || '',
    概述: effective.summary || effective.text || '',
    详细意见1: (effective.details || details)[0] || '',
    详细意见2: (effective.details || details)[1] || '',
    详细意见3: (effective.details || details)[2] || '',
    详细意见4: (effective.details || details)[3] || '',
    跟踪指标: (rec.trackingMetrics || []).join('；'),
    依据工单数: rec.evidenceBundle?.ticketCount ?? rec.evidenceTicketIds?.length ?? '',
    负面工单数: rec.evidenceBundle?.negativeCount ?? '',
    占周期工单占比: rec.evidenceBundle?.sharePct != null ? `${rec.evidenceBundle.sharePct}%` : '',
    证据强度: STRENGTH_LABELS[rec.evidenceStrength] || rec.evidenceStrength || '',
    跟进状态: rec.userOverride?.status
      ? WORKFLOW_STATUS_LABELS[rec.userOverride.status]
      : '',
    负责人: rec.userOverride?.owner || '',
    目标日期: rec.userOverride?.dueDate || '',
    备注: rec.userOverride?.note || '',
    周期变化: rec.periodCompare?.change
      ? PERIOD_COMPARE_LABELS[rec.periodCompare.change] || rec.periodCompare.change
      : '',
    依据工单号: (rec.evidenceTicketIds || []).slice(0, 20).join('、'),
    入选原因: rec.generationMeta?.selectedReason || '',
    已合并同类信号: (rec.generationMeta?.mergedFrom || []).join('；'),
    导出全文: exported,
  }
}

/**
 * @param {OverviewRecommendation[]} recommendations
 * @param {string} [filePrefix]
 */
export function exportPlanningRecommendationsXlsx(recommendations, filePrefix = '行动建议') {
  const rows = (recommendations || []).map((rec, i) => recommendationToRow(rec, i))
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 说明: '暂无行动建议' }])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '行动建议')
  const safePrefix = filePrefix.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40)
  XLSX.writeFile(wb, `${safePrefix}.xlsx`)
}
