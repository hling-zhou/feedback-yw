import {
  DATA_SOURCE_TYPES,
  DATA_SOURCE_LABELS,
  PERIOD_GRANULARITY_LABELS,
} from '../../domain/enums.js'
import { formatPeriodRange } from '../../domain/insightPeriod.js'
import { formatRecommendationForExport } from '../planningRecommendations.js'
import {
  OVERVIEW_EXECUTIVE_SUMMARY_TITLE,
  OVERVIEW_INSIGHTS_PANEL_TITLE,
  OVERVIEW_INSIGHTS_REPORT_PREFIX,
  PLANNING_RECOMMENDATIONS_PANEL_TITLE,
} from '../../domain/overviewConclusions.js'
import { formatWanTouRatio } from '../wanTouRatio.js'

/**
 * @typedef {Object} ReportSection
 * @property {string} title
 * @property {string} [body]
 * @property {{ label: string; value: string }[]} [rows]
 */

/**
 * @param {Object} params
 * @param {'overview' | import('../../domain/enums.js').DataSourceType} params.scope
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null} params.period
 * @param {import('../../domain/snapshot.js').OverviewSnapshot | null} [params.overview]
 * @param {import('../../domain/snapshot.js').InsightSnapshot | null} [params.sourceSnapshot]
 * @param {string} [params.exportedBy]
 * @param {ReturnType<import('../wanTouRatio.js').buildWanTouByProducts>} [params.wanTouRows]
 */
export function buildReportModel({
  scope,
  period,
  overview,
  sourceSnapshot,
  exportedBy,
  wanTouRows = [],
}) {
  const periodLabel = period?.label || '—'
  const range = period ? formatPeriodRange(period) : '—'
  const periodType = period?.granularity
    ? PERIOD_GRANULARITY_LABELS[period.granularity]
    : '—'
  const generatedAt = new Date().toISOString()

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
    sections.push({
      title: '各来源数据量',
      rows: DATA_SOURCE_TYPES.map((type) => ({
        label: DATA_SOURCE_LABELS[type],
        value: String(overview.sourceSummaries?.[type]?.recordCount ?? 0),
      })),
    })
    const total = overview.crossSourceMetrics?.totalRecords
    if (total != null) {
      sections.push({
        title: '汇总',
        rows: [{ label: '反馈总量', value: String(total) }],
      })
    }
    const trend = overview.crossSourceMetrics?.monthly_trend
    if (Array.isArray(trend) && trend.length) {
      sections.push({
        title: '跨源月度趋势（条数）',
        rows: trend.slice(-6).map((t) => ({
          label: t.date,
          value: String(t.count),
        })),
      })
    }

    const conclusions = overview.conclusions
    if (conclusions && !conclusions.insufficientData) {
      const sourceLabel =
        conclusions.source === 'hybrid' ? '规则聚合 + LLM 润色' : '规则聚合'

      if (conclusions.recommendations?.length) {
        sections.push({
          title: PLANNING_RECOMMENDATIONS_PANEL_TITLE,
          rows: conclusions.recommendations.map((r, i) => ({
            label: `${i + 1}. [${r.priority}] ${r.summary || r.text}`,
            value: formatRecommendationForExport(r),
          })),
        })
      }

      sections.push({
        title: `${OVERVIEW_INSIGHTS_REPORT_PREFIX} · ${OVERVIEW_EXECUTIVE_SUMMARY_TITLE}`,
        body: conclusions.executiveSummary,
        rows: [
          { label: '结论来源', value: sourceLabel },
          { label: '工单样本', value: `${conclusions.sampleSize} 条` },
          ...(conclusions.llmPolishedAt
            ? [
                {
                  label: 'LLM 润色时间',
                  value: conclusions.llmPolishedAt.slice(0, 19).replace('T', ' '),
                },
              ]
            : []),
        ],
      })
      if (conclusions.dataCoverageNotes?.length) {
        sections.push({
          title: '数据覆盖说明',
          body: conclusions.dataCoverageNotes.join('\n'),
        })
      }
      if (conclusions.highlights?.length) {
        sections.push({
          title: '分维度洞察',
          rows: conclusions.highlights.map((h) => ({
            label: h.title,
            value: [h.body, ...(h.metrics || []).map((m) => `${m.label}:${m.value}`)].join(' · '),
          })),
        })
      }
    } else if (conclusions?.insufficientData) {
      sections.push({
        title: OVERVIEW_INSIGHTS_PANEL_TITLE,
        body: conclusions.executiveSummary,
      })
    }

    if (wanTouRows.length > 0) {
      sections.push({
        title: '各产品万投比（投诉工单）',
        body: `${periodLabel} · 月粒度=当月投诉÷当月订单×10000；年粒度=12 月月万投比算术平均。分母在设置 → 产品月订单数中维护。`,
        rows: wanTouRows.map((r) => {
          const parts = [
            `万投比 ${formatWanTouRatio(r.displayRatio)}`,
            `投诉 ${r.totalComplaints}`,
            r.granularityLabel,
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
    sections.push({
      title: '数据摘要',
      rows: [
        { label: '记录数', value: String(s.recordCount ?? 0) },
        { label: '负面占比', value: s.negativePct != null ? `${s.negativePct}%` : '—' },
        { label: 'Top 产品', value: s.topProduct || '—' },
        { label: '待处理', value: String(s.openCount ?? '—') },
      ],
    })
    const problems = sourceSnapshot.aggregates?.problemTypes
    if (Array.isArray(problems) && problems.length) {
      sections.push({
        title: '问题类型 Top5',
        rows: problems.slice(0, 5).map((p) => ({
          label: p.name,
          value: String(p.count),
        })),
      })
    }
    const trend = sourceSnapshot.aggregates?.monthlyTrend
    if (Array.isArray(trend) && trend.length) {
      sections.push({
        title: '月度趋势',
        rows: trend.slice(-6).map((t) => ({
          label: t.date,
          value: `${t.count}（负面 ${t.negative ?? 0}）`,
        })),
      })
    }
  }

  sections.push({
    title: '说明',
    body: '本报告由 Feedback Insights 根据洞察快照自动生成。内部资料，请勿外传。',
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
