import {
  DATA_SOURCE_TYPES,
  DATA_SOURCE_LABELS,
  PERIOD_GRANULARITY_LABELS,
} from '../../domain/enums.js'
import { formatPeriodRange, resolvePreviousInsightPeriod } from '../../domain/insightPeriod.js'
import { PLANNING_RECOMMENDATIONS_PANEL_TITLE } from '../../domain/overviewConclusions.js'
import {
  buildRecommendationExportFullText,
  resolveRecommendationSummary,
} from '../planningRecommendationDisplay.js'
import { computeMaxMomGrowthProductForSource } from '../sourceOverviewMetrics.js'
import { formatWanTouRatioWithTarget } from '../wanTouRatio.js'
import { resolveOverviewRecommendationsForReport } from './resolveOverviewRecommendationsForReport.js'

/**
 * @typedef {Object} ReportSection
 * @property {string} title
 * @property {string} [body]
 * @property {{ label: string; value: string }[]} [rows]
 */

const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' }

/**
 * @param {Object} params
 * @param {'overview' | import('../../domain/enums.js').DataSourceType} params.scope
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null} params.period
 * @param {import('../../domain/snapshot.js').OverviewSnapshot | null} [params.overview]
 * @param {import('../../domain/snapshot.js').InsightSnapshot | null} [params.sourceSnapshot]
 * @param {string} [params.exportedBy]
 * @param {ReturnType<import('../wanTouRatio.js').buildWanTouByProducts>} [params.wanTouRows]
 * @param {import('../lib/types.js').FeedbackRecord[]} [params.feedbacks]
 */
