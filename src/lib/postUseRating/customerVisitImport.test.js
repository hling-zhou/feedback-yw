import { describe, expect, it } from 'vitest'
import {
  executeCustomerVisitImport,
  matchLibraryRecord,
  parseRatingScoreFromText,
  normalizeCustomerVisitRow,
  stableVisitRecordId,
} from './customerVisitImport.js'

describe('customerVisitImport', () => {
  it('parseRatingScoreFromText extracts leading score', () => {
    expect(parseRatingScoreFromText('1分*1')).toBe(1)
    expect(parseRatingScoreFromText('10分')).toBe(10)
    expect(parseRatingScoreFromText('8.5分（备注）')).toBe(8.5)
    expect(parseRatingScoreFromText('')).toBeNaN()
  })

  it('matchLibraryRecord soft-matches by channel+product+customer', () => {
    const candidates = [
      {
        id: 'old',
        dataSourceType: 'post_use_rating',
        channel: 'console',
        productName: '弹性公网IP',
        customerName: '甲公司',
        customerCode: 'C001',
        ratingScore: 1,
        importMonth: '2026-05',
        createdAt: '2026-05-01',
      },
      {
        id: 'hit',
        dataSourceType: 'post_use_rating',
        channel: 'console',
        productName: '弹性公网IP',
        customerName: '甲公司',
        customerCode: 'C001',
        ratingScore: 1,
        importMonth: '2026-05',
        createdAt: '2026-05-20',
      },
      {
        id: 'cb',
        dataSourceType: 'post_use_rating',
        channel: 'callback',
        productName: '弹性公网IP',
        customerName: '甲公司',
        ratingScore: 1,
      },
    ]

    const visit = normalizeCustomerVisitRow({
      visitMonth: '2026-05',
      productName: '弹性公网IP',
      scoreSource: '控制台评分',
      ratingText: '1分*1',
      userInfo: '甲公司 C001 订单123',
    })

    const result = matchLibraryRecord(candidates, visit)
    expect(result.record?.id).toBe('hit')
    expect(result.matchedBy).toBe('channel+product+customer')
    expect(result.multiMatch).toBe(true)
    expect(result.skipAttach).toBe(false)

    const callbackVisit = {
      ...visit,
      scoreSource: '投诉回访',
      channel: 'callback',
    }
    const cb = matchLibraryRecord(candidates, callbackVisit)
    expect(cb.skipAttach).toBe(true)
    expect(cb.record).toBeNull()
  })

  it('stableVisitRecordId is deterministic for same keys', () => {
    expect(stableVisitRecordId('2026-05', '云专线', '客户A')).toBe(
      stableVisitRecordId('2026-05', '云专线', '客户A'),
    )
    expect(stableVisitRecordId('2026-05', '云专线', '客户A')).not.toBe(
      stableVisitRecordId('2026-05', '云专线', '客户B'),
    )
  })

  it('normalizes report-detail visit fields with fallback values', () => {
    const row = normalizeCustomerVisitRow({
      月份: '2026-06',
      产品名称: '云专线',
      用户反馈原文: '希望支持跨用户变更',
      用户信息: '客户A',
      回访结果: '电话已回访',
      内部评估: '待跟进',
    })

    expect(row.userFeedbackText).toBe('希望支持跨用户变更')
    expect(row.userInfoDetail).toBe('客户A')
    expect(row.visitFeedbackDetail).toBe('电话已回访')
    expect(row.internalEvaluationDetail).toBe('待跟进')
  })

  it('attaches imported customer visit to the matched post-use rating', async () => {
    const storedMeta = new Map()
    const updates = []
    const libraryRecords = [
      {
        id: 'rating-1',
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        productName: '云专线',
        customerName: '客户A',
        ratingScore: 8,
        importMonth: '2026-06',
      },
    ]
    const result = await executeCustomerVisitImport({
      adapter: {
        getMeta: async (key) => storedMeta.get(key),
        putMeta: async (key, value) => storedMeta.set(key, value),
      },
      rows: [
        {
          月份: '2026-06',
          产品名称: '云专线',
          用户反馈原文: '客户希望支持跨用户变更',
          用户信息: '客户A 订单001',
          回访结果: '客户确认当前方案无法满足',
          内部评估: '建议进入需求池',
        },
      ],
      importMonth: '2026-06',
      libraryRecords,
      updateRecords: async (records) => updates.push(...records),
    })

    expect(result.matchedCount).toBe(1)
    expect(result.visitRecords[0].importMonth).toBe('2026-06')
    expect(result.detailedFieldMissingCount).toBe(0)
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe('rating-1')
    expect(updates[0].customerVisit.feedbackSummary).toBe('客户希望支持跨用户变更')
    expect(updates[0].customerVisit.userFeedbackText).toBe('客户希望支持跨用户变更')
    expect(updates[0].customerVisit.internalEvaluationDetail).toBe('建议进入需求池')
  })
})
