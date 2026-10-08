import { describe, expect, it } from 'vitest'
import { buildSentimentAnalysisText } from './sentimentAnalysisText.js'

describe('buildSentimentAnalysisText', () => {
  it('uses the customer acceptance text instead of the summary', () => {
    const text = buildSentimentAnalysisText({
      customerRequest: '端口不通',
      painPoint: '业务无法上线',
      rawText: '【受理内容】\n这服务太差了\n【处理意见】\n已安排处理',
    })
    expect(text).toContain('太差')
    expect(text).not.toContain('端口不通')
    expect(text).not.toContain('已安排处理')
  })

  it('falls back to the quote when acceptance text is absent', () => {
    expect(
      buildSentimentAnalysisText({
        customerQuote: '原话',
        customerRequest: '摘要',
      }),
    ).toBe('原话')
  })

  it('falls back to the summary when no original text exists', () => {
    const text = buildSentimentAnalysisText({
      customerRequest: '端口不通',
      painPoint: '业务无法上线',
    })
    expect(text).toContain('端口不通')
    expect(text).toContain('业务无法上线')
  })
})
