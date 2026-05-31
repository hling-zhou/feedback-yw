import { describe, expect, it } from 'vitest'
import { buildSourcePainPointClusterSnapshot } from './buildSourceClusterSnapshot.js'

function makeRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    painPoint: '安全组规则未放行导致公网端口无法访问',
    problemType: '配置与操作',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    ...overrides,
  }
}

describe('buildSourcePainPointClusterSnapshot', () => {
  it('returns empty snapshot for no records', () => {
    const snap = buildSourcePainPointClusterSnapshot([])
    expect(snap.clusteringVersion).toBe('v2.0')
    expect(snap.products).toEqual({})
  })

  it('groups primary clusters by product', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const snap = buildSourcePainPointClusterSnapshot([
      makeRecord({ painPoint: pain }),
      makeRecord({ painPoint: pain }),
      makeRecord({
        product: '云专线',
        painPoint: '带宽超限导致网速很慢',
        journeyL1: '使用运维',
      }),
    ])
    expect(Object.keys(snap.products)).toEqual(['云专线', '弹性公网 IP'])
    expect(snap.products['弹性公网 IP'].primaryClusters.length).toBeGreaterThanOrEqual(1)
    expect(snap.products['弹性公网 IP'].primaryClusters[0].ticketCount).toBe(2)
  })
})
