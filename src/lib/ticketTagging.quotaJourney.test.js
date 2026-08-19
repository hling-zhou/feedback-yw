import { describe, expect, it } from 'vitest'
import { matchJourneyFromTextWithScore } from './ticketTagging.js'
import { EIP_USER_JOURNEY } from './journeys/eipJourney.js'
import { getTaxonomy } from './productTaxonomy.js'

describe('quota journey matching', () => {
  const samples = [
    '需要将西南-成都单资源池带宽配额提升至5120M。',
    '客户申请提升华中长沙2资源池带宽配额',
    '金牌客户申请全局资源池带宽配额提升至15360M',
  ]

  it('maps bandwidth quota requests to the quota node, not bandwidth change', () => {
    for (const text of samples) {
      const matched = matchJourneyFromTextWithScore(text, EIP_USER_JOURNEY, 'eip')
      expect(matched.journeyL1).toBe('开通与申领')
      expect(matched.journeyL2).toBe('配额与权限')
    }
  })

  it('maps quota requests on the loaded EIP catalog to the quota child', () => {
    const tax = getTaxonomy('弹性公网IP', 'eip')
    for (const text of samples) {
      const matched = matchJourneyFromTextWithScore(text, tax.journeys, 'eip', {
        problemType: '配额与权限申请',
      })
      expect(matched.journeyL1).toMatch(/开通与申领|产品订改续/)
      expect(matched.journeyL2).toMatch(/配额/)
      expect(matched.journeyL2).not.toMatch(/升降配|变更其他/)
    }
  })
})
