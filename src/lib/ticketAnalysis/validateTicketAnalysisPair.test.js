import { describe, expect, it } from 'vitest'
import { validateTicketAnalysisPair } from './validateTicketAnalysisPair.js'

describe('validateTicketAnalysisPair', () => {
  it('falls back to rule fields when LLM output empty', () => {
    const result = validateTicketAnalysisPair('', '', '专线不通，请排查。', '专线链路中断。')
    expect(result.customerRequest).toMatch(/专线不通/)
    expect(result.painPoint).toMatch(/链路中断/)
  })

  it('rejects pain point with leading phrase', () => {
    const result = validateTicketAnalysisPair(
      '查询云专线订单开通进度。',
      '用户希望加快开通进度。',
      '查询云专线订单开通进度。',
      '云专线订单开通进度滞后。',
    )
    expect(result.painPoint).not.toMatch(/^用户希望/)
  })

  it('compresses when total length exceeds limit', () => {
    const longRequest = '这是一段很长的客户请求内容'.repeat(8)
    const longPain = '这是一段很长的需求痛点描述'.repeat(8)
    const result = validateTicketAnalysisPair(longRequest, longPain)
    expect(result.customerRequest.length + result.painPoint.length).toBeLessThanOrEqual(200)
  })
})
