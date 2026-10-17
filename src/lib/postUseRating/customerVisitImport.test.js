import { describe, expect, it } from 'vitest'
import {
  executeCustomerVisitImport,
  matchLibraryRecord,
  parseRatingScoreFromText,
  normalizeCustomerVisitRow,
  stableVisitRecordId,
} from './customerVisitImport.js'
import { loadVisitRecords, META_KEY_POST_USE_VISITS } from './visitRecords.js'

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
      customerName: '甲公司',
      customerCode: 'C001',
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
    expect(stableVisitRecordId('2026-05', '云专线', '客户A/C001')).toBe(
      stableVisitRecordId('2026-05', '云专线', '客户A/C001'),
    )
    expect(stableVisitRecordId('2026-05', '云专线', '客户A/C001')).not.toBe(
      stableVisitRecordId('2026-05', '云专线', '客户B/C002'),
    )
  })

  it('normalizes customer visit fields from the new template', () => {
    const row = normalizeCustomerVisitRow({
      数据月份: '2026-06',
      产品名称: '云专线',
      客户名称: '客户A',
      客户编码: 'C001',
      回访结果: '电话已回访',
      内部评估: '待跟进',
      备注: '补充说明',
    })

    expect(row.customerName).toBe('客户A')
    expect(row.customerCode).toBe('C001')
    expect(row.userInfoDetail).toBe('客户A / C001')
    expect(row.feedbackSummary).toBe('电话已回访')
    expect(row.visitFeedbackDetail).toBe('电话已回访')
    expect(row.internalEvaluationDetail).toBe('待跟进')
    expect(row.remark).toBe('补充说明')
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
          数据月份: '2026-06',
          产品名称: '云专线',
          客户名称: '客户A',
          客户编码: 'C001',
          回访结果: '客户确认当前方案无法满足',
          内部评估: '建议进入需求池',
          备注: '下月再联系',
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
    expect(updates[0].customerVisit.feedbackSummary).toBe('客户确认当前方案无法满足')
    expect(updates[0].customerVisit.customerName).toBe('客户A')
    expect(updates[0].customerVisit.customerCode).toBe('C001')
    expect(updates[0].customerVisit.internalEvaluationDetail).toBe('建议进入需求池')
    expect(updates[0].customerVisit.remark).toBe('下月再联系')
  })

  it('keeps every row for the same customer, product, and month, and reimport does not duplicate them', async () => {
    const storedMeta = new Map()
    const adapter = {
      getMeta: async (key) => storedMeta.get(key),
      putMeta: async (key, value) => storedMeta.set(key, value),
    }
    const rows = [
      {
        数据月份: '2026-06',
        产品名称: '云专线',
        客户名称: '客户A',
        客户编码: 'C001',
        回访结果: '第一次回访',
        内部评估: '需求接纳',
        备注: '甲',
      },
      {
        数据月份: '2026-06',
        产品名称: '云专线',
        客户名称: '客户A',
        客户编码: 'C001',
        回访结果: '第一次回访',
        内部评估: '需求接纳',
        备注: '甲',
      },
      {
        数据月份: '2026-06',
        产品名称: '云专线',
        客户名称: '客户A',
        客户编码: 'C001',
        回访结果: '第二次回访',
        内部评估: '待客户反馈',
        备注: '乙',
      },
    ]
    const first = await executeCustomerVisitImport({
      adapter,
      rows,
      importMonth: '2026-06',
      libraryRecords: [],
      updateRecords: async () => {},
    })

    expect(first.visitRecords).toHaveLength(3)
    expect(new Set(first.visitRecords.map((item) => item.id)).size).toBe(3)
    expect(first.visitRecords.map((item) => item.remark)).toEqual(['甲', '甲', '乙'])

    await executeCustomerVisitImport({
      adapter,
      rows,
      importMonth: '2026-06',
      libraryRecords: [],
      updateRecords: async () => {},
    })
    const saved = await loadVisitRecords(adapter)
    expect(saved).toHaveLength(3)
    expect(saved.map((item) => item.visitResult)).toEqual(['第一次回访', '第一次回访', '第二次回访'])
  })

  it('updates a previously stored single visit and appends additional rows', async () => {
    const legacyId = stableVisitRecordId('2026-06', '云专线', 'C001')
    const storedMeta = new Map([
      [META_KEY_POST_USE_VISITS, {
        records: [{
          id: legacyId,
          importMonth: '2026-06',
          visitMonth: '2026-06',
          productName: '云专线',
          customerName: '客户A',
          customerCode: 'C001',
          visitResult: '旧回访',
          internalConclusion: '待客户反馈',
        }],
      }],
    ])
    const adapter = {
      getMeta: async (key) => storedMeta.get(key),
      putMeta: async (key, value) => storedMeta.set(key, value),
    }
    await executeCustomerVisitImport({
      adapter,
      rows: [
        {
          数据月份: '2026-06',
          产品名称: '云专线',
          客户名称: '客户A',
          客户编码: 'C001',
          回访结果: '更正后的回访',
          内部评估: '需求接纳',
          备注: '甲',
        },
        {
          数据月份: '2026-06',
          产品名称: '云专线',
          客户名称: '客户A',
          客户编码: 'C001',
          回访结果: '第二条回访',
          内部评估: '待客户反馈',
          备注: '乙',
        },
      ],
      importMonth: '2026-06',
      libraryRecords: [],
      updateRecords: async () => {},
    })

    const saved = await loadVisitRecords(adapter)
    expect(saved).toHaveLength(2)
    expect(saved.find((item) => item.id === legacyId)).toMatchObject({
      visitResult: '更正后的回访',
      remark: '甲',
    })
    expect(saved.some((item) => item.id !== legacyId && item.visitResult === '第二条回访')).toBe(true)
  })
})
