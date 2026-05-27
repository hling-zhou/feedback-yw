import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildJourneyMeasuresScopeKey,
  computeJourneyMeasuresFingerprint,
  getSegmentMeasuresFromBundle,
  isJourneyMeasuresScopeReady,
  loadJourneyMeasuresBundle,
  setSegmentMeasuresInBundle,
} from './journeyOptimizationMeasuresCache.js'
import { segmentCacheKey } from './journeyOptimizationLLM.js'

/** @type {Map<string, string>} */
let store

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('sessionStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('journeyOptimizationMeasuresCache', () => {

  it('builds stable scope and segment keys', () => {
    expect(buildJourneyMeasuresScopeKey('p-2026-04', '弹性公网 IP')).toBe(
      'p-2026-04::弹性公网 IP',
    )
    const fp = computeJourneyMeasuresFingerprint(['b', 'a', 'c'])
    expect(fp).toContain('3:')
  })

  it('marks scope ready when fingerprint matches', () => {
    const scopeKey = buildJourneyMeasuresScopeKey('period-1', 'EIP')
    const fp = computeJourneyMeasuresFingerprint(['r1'])
    setSegmentMeasuresInBundle(scopeKey, fp, '环节A', '子环节', ['r1'], [
      { text: '举措一', source: 'AI 分析' },
    ])
    expect(isJourneyMeasuresScopeReady(scopeKey, fp)).toBe(true)
    expect(isJourneyMeasuresScopeReady(scopeKey, 'other-fp')).toBe(false)
  })

  it('reads segment measures without affecting other segments', () => {
    const scopeKey = buildJourneyMeasuresScopeKey('period-1', 'EIP')
    const fp = computeJourneyMeasuresFingerprint(['r1', 'r2'])
    setSegmentMeasuresInBundle(scopeKey, fp, 'L1', 'L2a', ['r1'], [
      { text: 'A', source: 'AI 分析' },
    ])
    setSegmentMeasuresInBundle(scopeKey, fp, 'L1', 'L2b', ['r2'], [
      { text: 'B', source: 'AI 分析' },
    ])
    expect(getSegmentMeasuresFromBundle(scopeKey, 'L1', 'L2a', ['r1'])?.[0].text).toBe('A')
    expect(getSegmentMeasuresFromBundle(scopeKey, 'L1', 'L2b', ['r2'])?.[0].text).toBe('B')
    const sk = segmentCacheKey('L1', 'L2a', ['r1'])
    expect(loadJourneyMeasuresBundle(scopeKey).segments[sk]).toHaveLength(1)
  })
})
