import { describe, expect, it } from 'vitest'
import { randomId } from './randomId.js'
import { buildClusterRecommendationsFromPipeline } from './painPointClustering/buildClusterActionRecommendations.js'
import {
  appendSmallProductJourneyProblemFallbacks,
  buildSmallProductJourneyProblemFallbackRecommendation,
  productHasClusterRecommendation,
  SMALL_PRODUCT_FALLBACK_MAX_TICKETS,
} from './planningRecommendations.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/**
 * @param {Partial<FeedbackRecord>} overrides
 * @returns {FeedbackRecord}
 */
function makeRecord(overrides = {}) {
  return {
    id: randomId(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    source: '工单',
    rawText: 'test',
    customerQuote: '',
    createdAt: '2025-06-15T10:00:00Z',
    importMonth: '2025-06',
    dataSourceType: 'complaint_ticket',
    product: '云专线',
    problemType: '配置与操作',
    journeyL1: '订购开通',
    journeyL2: '加急开通',
    requestScene: '开通',
    problemSummary: '',
    sentiment: 'neutral',
    themes: [],
    status: 'open',
    importedAt: '2025-06-15T10:00:00Z',
    ...overrides,
  }
}

describe('small product journey×problemType fallback', () => {
  it('buildSmallProductJourneyProblemFallbackRecommendation uses top journey×problemType combo', () => {
    const records = [
      ...Array.from({ length: 5 }, () =>
        makeRecord({ product: '云专线', journeyL2: '加急开通', problemType: '配置与操作' }),
      ),
      ...Array.from({ length: 3 }, () =>
        makeRecord({ product: '云专线', journeyL2: '变更规格', problemType: '计费与账单' }),
      ),
    ]

    const rec = buildSmallProductJourneyProblemFallbackRecommendation('云专线', records)
    expect(rec).not.toBeNull()
    expect(rec?.signalType).toBe('journey_problem_fallback')
    expect(rec?.evidenceStrength).toBe('weak')
    expect(rec?.scope?.journeyL2).toBe('加急开通')
    expect(rec?.scope?.problemType).toBe('配置与操作')
    expect(rec?.summary).toMatch(/5\/8 单/)
    expect(rec?.evidenceNote).toMatch(/未形成痛点聚类/)
    expect(rec?.generationMeta?.fallbackType).toBe('small_product_journey_problem')
  })

  it('appendSmallProductJourneyProblemFallbacks adds fallback when cluster missing', () => {
    const records = Array.from({ length: 8 }, () =>
      makeRecord({
        product: '虚拟私有云',
        journeyL1: '网络配置',
        journeyL2: '路由表配置',
        problemType: '配置与操作',
      }),
    )

    const { recommendations } = buildClusterRecommendationsFromPipeline(records)
    expect(productHasClusterRecommendation(recommendations, '虚拟私有云')).toBe(false)

    const merged = appendSmallProductJourneyProblemFallbacks(recommendations, records)
    expect(merged.length).toBeGreaterThan(recommendations.length)
    const fallback = merged.find((r) => r.signalType === 'journey_problem_fallback')
    expect(fallback?.scope?.product).toBe('虚拟私有云')
    expect(fallback?.evidenceStrength).toBe('weak')
  })

  it('does not add fallback when pain_cluster_v2 already exists', () => {
    const pain = '安全组未放行导致公网端口无法访问'
    const records = Array.from({ length: 6 }, () =>
      makeRecord({
        product: '弹性公网IP',
        painPoint: pain,
        journeyL2: '公网访问不通',
        problemType: '可用性/连通性故障',
      }),
    )

    const { recommendations } = buildClusterRecommendationsFromPipeline(records)
    expect(productHasClusterRecommendation(recommendations, '弹性公网IP')).toBe(true)

    const merged = appendSmallProductJourneyProblemFallbacks(recommendations, records)
    expect(
      merged.filter(
        (r) =>
          r.scope?.product === '弹性公网IP' && r.signalType === 'journey_problem_fallback',
      ),
    ).toHaveLength(0)
  })

  it('skips products above SMALL_PRODUCT_FALLBACK_MAX_TICKETS', () => {
    const records = Array.from({ length: SMALL_PRODUCT_FALLBACK_MAX_TICKETS + 5 }, () =>
      makeRecord({ product: '负载均衡', journeyL2: '监听配置', problemType: '配置与操作' }),
    )

    const merged = appendSmallProductJourneyProblemFallbacks([], records)
    expect(merged.some((r) => r.scope?.product === '负载均衡')).toBe(false)
  })
})
