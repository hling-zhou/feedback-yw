import { describe, expect, it } from 'vitest'
import { extractKeywordCandidates, mineTagCorrectionCandidates } from './tagCorrectionMining.js'

describe('tagCorrectionMining', () => {
  it('extracts Chinese keywords and drops ticket-like ids', () => {
    const tokens = extractKeywordCandidates('工单 EIP1234567890 申请提升配额 配额超限')
    expect(tokens.some((t) => t.includes('配额'))).toBe(true)
    expect(tokens.some((t) => /1234567890/.test(t))).toBe(false)
  })

  it('mines a candidate when the same from→to appears 3 times', () => {
    const events = [1, 2, 3].map((i) => ({
      id: `e${i}`,
      recordId: `r${i}`,
      productKey: 'eip',
      dimension: /** @type {const} */ ('requestScene'),
      systemLabel: '资源操作申请',
      userLabel: '产品信息咨询',
      taggingText: '如何提升 EIP 配额，配额超限无法购买',
      createdAt: `2026-0${i}-01T00:00:00.000Z`,
      origin: /** @type {const} */ ('edit'),
    }))
    const mined = mineTagCorrectionCandidates(events)
    expect(mined).toHaveLength(1)
    expect(mined[0]).toMatchObject({
      fromLabel: '资源操作申请',
      toLabel: '产品信息咨询',
      evidenceCount: 3,
      status: 'pending',
    })
    expect(mined[0].keywords.some((k) => k.includes('配额'))).toBe(true)
  })
})
