import { describe, it, expect } from 'vitest'
import { buildReportModel } from './buildReportModel.js'

describe('buildReportModel', () => {
  it('includes insight conclusions sections for overview scope', () => {
    const model = buildReportModel({
      scope: 'overview',
      period: { label: '2025-06', granularity: 'month', startDate: '2025-06-01', endDate: '2025-06-30' },
      overview: {
        sourceSummaries: {},
        crossSourceMetrics: { totalRecords: 10 },
        conclusions: {
          generatedAt: new Date().toISOString(),
          source: 'hybrid',
          sampleSize: 8,
          periodLabel: '2025-06',
          executiveSummary: '本期投诉集中在公网访问。',
          highlights: [
            {
              id: 'h1',
              type: 'journey',
              title: '旅程热点',
              body: '业务使用与连通环节工单最多。',
              metrics: [{ label: '工单数', value: '5' }],
            },
          ],
          recommendations: [
            { id: 'r1', priority: 'high', category: 'product', text: '上线连通性自助诊断工具。' },
          ],
          dataCoverageNotes: [],
        },
      },
    })

    const titles = model.sections.map((s) => s.title)
    expect(titles).toContain('行动建议')
    expect(titles).not.toContain('周期洞察 · 摘要')
    expect(titles).not.toContain('分维度洞察')
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
