import { describe, it, expect } from 'vitest'
import { buildReportModel } from './buildReportModel.js'

describe('buildReportModel', () => {
  it('includes V2 action recommendations and source overview for overview scope', () => {
    const model = buildReportModel({
      scope: 'overview',
      period: { label: '2025-06', granularity: 'month', startDate: '2025-06-01', endDate: '2025-06-30' },
      overview: {
        sourceSummaries: {
          complaint_ticket: {
            recordCount: 5,
            negativePct: 40,
            maxMomGrowthProduct: '云主机',
          },
        },
        crossSourceMetrics: { totalRecords: 10 },
        conclusions: {
          generatedAt: new Date().toISOString(),
          source: 'hybrid',
          sampleSize: 8,
          periodLabel: '2025-06',
          recommendationsMeta: { recommendationEngine: 'pain_cluster_v2' },
          recommendations: [
            {
              id: 'r1',
              priority: 'high',
              category: 'product',
              summary: '安全组未放行导致端口不通',
              text: '安全组未放行导致端口不通',
              scope: { product: '弹性公网 IP' },
              sections: {
                executiveSummary: '安全组未放行导致端口不通',
                painClusterScores: {
                  priorityScore: 4.2,
                  rank: 1,
                  totalFinal: 5,
                  breadthScore: 3,
                  sharePct: 12,
                  ticketCount: 6,
                  harmScore: 4,
                  maxSeverity: 5,
                  p90Emotion: 3,
                  sourceDistributionLines: ['投诉：6件（占比100%）'],
                  customerTierSummary: '金牌1',
                },
                productActions: ['控制台增加一键修复引导'],
                verification: { metrics: ['复发率'], userValidation: '回访' },
              },
            },
          ],
          dataCoverageNotes: [],
        },
      },
    })

    const titles = model.sections.map((s) => s.title)
    expect(titles).toContain('行动建议')
    expect(titles).toContain('各数据来源概览')
    expect(titles).not.toContain('周期洞察 · 摘要')
    expect(titles).not.toContain('分维度洞察')
    expect(titles).not.toContain('跨源月度趋势（条数）')

    const recSection = model.sections.find((s) => s.title === '行动建议')
    expect(recSection?.rows?.[0]?.value).toMatch(/优先级评定/)
    expect(recSection?.rows?.[0]?.value).toMatch(/可执行改进建议/)
    expect(recSection?.rows?.[0]?.label).toMatch(/高优先级/)
    expect(recSection?.rows?.[0]?.label).toMatch(/弹性公网 IP/)
  })

  it('excludes legacy planning recommendations from overview export', () => {
    const model = buildReportModel({
      scope: 'overview',
      period: { label: '2025-06', granularity: 'month', startDate: '2025-06-01', endDate: '2025-06-30' },
      overview: {
        sourceSummaries: {},
        crossSourceMetrics: { totalRecords: 5 },
        conclusions: {
          recommendationsMeta: { recommendationEngine: 'legacy_planning' },
          recommendations: [{ id: 'old', summary: '旧版建议', signalType: 'journey' }],
        },
      },
    })
    expect(model.sections.some((s) => s.title === '行动建议')).toBe(false)
  })

  it('includes source snapshot distribution sections for ticket scope', () => {
    const model = buildReportModel({
      scope: 'complaint_ticket',
      period: { label: '2025-06', granularity: 'month', startDate: '2025-06-01', endDate: '2025-06-30' },
      sourceSnapshot: {
        summary: { recordCount: 12, negativePct: 30 },
        aggregates: {
          products: [{ name: '云主机', count: 8 }],
          sentiment: [{ name: '负面', value: 4, pct: 33 }],
          monthlyTrend: [
            { date: '2025-05', count: 5 },
            { date: '2025-06', count: 7 },
          ],
          requestScenes: [{ name: '故障', count: 3 }],
          problemTypes: [{ name: '性能', count: 2 }],
        },
      },
    })
    const titles = model.sections.map((s) => s.title)
    expect(titles).toContain('产品分布（周期内）')
    expect(titles).toContain('客户情绪分布')
    expect(titles).toContain('月度趋势摘要')
    expect(titles).toContain('请求场景 Top')
  })

  it('includes wan tou ratio section when rows provided', () => {
    const model = buildReportModel({
      scope: 'overview',
      period: { label: '2025-06', granularity: 'month', startDate: '2025-06-01', endDate: '2025-06-30' },
      overview: { sourceSummaries: {}, crossSourceMetrics: { totalRecords: 5 } },
      wanTouRows: [
        {
          productName: '云主机',
          displayRatio: 42.5,
          totalComplaints: 10,
          granularityLabel: '月粒度',
          missingOrderMonths: [],
        },
      ],
    })
    const section = model.sections.find((s) => s.title === '各产品万投比（投诉工单）')
    expect(section).toBeDefined()
    expect(section?.rows?.[0]?.label).toBe('云主机')
    expect(section?.rows?.[0]?.value).toMatch(/42\.50/)
  })
})
