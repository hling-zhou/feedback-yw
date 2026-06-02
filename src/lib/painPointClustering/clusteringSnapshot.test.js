import { describe, expect, it } from 'vitest'
import { CLUSTERING_VERSION } from './constants.js'
import { runProductClusteringPipeline } from './runProductClusteringPipeline.js'
import { randomId } from '../randomId.js'
import {
  formatClusteringExclusionNote,
  isSourceSnapshotClusteringStale,
  resolveSourcePainPointClustering,
  summarizeClusteringExclusions,
} from './clusteringSnapshot.js'

function makeRecord(overrides = {}) {
  return {
    id: randomId(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    problemType: '配置与操作',
    journeyL1: '业务使用与连通',
    painPoint: '安全组规则未放行导致公网端口无法访问',
    ...overrides,
  }
}

describe('clusteringSnapshot', () => {
  it('isSourceSnapshotClusteringStale detects missing or outdated version', () => {
    expect(isSourceSnapshotClusteringStale({})).toBe(true)
    expect(isSourceSnapshotClusteringStale({ painPointClustering: null })).toBe(true)
    expect(
      isSourceSnapshotClusteringStale({
        painPointClustering: { clusteringVersion: 'v1.0', products: {} },
      }),
    ).toBe(true)
    expect(
      isSourceSnapshotClusteringStale({
        painPointClustering: { clusteringVersion: CLUSTERING_VERSION, products: {} },
      }),
    ).toBe(false)
  })

  it('resolveSourcePainPointClustering prefers fresh snapshot aggregates', () => {
    const stored = {
      clusteringVersion: CLUSTERING_VERSION,
      products: { '弹性公网 IP': { primaryClusters: [{ id: 'p1' }], isolatedRecordIds: [] } },
    }
    const resolved = resolveSourcePainPointClustering(
      { painPointClustering: stored },
      [makeRecord()],
    )
    expect(resolved.source).toBe('snapshot')
    expect(resolved.products['弹性公网 IP'].primaryClusters).toHaveLength(1)
  })

  it('resolveSourcePainPointClustering returns missing when snapshot is stale', () => {
    const records = [makeRecord(), makeRecord()]
    const resolved = resolveSourcePainPointClustering(
      { painPointClustering: { clusteringVersion: 'v1.0' } },
      records,
    )
    expect(resolved.source).toBe('missing')
    expect(resolved.clusteringVersion).toBe(CLUSTERING_VERSION)
    expect(resolved.products).toEqual({})
  })

  it('summarizeClusteringExclusions and formatClusteringExclusionNote', () => {
    const product = '弹性公网 IP'
    const sharedPain = '安全组规则未放行导致公网端口无法访问'
    const records = [
      makeRecord({ product, painPoint: sharedPain }),
      makeRecord({ product, painPoint: sharedPain }),
      makeRecord({
        product,
        painPoint: '申请提升带宽配额上限',
        problemType: '配额与权限申请',
      }),
      makeRecord({
        product,
        painPoint: '申请提升带宽配额上限',
        problemType: '配额与权限申请',
      }),
    ]
    const pipelineResults = [runProductClusteringPipeline(records, product)]
    const summary = summarizeClusteringExclusions(pipelineResults)
    expect(summary.excludedPrimaryClusterCount).toBeGreaterThanOrEqual(1)
    expect(summary.productCount).toBe(1)
    const note = formatClusteringExclusionNote(pipelineResults)
    expect(note).toMatch(/剔除/)
    expect(note).toMatch(/低价值/)
  })
})
