import { describe, expect, it } from 'vitest'
import { CLUSTERING_GOLDEN_PRODUCTS, CLUSTERING_GOLDEN_RECORDS } from './fixtures/clusteringGoldenDataset.js'
import { CLUSTERING_TOP10_GOLDEN } from './fixtures/clusteringTop10Golden.js'
import { productTop10Fingerprints } from './clusterTop10Fingerprint.js'
import {
  CLUSTERING_TOP10_TAU_MIN,
  kendallTauBetweenRankings,
  meetsClusteringTop10Tau,
} from './kendallTau.js'
import { runProductClusteringPipeline } from './runProductClusteringPipeline.js'

describe('M2-4: Top10 golden Kendall τ', () => {
  for (const product of CLUSTERING_GOLDEN_PRODUCTS) {
    it(`${product}：当前 pipeline Top10 与 golden τ ≥ ${CLUSTERING_TOP10_TAU_MIN}`, () => {
      const golden = CLUSTERING_TOP10_GOLDEN[product]
      expect(golden?.length).toBeGreaterThan(0)

      const result = runProductClusteringPipeline(CLUSTERING_GOLDEN_RECORDS, product)
      const current = productTop10Fingerprints(result)

      const { tau, intersectionSize } = kendallTauBetweenRankings(golden, current)
      expect(
        intersectionSize,
        `golden=${golden.length} current=${current.length}`,
      ).toBeGreaterThanOrEqual(Math.min(2, golden.length))
      expect(
        meetsClusteringTop10Tau(tau),
        `τ=${tau.toFixed(3)} intersection=${intersectionSize}`,
      ).toBe(true)
    })
  }

  it('弹性公网 IP：M2 优化内核 vs naive 层次聚类 Top10 τ ≥ 0.85', () => {
    const product = '弹性公网 IP'
    const optimized = productTop10Fingerprints(
      runProductClusteringPipeline(CLUSTERING_GOLDEN_RECORDS, product),
    )
    const naive = productTop10Fingerprints(
      runProductClusteringPipeline(CLUSTERING_GOLDEN_RECORDS, product, {
        useNaiveHierarchical: true,
      }),
    )

    const { tau, intersectionSize } = kendallTauBetweenRankings(optimized, naive)
    expect(intersectionSize).toBeGreaterThanOrEqual(2)
    expect(
      meetsClusteringTop10Tau(tau),
      `optimized vs naive τ=${tau.toFixed(3)} intersection=${intersectionSize}`,
    ).toBe(true)
  })
})
