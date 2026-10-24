import { describe, it, expect } from 'vitest'
import { buildPostUseRatingExportRows } from './postUseRatingExport.js'

describe('buildPostUseRatingExportRows', () => {
  it('builds 8-column rows from post_use_rating records', () => {
    const records = [
      {
        importMonth: '2026-10',
        product: '云专线',
        createdAt: '2026-10-15T08:30:00Z',
        channel: 'sms',
        sourceSubType: 'sms_gateway',
        ratingScore: 10,
        customerName: '测试客户A',
        customerCode: 'C001',
        commentText: '非常满意',
        rawText: '非常满意',
      },
    ]
    const rows = buildPostUseRatingExportRows(records)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row['数据月份']).toBe('2026-10')
    expect(row['产品名称']).toBe('云专线')
    expect(row['评价时间']).toBe('2026-10-15T08:30:00Z')
    expect(row['渠道']).toBe('短信（sms_gateway）')
    expect(row['评分']).toBe(10)
    expect(row['客户名称']).toBe('测试客户A')
    expect(row['客户编码']).toBe('C001')
    expect(row['评价原文']).toBe('非常满意')
  })

  it('falls back to rawText when commentText is empty', () => {
    const rows = buildPostUseRatingExportRows([
      { commentText: '', rawText: '一般般' },
    ])
    expect(rows[0]['评价原文']).toBe('一般般')
  })

  it('falls back to productName when product is empty', () => {
    const rows = buildPostUseRatingExportRows([
      { product: '', productName: '云监控' },
    ])
    expect(rows[0]['产品名称']).toBe('云监控')
  })

  it('maps channel to Chinese label', () => {
    const rows = buildPostUseRatingExportRows([
      { channel: 'web' },
      { channel: 'app' },
      { channel: 'unknown' },
      { channel: '' },
    ])
    expect(rows[0]['渠道']).toBe('官网')
    expect(rows[1]['渠道']).toBe('APP')
    expect(rows[2]['渠道']).toBe('unknown')
    expect(rows[3]['渠道']).toBe('')
  })

  it('channel without subType shows only channel label', () => {
    const rows = buildPostUseRatingExportRows([
      { channel: 'sms', sourceSubType: 'sms' },
    ])
    expect(rows[0]['渠道']).toBe('短信')
  })

  it('handles empty records array', () => {
    const rows = buildPostUseRatingExportRows([])
    expect(rows).toEqual([])
  })

  it('handles null ratingScore', () => {
    const rows = buildPostUseRatingExportRows([
      { ratingScore: null },
    ])
    expect(rows[0]['评分']).toBe('')
  })

  it('handles record with all empty fields', () => {
    const rows = buildPostUseRatingExportRows([{}])
    expect(rows[0]['数据月份']).toBe('')
    expect(rows[0]['产品名称']).toBe('')
    expect(rows[0]['评分']).toBe('')
    expect(rows[0]['评价原文']).toBe('')
  })
})
