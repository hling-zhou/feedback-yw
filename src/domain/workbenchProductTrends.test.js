import { describe, expect, it } from 'vitest'
import {
  monthlyAvgScoreByProduct,
  monthlyTenPointRateByProduct,
  normalizeTo100,
  buildProductExperienceTrend,
} from './workbenchProductTrends.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/** @param {Partial<FeedbackRecord>} over */
function makeTicket(over = {}) {
  return {
    ticketId: 't1',
    product: '弹性公网IP',
    dataSourceType: 'complaint_ticket',
    importMonth: '2026-01',
    sentiment: 'negative',
    status: 'open',
    ...over,
  }
}

/** @param {Partial<FeedbackRecord>} over */
function makeRating(over = {}) {
  return {
    id: 'r1',
    product: '弹性公网IP',
    dataSourceType: 'post_use_rating',
    sourceSubType: 'sms_survey',
    channel: 'sms',
    importMonth: '2026-01',
    ratingScore: 9,
    ...over,
  }
}

/** @param {Partial<FeedbackRecord>} over */
function makeFollowUp(score, over = {}) {
  return makeTicket({
    followUpSatisfaction: { followUpSuccessful: true, score, importMonth: over.importMonth || '2026-01' },
    ...over,
  })
}

describe('normalizeTo100', () => {
  it('min-max 归一到 0–100', () => {
    expect(normalizeTo100([10, 20, 30])).toEqual([0, 50, 100])
  })
  it('null 保留', () => {
    expect(normalizeTo100([10, null, 30])).toEqual([0, null, 100])
  })
  it('min===max 返回常数 50', () => {
    expect(normalizeTo100([7, 7, 7])).toEqual([50, 50, 50])
  })
  it('全 null 返回全 null', () => {
    expect(normalizeTo100([null, null])).toEqual([null, null])
  })
  it('空数组返回空', () => {
    expect(normalizeTo100([])).toEqual([])
  })
})

describe('monthlyAvgScoreByProduct', () => {
  it('按月×产品算均分，无样本为 null', () => {
    const records = [
      makeRating({ importMonth: '2026-01', ratingScore: 8 }),
      makeRating({ importMonth: '2026-01', ratingScore: 10 }),
      makeRating({ importMonth: '2026-02', ratingScore: 9, product: 'VPC' }),
    ]
    const { data, products } = monthlyAvgScoreByProduct(records)
    expect(products.map((p) => p.name).sort()).toEqual(['VPC', '弹性公网IP'])
    const jan = data.find((r) => r.date === '2026-01')
    expect(jan['弹性公网IP']).toBe(9) // (8+10)/2
    expect(jan.VPC).toBeNull()
  })
  it('跳过非数值评分', () => {
    const records = [makeRating({ ratingScore: NaN }), makeRating({ ratingScore: 7 })]
    const { data } = monthlyAvgScoreByProduct(records)
    expect(data[0]['弹性公网IP']).toBe(7)
  })
})

describe('monthlyTenPointRateByProduct', () => {
  it('按月×产品算 10 分率', () => {
    const records = [
      makeFollowUp(10, { importMonth: '2026-01' }),
      makeFollowUp(9, { importMonth: '2026-01' }),
      makeFollowUp(10, { importMonth: '2026-02' }),
    ]
    const { data } = monthlyTenPointRateByProduct(records)
    const jan = data.find((r) => r.date === '2026-01')
    expect(jan['弹性公网IP']).toBe(50) // 1/2 = 50%
    const feb = data.find((r) => r.date === '2026-02')
    expect(feb['弹性公网IP']).toBe(100)
  })
  it('跳过无回访满意度的记录', () => {
    const records = [makeTicket({ importMonth: '2026-01' }), makeFollowUp(10, { importMonth: '2026-01' })]
    const { data } = monthlyTenPointRateByProduct(records)
    const jan = data.find((r) => r.date === '2026-01')
    expect(jan['弹性公网IP']).toBe(100) // 仅 1 条有效
  })
})

describe('buildProductExperienceTrend', () => {
  it('单产品 4 指标月份对齐 + 归一', () => {
    const feedbacks = [
      makeTicket({ importMonth: '2026-01', dataSourceType: 'complaint_ticket' }),
      makeTicket({ importMonth: '2026-02', dataSourceType: 'complaint_ticket' }),
      makeTicket({ importMonth: '2026-01', dataSourceType: 'consultation_ticket' }),
      makeRating({ importMonth: '2026-01', ratingScore: 8 }),
      makeRating({ importMonth: '2026-02', ratingScore: 10 }),
      makeFollowUp(10, { importMonth: '2026-01' }),
      makeFollowUp(9, { importMonth: '2026-02' }),
    ]
    const { months, series, hasAnyData } = buildProductExperienceTrend(feedbacks, '弹性公网IP')
    expect(months).toEqual(['2026-01', '2026-02'])
    expect(hasAnyData).toBe(true)
    const complaint = series.find((s) => s.key === 'complaint')
    // 2026-01: 1 显式投诉 + 1 回访投诉工单 = 2
    expect(complaint.raw['2026-01']).toBe(2)
    expect(complaint.raw['2026-02']).toBe(2)
    const consultation = series.find((s) => s.key === 'consultation')
    expect(consultation.raw['2026-01']).toBe(1)
    expect(consultation.raw['2026-02']).toBeNull()
    const postUse = series.find((s) => s.key === 'postUseScore')
    expect(postUse.raw['2026-01']).toBe(8)
    expect(postUse.raw['2026-02']).toBe(10)
    const sat = series.find((s) => s.key === 'satisfaction')
    expect(sat.raw['2026-01']).toBe(100)
    expect(sat.raw['2026-02']).toBe(0)
  })
  it('缺数据的指标 raw 为 null，归一为 null', () => {
    const feedbacks = [makeTicket({ importMonth: '2026-01', dataSourceType: 'complaint_ticket' })]
    const { series } = buildProductExperienceTrend(feedbacks, '弹性公网IP')
    const postUse = series.find((s) => s.key === 'postUseScore')
    expect(postUse.raw['2026-01']).toBeNull()
    expect(postUse.normalized['2026-01']).toBeNull()
  })
  it('只取最近 limit 个月', () => {
    const feedbacks = []
    for (let i = 1; i <= 15; i += 1) {
      const month = i <= 9 ? `2025-0${i}` : `2025-${i}` // 2025-01..2025-09, 2025-10..2025-15
      feedbacks.push(makeTicket({ importMonth: month, dataSourceType: 'complaint_ticket' }))
    }
    const { months } = buildProductExperienceTrend(feedbacks, '弹性公网IP', { limit: 12 })
    expect(months.length).toBeLessThanOrEqual(12)
  })
  it('产品不匹配返回空数据', () => {
    const feedbacks = [makeTicket({ importMonth: '2026-01', product: 'VPC' })]
    const { months, series, hasAnyData } = buildProductExperienceTrend(feedbacks, '弹性公网IP')
    expect(months).toEqual([])
    expect(hasAnyData).toBe(false)
    expect(series).toHaveLength(4)
  })
})
