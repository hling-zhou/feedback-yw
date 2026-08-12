/**
 * 用后即评月报预览模型（对外混算口径 + 回访/举措摘要）
 */
import { computeExternalMixedMetrics, computeInternalSatisfactionMetrics } from './metrics.js'
import { visitMonthForReport } from './visitRecords.js'
import { filterActionsForMonthlyReport } from './actionSignals.js'

/**
 * @typedef {ReturnType<typeof buildMonthlyReportPreviewModel>} MonthlyReportPreviewModel
 */

/**
 * @param {{
 *   reportMonth: string
 *   scoredRows: import('./parseChannels.js').NormalizedPostUseRow[]
 *   productNames: string[]
 *   visits?: import('./visitRecords.js').PostUseVisitRecord[]
 *   actionItems?: import('../../domain/actionItem.js').ActionItem[]
 *   reasons?: { reason: string; count: number; channel?: string }[]
 * }} input
 */
export function buildMonthlyReportPreviewModel(input) {
  const {
    reportMonth,
    scoredRows,
    productNames,
    visits = [],
    actionItems = [],
    reasons = [],
  } = input
  const external = computeExternalMixedMetrics(scoredRows, { productNames })
  const sat = computeInternalSatisfactionMetrics(scoredRows, { productNames })
  const visitMonth = visitMonthForReport(reportMonth)
  const monthVisits = visits.filter((v) => v.visitMonth === visitMonth)
  const proposed = filterActionsForMonthlyReport(actionItems, {
    reportMonth,
    productNames,
    mode: 'this_month_proposed',
  })
  const closed = filterActionsForMonthlyReport(actionItems, {
    reportMonth,
    productNames,
    mode: 'closed_in_month',
  })

  const yw = external.yunwang
  const notQualified = sat.byProduct.filter((p) => p.belowBaseline)
  const refUnqualified = sat.byProduct.filter(
    (p) => p.smallSample && p.rate / 100 < 0.88,
  )

  return {
    title: `用后即评月报（${reportMonth.replace('-', '.')}）`,
    reportMonth,
    visitMonth,
    overview: {
      productCount: yw.productCount,
      totalSample: yw.totalSample,
      avgScore: yw.avgScore,
      belowNineCount: yw.belowNineCount,
      belowNineRatio: yw.belowNineRatio,
      companyAvg: external.company.avgScore,
      companySample: external.company.totalSample,
      note: '对外概述表均分为三渠道混算；工作台对内体验分为短信+控制台。投诉回访在反馈库挂在工单上，不重复列独立明细。',
    },
    satisfaction: {
      notQualified,
      refUnqualified,
      byProduct: sat.byProduct,
    },
    visits: monthVisits,
    actionsProposed: proposed,
    actionsClosed: closed,
    reasons,
  }
}
