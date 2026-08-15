import { describe, expect, it } from 'vitest'
import { randomId } from '../randomId.js'
import {
  buildClusterActionRecommendations,
  formatCustomerTierSummary,
  mapClusterPriorityScore,
  scoredFinalClusterToRecommendation,
} from './buildClusterActionRecommendations.js'

function makeRecord(overrides = {}) {
  return {
    id: randomId(),
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
    expect(recs[0].summary).toMatch(/安全组规则未放行/)
    expect(recs[0].summary).not.toMatch(/集中反馈|「弹性公网 IP」/)
    expect(recs[0].stableKey).toMatch(/^pcl-/)
    expect(recs[0].generationMeta?.fingerprintVersion).toBe('cluster-fingerprint-v2')
    expect(recs[0].evidenceTicketIds).toEqual(
      recs[0].evidenceRecordIds
        .map((id) => records.find((record) => record.id === id)?.ticketId)
        .filter(Boolean),
    )
    expect(recs[0].evidenceTicketIds.length).toBe(recs[0].evidenceRecordIds.length)
  })

  it('persists every cluster ticket id instead of a sampled subset', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = Array.from({ length: 25 }, (_, index) => makeRecord({
      id: `r-${index + 1}`,
      ticketId: `WO-${String(index + 1).padStart(3, '0')}`,
      painPoint: pain,
      customerTier: index === 0 ? '金牌' : '普通',
    }))
    const rec = scoredFinalClusterToRecommendation({
      id: 'cluster-big',
      product: '弹性公网 IP',
      recordIds: records.map((record) => record.id),
      ticketCount: 25,
      sharePct: 80,
      rank: 1,
      totalFinal: 1,
      priorityScore: 4.5,
      breadthScore: 5,
      harmScore: 4,
      maxSeverity: 4,
      p90Emotion: 3,
      representativePainPoint: pain,
      label: pain,
      primaryGroups: [],
    }, records)

    expect(rec.evidenceTicketIds).toEqual(records.map((record) => record.ticketId))
    expect(rec.evidenceRecordIds).toHaveLength(25)
    expect(rec.evidenceTicketIds).toHaveLength(25)
  })

  it('returns empty when no pain points', () => {
    const records = [
      makeRecord({ painPoint: '', problemSummary: '' }),
      makeRecord({ id: randomId(), painPoint: '', problemSummary: '' }),
    ]
    expect(buildClusterActionRecommendations(records)).toEqual([])
  })
})
