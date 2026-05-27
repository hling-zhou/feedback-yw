import { describe, it, expect } from 'vitest'
import { buildQuoteComparisonRows } from './quoteComparisonExport.js'
import { computeQuoteExtractionVersion } from './quoteExtraction.js'

describe('quoteComparisonExport', () => {
  it('builds comparison rows for stale records only', () => {
    const version = computeQuoteExtractionVersion({ useRegex: true })
    const rows = buildQuoteComparisonRows(
      [
        {
          id: '1',
          ticketId: 'T1',
          customerQuote: '旧原话',
          rawText: '【受理内容】\n新内容',
          dataSourceType: 'complaint_ticket',
        },
        {
          id: '2',
          ticketId: 'T2',
          customerQuote: '一致',
          rawText: '一致',
          quoteExtractionVersion: version,
          dataSourceType: 'post_use_rating',
          commentText: '一致',
        },
      ],
      { useRegex: true },
      { staleOnly: true },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].工单号).toBe('T1')
    expect(rows[0].是否变更).toBe('是')
  })
})
