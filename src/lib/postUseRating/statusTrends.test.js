import { describe, expect, it } from 'vitest'
import {
  buildDepartmentStatusTrends,
  normalizeDepartmentStatusTrends,
  rollupCompanyMetrics,
} from './statusTrends.js'

const row = (overrides) => ({
  dataSourceType: 'post_use_rating',
  productName: '弹性公网IP',
  ...overrides,
})

describe('department status trends', () => {
  it('plots department experience, callback satisfaction, and both three-channel averages through the current month', () => {
    const departmentRecords = [
      row({ id: 'a', importMonth: '2026-06', channel: 'sms', ratingScore: 8 }),
      row({ id: 'b', importMonth: '2026-06', channel: 'sms', ratingScore: 10 }),
      row({ id: 'c', importMonth: '2026-06', channel: 'callback', ratingScore: 10 }),
      row({ id: 'd', importMonth: '2026-05', ratingScore: null }),
      row({ id: 'e', importMonth: '2026-08', channel: 'console', ratingScore: 9 }),
    ]
    const companyRecords = [
      ...departmentRecords,
      row({ id: 'f', importMonth: '2026-06', channel: 'sms', productName: '云主机', ratingScore: 6 }),
    ]

    const trends = buildDepartmentStatusTrends({
      departmentRecords,
      companyRecords,
      productNames: ['弹性公网IP'],
      nowMonth: '2026-09',
    })

    expect(trends.experience.data.map((item) => item.date)).toEqual([
      '2026-06', '2026-07', '2026-08', '2026-09',
    ])
    expect(trends.experience.data.map((item) => item.departmentScore)).toEqual([9, null, 9, null])
    expect(trends.satisfaction.data.map((item) => item.departmentRate)).toEqual([100, null, null, null])
    expect(trends.threeChannel.data.map((item) => item.department)).toEqual([9.33, null, 9, null])
    expect(trends.threeChannel.data.map((item) => item.company)).toEqual([8.5, null, 9, null])
    expect(trends.threeChannel.areas.map((item) => item.name)).toEqual(['部门均分（三渠道）', '公司均分（三渠道）'])
    expect(trends.companyMetrics).toEqual([
      { date: '2026-06', avgScore: 8.5, totalSample: 4, productCount: 2, scoreSum: 34 },
      { date: '2026-08', avgScore: 9, totalSample: 1, productCount: 1, scoreSum: 9 },
    ])
    expect(rollupCompanyMetrics(trends.companyMetrics, {
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    })).toEqual({ avgScore: 8.5, totalSample: 4, productCount: 2 })
    expect(rollupCompanyMetrics(trends.companyMetrics, {
      startDate: '2026-06-01',
      endDate: '2026-08-31',
    })).toEqual({ avgScore: 8.6, totalSample: 5, productCount: 0 })
  })

  it('keeps the chart empty when no scored month exists', () => {
    const trends = buildDepartmentStatusTrends({
      departmentRecords: [row({ ratingScore: null, importMonth: '2026-06' })],
      companyRecords: [],
      productNames: ['弹性公网IP'],
      nowMonth: '2026-09',
    })
    expect(trends.experience.data).toEqual([])
    expect(trends.satisfaction.data).toEqual([])
    expect(trends.threeChannel.data).toEqual([])
    expect(trends.companyMetrics).toEqual([])
  })

  it('normalizes a remote payload into chart-ready series', () => {
    const trends = normalizeDepartmentStatusTrends({
      experience: { data: [{ date: '2026-06', departmentScore: 9 }] },
      satisfaction: { data: [{ date: '2026-06', departmentRate: 100 }] },
      threeChannel: { data: [{ date: '2026-06', department: 9.1, company: 8.8 }] },
    })
    expect(trends.pending).toBe(false)
    expect(trends.experience.data).toEqual([{ date: '2026-06', departmentScore: 9 }])
    expect(trends.threeChannel.areas.map((item) => item.dataKey)).toEqual(['department', 'company'])
    expect(trends.companyMetrics).toBeUndefined()
  })

  it('keeps companyMetrics when the remote payload includes monthly company totals', () => {
    const trends = normalizeDepartmentStatusTrends({
      companyMetrics: [
        { date: '2026-06', avgScore: 8.5, totalSample: 4, productCount: 2, scoreSum: 34 },
      ],
    })
    expect(trends.companyMetrics).toEqual([
      { date: '2026-06', avgScore: 8.5, totalSample: 4, productCount: 2, scoreSum: 34 },
    ])
  })
})
