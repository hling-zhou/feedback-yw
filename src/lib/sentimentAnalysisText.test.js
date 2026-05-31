import { describe, expect, it } from 'vitest'
import { buildSentimentAnalysisText } from './sentimentAnalysisText.js'

describe('buildSentimentAnalysisText', () => {
  it('prefers customerRequest and painPoint', () => {
    const text = buildSentimentAnalysisText({
      customerRequest: '端口不通',
      painPoint: '业务无法上线',
      customerQuote: '旧原话',
      rawText: '受理全文',
    })
    expect(text).toContain('端口不通')
    expect(text).toContain('业务无法上线')
    expect(text).not.toContain('旧原话')
  })

  it('falls back to legacy fields when request and pain are empty', () => {
    expect(
      buildSentimentAnalysisText({
        customerQuote: '原话',
        rawText: '全文',
      }),
    ).toBe('原话')
  })
})
