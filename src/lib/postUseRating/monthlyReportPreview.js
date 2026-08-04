/**
 * 用后即评月报预览模型（对外混算口径 + 回访/举措摘要）
 */
import {
  buildMonthlyScoreTable,
  computeExternalMixedMetrics,
  computeInternalSatisfactionMetrics,
  computeScoreDistribution,
} from './metrics.js'
import { filterVisitsByMonth, visitMonthForReport } from './visitRecords.js'
import { filterActionsForMonthlyReport } from './actionSignals.js'

const REVIEW_SECTION_LABELS = {
  '2.1': '2.1 整体得分情况',
  '2.3': '2.3 整体分布',
  '3.1': '3.1 上期回访结果',
}

/**
 * @param {Array<{
 *   id?: string
 *   section?: string
 *   title?: string
 *   summary?: string
 *   recommendation?: string
 *   hitCount?: number
 *   lastSeenAt?: string
 * }>} learnings
 */
function buildReviewChecklist(learnings) {
  const sectionOrder = ['2.1', '2.3', '3.1']
  const normalized = (learnings || [])
    .filter((item) => item?.title && item?.recommendation)
    .map((item) => ({
      ...item,
      section: item.section || '',
      sectionLabel: REVIEW_SECTION_LABELS[item.section] || item.section || '其他章节',
      hitCount: Number(item.hitCount || 0),
      lastSeenAt: item.lastSeenAt || item.createdAt || '',
    }))
    .sort((a, b) => {
      const hitDelta = Number(b.hitCount || 0) - Number(a.hitCount || 0)
      if (hitDelta !== 0) return hitDelta
      const sectionDelta = sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section)
      if (sectionDelta !== 0) return sectionDelta
      return String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''))
    })

  return normalized.slice(0, 5)
}

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
 *   insightBundle?: ReturnType<import('./insights.js').buildPostUseInsightBundle>
 *   quality?: object
 *   storyModel?: ReturnType<import('./storyModel.js').buildPostUseStoryModel>
 *   learnings?: Array<{
 *     id?: string
 *     section?: string
 *     title?: string
 *     summary?: string
 *     recommendation?: string
 *     hitCount?: number
 *     lastSeenAt?: string
 *   }>
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
    insightBundle = {},
    quality = null,
    storyModel = null,
    learnings = [],
  } = input
  const external = storyModel?.metrics?.external || computeExternalMixedMetrics(scoredRows, { productNames })
  const sat = storyModel?.metrics?.satisfaction || computeInternalSatisfactionMetrics(scoredRows, { productNames })
  const onlineInsights = storyModel?.insightBundle || insightBundle
  const visitMonth = visitMonthForReport(reportMonth)
  const monthVisits = filterVisitsByMonth(visits, visitMonth)
  const monthlyScoreTable = storyModel?.metrics?.monthlyScoreTable
    || buildMonthlyScoreTable(scoredRows, { productNames })
  const nonTenDistributionProducts = storyModel?.metrics?.nonTenDistributionProducts
    || monthlyScoreTable
      .filter((row) => row.avgScore !== 10 || row.hasNonTenScore)
      .map((row) => row.productName)
  const scoreDistribution = storyModel?.metrics?.scoreDistribution
    || computeScoreDistribution(scoredRows, nonTenDistributionProducts)
  const scoreDistributionTable = nonTenDistributionProducts.map((productName) => ({
    productName,
    ...(scoreDistribution[productName] || {
      sampleSize: 0,
      10: 0,
      9: 0,
      8: 0,
      7: 0,
      6: 0,
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
    }),
  }))
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
  const reviewChecklist = buildReviewChecklist(learnings)

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
      note: '本报告是线上用后即评综合分析的月度发布视图。数据范围、产品范围、指标规则、洞察和举措均复用线上看板；Word 仅进行章节筛选与正式排版，不另行计算。',
    },
    onlineModel: {
      source: 'post_use_online_insight_bundle',
      generatedAt: onlineInsights.generatedAt || new Date().toISOString(),
      ruleVersion: onlineInsights.ruleVersion || '',
      quality,
      visitEvidenceCount: onlineInsights.visitEvidenceCount || 0,
    },
    productExperience: storyModel?.productOverview || onlineInsights.products || [],
    monthlyScoreTable,
    sceneJourneys: storyModel?.drivers?.sceneJourneys || onlineInsights.sceneJourneys || [],
    needs: storyModel?.drivers?.needs || onlineInsights.needs || [],
    customers: storyModel?.drivers?.customers || onlineInsights.customers || [],
    issueChanges: storyModel?.trendsAndChanges?.changes || onlineInsights.issueChanges || [],
    scoreDistributionTable,
    reviewLearnings: learnings,
    reviewChecklist,
    satisfaction: {
      notQualified,
      refUnqualified,
      byProduct: sat.byProduct,
    },
    visits: monthVisits,
    visitsDetailed: monthVisits.map((visit) => ({
      ...visit,
      customerName: visit.customerName || visit.userInfoDetail || visit.userInfo || '',
      customerCode: visit.customerCode || '',
      userFeedbackText: visit.userFeedbackText || '',
      userInfoDetail: visit.userInfoDetail || visit.userInfo || '',
      visitFeedbackDetail: visit.visitFeedbackDetail || visit.visitResult || '',
      internalEvaluationDetail:
        visit.internalEvaluationDetail || visit.internalConclusion || '',
    })),
    actionsProposed: proposed,
    actionsClosed: closed,
    actionMappings: [...proposed, ...closed].map((action) => ({
      id: action.id,
      productName: action.productName,
      content: action.content,
      insightTheme: action.insightTheme || action.painPointSnapshot || '未关联洞察主题',
      evidenceCount: action.evidenceRecordIds?.length || 0,
      recovery: action.recoveryValidation?.label || (action.status === 'completed' ? '待验证' : '推进中'),
    })),
    completedButNotRecovered: closed.filter(
      (action) => action.status === 'completed' && action.recoveryValidation?.status === 'not_recovered',
    ),
    reasons,
  }
}
