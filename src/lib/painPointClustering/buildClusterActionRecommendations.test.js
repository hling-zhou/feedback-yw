import { describe, expect, it } from 'vitest'
import {
  buildClusterActionRecommendations,
  formatCustomerTierSummary,
  mapClusterPriorityScore,
} from './buildClusterActionRecommendations.js'

function makeRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    painPoint: '安全组规则未放行导致公网端口无法访问',
    problemType: '配置与操作',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    sentiment: 'negative',
    optimizationProduct: '控制台增加安全组规则冲突检测与一键修复引导',
    ...overrides,
  }
}

describe('buildClusterActionRecommendations', () => {
  it('mapClusterPriorityScore maps score bands', () => {
    expect(mapClusterPriorityScore(4.5)).toBe('high')
    expect(mapClusterPriorityScore(3.2)).toBe('medium')
    expect(mapClusterPriorityScore(2)).toBe('low')
  })

  it('formatCustomerTierSummary skips zero tiers', () => {
    expect(formatCustomerTierSummary({ 金牌: 2, 银牌: 0, 铜牌: 1, 普通: 0 })).toBe('金牌2，铜牌1')
  })

  it('builds V2 recommendations from clustered pains', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ painPoint: pain, customerTier: '金牌' }),
      makeRecord({ painPoint: pain, customerTier: '银牌' }),
      makeRecord({
        painPoint: '账单金额计算错误多扣费用',
        problemType: '计费与账单',
        journeyL1: '购买',
      }),
    ]
    const recs = buildClusterActionRecommendations(records)
    expect(recs.length).toBeGreaterThanOrEqual(1)
    expect(recs[0].signalType).toBe('pain_cluster_v2')
    expect(recs[0].sections?.painClusterScores?.rank).toBeGreaterThanOrEqual(1)
    expect(recs[0].sections?.painClusterScores?.customerTierSummary).toContain('金牌')
  })

  it('returns empty when no pain points', () => {
    const records = [
      makeRecord({ painPoint: '', problemSummary: '' }),
      makeRecord({ id: crypto.randomUUID(), painPoint: '', problemSummary: '' }),
    ]
    expect(buildClusterActionRecommendations(records)).toEqual([])
  })
})
