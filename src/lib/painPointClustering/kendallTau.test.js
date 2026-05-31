import { describe, expect, it } from 'vitest'
import {
  CLUSTERING_TOP10_TAU_MIN,
  kendallTauBetweenRankings,
  meetsClusteringTop10Tau,
} from './kendallTau.js'

describe('kendallTau', () => {
  it('returns tau=1 for identical rankings', () => {
    const order = ['a', 'b', 'c', 'd']
    const { tau } = kendallTauBetweenRankings(order, order)
    expect(tau).toBe(1)
    expect(meetsClusteringTop10Tau(tau)).toBe(true)
  })

  it('returns tau=-1 for fully reversed rankings', () => {
    const { tau } = kendallTauBetweenRankings(['a', 'b', 'c'], ['c', 'b', 'a'])
    expect(tau).toBe(-1)
  })

  it('computes tau on intersection only', () => {
    const { tau, intersectionSize } = kendallTauBetweenRankings(
      ['a', 'b', 'c', 'x'],
      ['b', 'a', 'c', 'y'],
    )
    expect(intersectionSize).toBe(3)
    expect(tau).toBeCloseTo(1 / 3, 5)
  })

  it('CLUSTERING_TOP10_TAU_MIN is 0.85', () => {
    expect(CLUSTERING_TOP10_TAU_MIN).toBe(0.85)
  })
})
