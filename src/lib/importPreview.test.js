import { describe, it, expect } from 'vitest'
import { buildTaggingPreviewRows, pickRowsForQuotePreview } from './importPreview.js'

describe('buildTaggingPreviewRows', () => {
  it('returns up to 3 tagging preview samples', () => {
    const rows = buildTaggingPreviewRows(
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
    expect(rows[0].taggingText).toContain('已重置')
    expect(rows[0].ticketId).toBe('T1')
  })

  it('pickRowsForQuotePreview skips empty rows', () => {
    const picked = pickRowsForQuotePreview(
      [{ rawText: '' }, { rawText: '有内容' }, { commentText: '评' }],
      2,
    )
    expect(picked).toHaveLength(2)
  })
})
