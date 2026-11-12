import { describe, expect, it } from 'vitest'
import { buildPeriodSpec } from '../domain/insightPeriod.js'
import { buildPostUseStoryModel } from './postUseRating/storyModel.js'
import {
  WORKBENCH_AGGREGATE_VERSION,
  applyPostUseWorkbenchAggregate,
  applyTicketWorkbenchAggregate,
  pickTicketWorkbenchSlice,
  buildOverviewWorkbenchAggregate,
  buildPostUseWorkbenchAggregate,
  buildTicketWorkbenchAggregate,
  pickOverviewJourney,
  resolveWorkbenchHistoryMonthRange,
} from './workbenchStoredAggregates.js'

const june = {
  ...buildPeriodSpec({ granularity: 'month', year: 2026, month: 6 }),
  id: 'period:month:2026-06',
  label: '2026年6月',
  startDate: '2026-06-01',
  endDate: '2026-06-30',
}

function ticket(id, overrides = {}) {
  return {
    id,
    dataSourceType: 'complaint_ticket',
    product: '弹性公网IP',
    importMonth: '2026-06',
    sentiment: 'negative',
    journeyL1: '开通',
    journeyL2: '开通/创建',
    problemType: '无法开通',
    complaintCauseL1Final: '客户体验类',
    ticketId: `T-${id}`,
    ...overrides,
  }
}

