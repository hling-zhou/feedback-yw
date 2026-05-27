import { describe, it, expect } from 'vitest'
import { buildQuotePreviewRows, pickRowsForQuotePreview } from './importPreview.js'

describe('buildQuotePreviewRows', () => {
  it('returns up to 3 quote preview samples', () => {
    const rows = buildQuotePreviewRows(
      [
        {
          ticketId: 'T1',
          rawText: '【受理内容】\n无法登录\n\n【处理意见】\n已重置',
          handlingText: '已重置',
        },
        { ticketId: 'T2', commentText: '加载慢' },
        { ticketId: 'T3', openText: '希望加功能' },
        { ticketId: 'T4', rawText: '多余' },
      ],
      { dataSourceType: 'complaint_ticket', settings: { useRegex: true } },
    )
    expect(rows).toHaveLength(3)
    expect(rows[0].customerQuote).toContain('无法登录')
    expect(rows[0].modeLabel).toContain('结构化')
    expect(rows[0].quoteExtractionVersion).toMatch(/^qe-/)
  })

  it('pickRowsForQuotePreview skips empty rows', () => {
    const picked = pickRowsForQuotePreview(
      [{ rawText: '' }, { rawText: '有内容' }, { commentText: '评' }],
      2,
    )
    expect(picked).toHaveLength(2)
  })
})