export function buildReportModel({
  scope,
  period,
  overview,
  sourceSnapshot,
  exportedBy,
  wanTouRows = [],
  feedbacks = [],
}) {
  const periodLabel = period?.label || '—'
  const range = period ? formatPeriodRange(period) : '—'
  const periodType = period?.granularity
    ? PERIOD_GRANULARITY_LABELS[period.granularity]
    : '—'
  const generatedAt = new Date().toISOString()
  const previousPeriod = resolvePreviousInsightPeriod(period)

  /** @type {ReportSection[]} */
  const sections = [
    {
      title: '报告信息',
      rows: [
        { label: '洞察周期', value: periodLabel },
        { label: '周期类型', value: periodType },
        { label: '区间', value: range },
        { label: '范围', value: scope === 'overview' ? '综合概述' : DATA_SOURCE_LABELS[scope] || scope },
        { label: '生成时间', value: generatedAt.slice(0, 19).replace('T', ' ') },
        { label: '导出人', value: exportedBy || '本地用户' },
      ],
    },
  ]

  if (scope === 'overview' && overview) {
    const total = overview.crossSourceMetrics?.totalRecords
    if (total != null) {
      sections.push({
        title: '周期概览',
        rows: [{ label: '周期内反馈', value: String(total) }],
      })
    }

    sections.push({
      title: '各数据来源概览',
      rows: DATA_SOURCE_TYPES.map((type) => {
        const summary = overview.sourceSummaries?.[type]
        const count = summary?.recordCount ?? 0
        const maxMomGrowthProduct =
          summary?.maxMomGrowthProduct ??
          computeMaxMomGrowthProductForSource(feedbacks, period, previousPeriod, type) ??
          null
        const parts = [String(count)]
        if (summary?.negativePct != null) parts.push(`负面占比 ${summary.negativePct}%`)
        if (maxMomGrowthProduct) {
          parts.push(`环比最大增幅产品 ${maxMomGrowthProduct}`)
        }
        return {
          label: DATA_SOURCE_LABELS[type],
          value: parts.join(' · '),
        }
      }),
    })

    const recommendations = resolveOverviewRecommendationsForReport(overview.conclusions)
    if (recommendations.length) {
      sections.push({
        title: PLANNING_RECOMMENDATIONS_PANEL_TITLE,
        rows: recommendations.map((rec, i) => {
          const summary = resolveRecommendationSummary(rec)
          const priority = PRIORITY_LABELS[rec.priority] || rec.priority
          const product = rec.scope?.product?.trim()
          const labelParts = [`${i + 1}. ${priority}优先级`]
          if (product) labelParts.push(product)
          if (summary) labelParts.push(summary)
          return {
            label: labelParts.join(' · '),
            value: buildRecommendationExportFullText(rec),
          }
        }),
      })
    }

    if (wanTouRows.length > 0) {
      sections.push({
        title: '各产品万投比（投诉工单）',
        body: `${periodLabel} · 月粒度=当月投诉÷当月订单×10000；年粒度=12 月月万投比算术平均。分母在设置 → 产品月订单数中维护。`,
        rows: wanTouRows.map((r) => {
          const parts = [
            `全部投诉 ${r.totalComplaints}`,
            `万投比 ${formatWanTouRatioWithTarget(r.displayRatio, r.periodWanTouTargetEval)}`,
            `客户体验类投诉 ${r.totalCxComplaints ?? 0}`,
            `客户体验类万投比 ${formatWanTouRatioWithTarget(r.displayCxRatio, r.periodCxWanTouTargetEval)}`,
          ]
          if (r.missingOrderMonths?.length) {
            parts.push(`缺订单数 ${r.missingOrderMonths.length} 月`)
          }
          return { label: r.productName, value: parts.join(' · ') }
        }),
      })
    }
  }

  if (scope !== 'overview' && sourceSnapshot) {
    const s = sourceSnapshot.summary || {}
    const maxMomGrowthProduct =
      s.maxMomGrowthProduct ??
      computeMaxMomGrowthProductForSource(feedbacks, period, previousPeriod, scope) ??
      null
    sections.push({
      title: '数据摘要',
      rows: [
        { label: '记录数', value: String(s.recordCount ?? 0) },
        { label: '负面占比', value: s.negativePct != null ? `${s.negativePct}%` : '—' },
        { label: '环比最大增幅产品', value: maxMomGrowthProduct || '—' },
      ],
    })

    const agg = sourceSnapshot.aggregates || {}
    if (Array.isArray(agg.products) && agg.products.length) {
      sections.push({
        title: '产品分布（周期内）',
        rows: agg.products.slice(0, 12).map((p) => ({
          label: p.name,
          value: `${p.count} 条`,
        })),
      })
    }

    if (Array.isArray(agg.sentiment) && agg.sentiment.length) {
      sections.push({
        title: '客户情绪分布',
        rows: agg.sentiment.map((item) => ({
          label: item.name || '—',
          value: `${item.value} 条${item.pct != null ? `（${item.pct}%）` : ''}`,
        })),
      })
    }

    const trend = Array.isArray(agg.monthlyTrend) ? agg.monthlyTrend : []
    if (trend.length) {
      const latest = trend.at(-1)
      const previous = trend.at(-2)
      const delta = latest && previous ? latest.count - previous.count : null
      /** @type {{ label: string; value: string }[]} */
      const trendRows = []
      if (latest) {
        trendRows.push({
          label: '最近月',
          value: `${latest.date} · ${latest.count} 条`,
        })
      }
      if (delta != null) {
        trendRows.push({
          label: '环比',
          value: `${delta >= 0 ? '+' : ''}${delta}`,
        })
      }
      if (trendRows.length) {
        sections.push({ title: '月度趋势摘要', rows: trendRows })
      }
    }

    if (Array.isArray(agg.requestScenes) && agg.requestScenes.length) {
      sections.push({
        title: '请求场景 Top',
        rows: agg.requestScenes.slice(0, 8).map((item) => ({
          label: item.name,
          value: `${item.count} 条`,
        })),
      })
    }

    if (Array.isArray(agg.problemTypes) && agg.problemTypes.length) {
      sections.push({
        title: '问题类型 Top',
        rows: agg.problemTypes.slice(0, 8).map((item) => ({
          label: item.name,
          value: `${item.count} 条`,
        })),
      })
    }

    if (Array.isArray(agg.complaintCauseL1) && agg.complaintCauseL1.length) {
      sections.push({
        title: '投诉原因 Top（终判）',
        rows: agg.complaintCauseL1.slice(0, 8).map((item) => ({
          label: item.name,
          value: `${item.count} 条`,
        })),
      })
    }
  }

  sections.push({
    title: '说明',
    body: '本报告由 Feedback Insights 根据洞察快照与工作台视图自动生成。图表为导出时页面截图。内部资料，请勿外传。',
  })

  return {
    title:
      scope === 'overview'
        ? `用户反馈洞察报告 · ${periodLabel}`
        : `${DATA_SOURCE_LABELS[scope] || scope} · ${periodLabel}`,
    periodLabel,
    generatedAt,
    sections,
    chartImages: [],
  }
}