describe('workbench stored aggregates', () => {
  it('includes previous December when the selected month is January', () => {
    const january = {
      ...buildPeriodSpec({ granularity: 'month', year: 2026, month: 1 }),
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    }
    const range = resolveWorkbenchHistoryMonthRange(january)
    expect(range.startMonth).toBe('2025-12')
    expect(range.endMonth).toBe('2026-12')
    expect(range.previousMonths).toEqual(['2025-12'])
  })

  it('stores ticket metrics for all products and a selected product, without journey ticket ids', () => {
    const records = [
      ticket('c1'),
      ticket('c2', { product: '云专线', journeyL1: '使用' }),
      ticket('c3', { importMonth: '2026-05', sentiment: 'neutral' }),
    ]
    const workbench = buildTicketWorkbenchAggregate({
      sourceType: 'complaint_ticket',
      period: june,
      records: records.filter((row) => row.importMonth === '2026-06'),
      historyRecords: records,
    })
    expect(workbench.version).toBe(WORKBENCH_AGGREGATE_VERSION)
    expect(workbench.all.metrics.total).toBe(2)
    expect(workbench.byProduct['弹性公网IP'].metrics.total).toBe(1)
    expect(workbench.byProduct['云专线'].metrics.total).toBe(1)
    expect(workbench.byProduct['弹性公网IP'].journey.layout).toBe('lifecycle')
    expect(workbench.all.journey.changeRows.some((row) => row.journeyL1 === '开通' && row.previousCount === 1)).toBe(true)
    expect(workbench.all.journey.changeRows.every((row) => !('ticketIds' in row))).toBe(true)
    expect(JSON.stringify(workbench.byProduct['弹性公网IP'].journey)).not.toContain('"ticketIds"')
  })

  it('overlays stored ticket volume trend onto a live story model', () => {
    const live = {
      overview: { metrics: { total: 0 }, productOverview: [], wanTou: { trend: [] } },
      trendsAndChanges: { volumeTrend: [], complaintVolumeWanTou: [], changes: [], highlights: [] },
      drivers: { journeyLayout: 'empty', journeyStages: [], journeyChangeHighlights: [] },
    }
    const workbench = buildTicketWorkbenchAggregate({
      sourceType: 'complaint_ticket',
      period: june,
      records: [ticket('c1')],
      historyRecords: [ticket('c1'), ticket('c0', { importMonth: '2026-05' })],
    })
    const merged = applyTicketWorkbenchAggregate(live, workbench, '弹性公网IP')
    expect(merged.overview.metrics.total).toBe(1)
    expect(merged.drivers.journeyStages.length).toBeGreaterThan(0)
    expect(pickTicketWorkbenchSlice(workbench, '不存在的产品')).toBeNull()
    expect(applyTicketWorkbenchAggregate(live, workbench, '不存在的产品').overview.metrics.total).toBe(0)
  })

  it('recalculates stored monthly ratios when order volumes are added after the snapshot', () => {
    const records = [
      ticket('may', { importMonth: '2026-05' }),
      ticket('june'),
    ]
    const workbench = buildTicketWorkbenchAggregate({
      sourceType: 'complaint_ticket',
      period: june,
      records: [records[1]],
      historyRecords: records,
      orderVolumes: [{ productKey: 'eip', month: '2026-06', orderCount: 10000 }],
    })
    expect(workbench.byProduct['弹性公网IP'].complaintVolumeWanTou.find((row) => row.date === '2026-05').ratio).toBeNull()
    const live = {
      overview: { metrics: {}, productOverview: [], wanTou: { productKey: 'eip' } },
      trendsAndChanges: { volumeTrend: [], complaintVolumeWanTou: [], changes: [], highlights: [] },
      drivers: { journeyLayout: 'empty', journeyStages: [], journeyChangeHighlights: [] },
    }
    const merged = applyTicketWorkbenchAggregate(
      live,
      workbench,
      '弹性公网IP',
      [
        { productKey: 'eip', month: '2026-05', orderCount: 5000 },
        { productKey: 'eip', month: '2026-06', orderCount: 10000 },
      ],
      [{ productKey: 'eip', year: 2026, customerExperienceWanTouTarget: 1.5 }],
      2026,
    )
    expect(merged.trendsAndChanges.complaintVolumeWanTou.find((row) => row.date === '2026-05'))
      .toMatchObject({ count: 1, orders: 5000, ratio: 2 })
    expect(merged.overview.wanTou.latest).toMatchObject({ date: '2026-06', ratio: 1 })
    expect(merged.trendsAndChanges.wanTouTarget).toBe(1.5)
  })

  it('stores post-use analysis-scoped count and yunwang KPIs separately from company', () => {
    const catalog = [
      { key: 'eip', name: '弹性公网IP', analysisPostUseRating: true, specs: [] },
      { key: 'ecs', name: '云主机', analysisPostUseRating: false, specs: [] },
    ]
    const records = [
      { id: 'a', dataSourceType: 'post_use_rating', productName: '弹性公网IP', ratingScore: 10, channel: 'sms', importMonth: '2026-06' },
      { id: 'b', dataSourceType: 'post_use_rating', productName: '弹性公网IP', ratingScore: 8, channel: 'console', importMonth: '2026-06' },
      { id: 'c', dataSourceType: 'post_use_rating', productName: '云主机', ratingScore: 1, channel: 'sms', importMonth: '2026-06' },
    ]
    const workbench = buildPostUseWorkbenchAggregate({ period: june, records, catalog })
    expect(workbench.analysisScopedCount).toBe(2)
    expect(workbench.yunwang.totalSample).toBe(2)
    expect(workbench.yunwang.avgScore).toBe(9)
    expect(workbench.company.totalSample).toBe(3)
    expect(workbench.company.avgScore).toBe(6.33)
    const live = {
      metrics: {
        internalExperience: { avgScore: 0, totalSample: 0 },
        satisfaction: { rate: 0, totalSample: 0 },
        external: { yunwang: {}, company: {} },
      },
      productOverview: [],
    }
    const merged = applyPostUseWorkbenchAggregate(live, workbench)
    expect(merged.metrics.external.yunwang.totalSample).toBe(2)
    expect(merged.metrics.external.company.totalSample).toBe(3)
  })

  it('keeps current visit counts when applying a rating-only workbench snapshot', () => {
    const catalog = [{ key: 'eip', name: '弹性公网IP', analysisPostUseRating: true, specs: [] }]
    const records = [{ id: 'visit-count-rating', dataSourceType: 'post_use_rating', productName: '弹性公网IP', ratingScore: 10, channel: 'sms', importMonth: '2026-06' }]
    const visits = [{ id: 'visit-count-visit', productName: '弹性公网IP', importMonth: '2026-06' }]
    const live = buildPostUseStoryModel({ records, allRecords: records, visits, productNames: ['弹性公网IP'], period: june })
    const stored = buildPostUseWorkbenchAggregate({ period: june, records, catalog })
    const merged = applyPostUseWorkbenchAggregate(live, stored)
    expect(stored.productOverview[0].visitEvidenceCount).toBe(0)
    expect(merged.productOverview[0].visitEvidenceCount).toBe(1)
    expect(merged.productOverview[0].visitEvidenceIds).toEqual(['visit-count-visit'])
  })

  it('stores overview journey previous-month counts per product and source filter', () => {
    const feedbacks = [
      ticket('now', { importMonth: '2026-06' }),
      ticket('prev', { importMonth: '2026-05' }),
      {
        id: 'q1',
        dataSourceType: 'consultation_ticket',
        product: '弹性公网IP',
        importMonth: '2026-06',
        journeyL1: '开通',
        ticketId: 'Q-1',
      },
    ]
    const workbench = buildOverviewWorkbenchAggregate({ period: june, feedbacks })
    const journey = pickOverviewJourney(workbench, 'complaint', '弹性公网IP')
    expect(journey?.layout).toBe('lifecycle')
    const allComplaint = pickOverviewJourney(workbench, 'complaint', '')
    expect(allComplaint?.changeRows.some((row) => row.journeyL1 === '开通' && row.currentCount === 1 && row.previousCount === 1)).toBe(true)
    expect(JSON.stringify(workbench.journey)).not.toContain('"ticketIds"')
  })

  it('counts every complaint in overview wan-tou while retaining the customer-experience subset', () => {
    const feedbacks = [
      ticket('cx'),
      ticket('other', { complaintCauseL1Final: '非客户体验类' }),
      ticket('consultation', { dataSourceType: 'consultation_ticket' }),
    ]
    const workbench = buildOverviewWorkbenchAggregate({
      period: june,
      feedbacks,
      orderVolumes: [{ productKey: 'eip', month: '2026-06', orderCount: 10000 }],
    })
    expect(workbench.wanTouRows).toEqual([
      expect.objectContaining({
        productName: '弹性公网IP',
        totalComplaints: 2,
        totalCxComplaints: 1,
        displayRatio: 2,
        displayCxRatio: 1,
      }),
    ])
  })
})
