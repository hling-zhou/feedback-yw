import { describe, expect, it } from 'vitest'
import { applyLlmRecommendResult } from './llmRecommend.js'
import { recommendTopics } from './recommendTopics.js'

function ticket(overrides = {}) {
  return {
    id: 'r1',
    ticketId: 'T-1',
    dataSourceType: 'complaint_ticket',
    product: '弹性公网IP',
    problemType: '带宽限速',
    painPoint: '带宽经常被限速',
    importMonth: '2026-08',
    sourceColumns: { 集团名称: '甲公司', 集团客户编码: 'C001' },
    ...overrides,
  }
}

describe('llmRecommend', () => {
  it('ignores invented ids and recomputes merged stats from candidates', () => {
    const candidates = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket(),
        ticket({ id: 'r2', ticketId: 'T-2', product: '云主机', problemType: '带宽限速' }),
        ticket({ id: 'r3', ticketId: 'T-3', product: '云主机', problemType: '带宽限速' }),
      ],
    })
    const productCard = candidates.find((card) => card.type === 'product_issue')
    const commonCard = candidates.find((card) => card.type === 'common_issue')
    expect(productCard && commonCard).toBeTruthy()

    const result = applyLlmRecommendResult(candidates, {
      cards: [
        {
          id: 'invented-topic',
          intro: '应被丢弃',
          whyNow: '应被丢弃',
        },
        {
          id: commonCard.id,
          mergeIds: [productCard.id],
          intro: '合并后的简介',
          whyNow: '合并后的理由',
        },
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(commonCard.id)
    expect(result[0].intro).toBe('合并后的简介')
    expect(result[0].whyNow).toBe('合并后的理由')
    expect(result[0].sampleSize).toBeGreaterThanOrEqual(3)
    expect(result[0].llmPolished).toBe(true)
    expect(result[0].mergeIds).toContain(productCard.id)
  })

  it('falls back to rule top cards when LLM returns nothing usable', () => {
    const candidates = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket(),
        ticket({ id: 'r2', product: '云主机', problemType: '带宽限速' }),
      ],
    })
    const result = applyLlmRecommendResult(candidates, { cards: [{ id: 'nope' }] })
    expect(result.map((card) => card.id)).toEqual(candidates.slice(0, 8).map((card) => card.id))
  })
})
