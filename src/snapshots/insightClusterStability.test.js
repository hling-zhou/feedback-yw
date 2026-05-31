import { describe, expect, it } from 'vitest'
import { createInsightPeriod } from '../domain/insightPeriod.js'
import { buildSourceSnapshot } from './buildSourceSnapshot.js'

function makeRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    source: '工单',
    rawText: 'test',
    createdAt: '2025-06-15T10:00:00Z',
    importMonth: '2025-06',
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    productKey: 'eip',
    problemType: '网络连通',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    sentiment: 'negative',
    painPoint: '安全组规则未放行导致公网端口无法访问',
    customerRequestSource: 'llm',
    painPointSource: 'llm',
    optimizationSource: 'llm',
    ...overrides,
  }
}

describe('insight cluster stability (Phase E spot check)', () => {
  it('同 pain + 同 journeyL1：rule/llm 旅程来源不影响聚类簇数（变化 <10%）', () => {
    const period = createInsightPeriod({
      label: '2025-06',
      granularity: 'month',
      anchorYear: 2025,
      anchorMonth: 6,
    })
    const sharedPain = '安全组规则未放行导致公网端口无法访问'
    const base = Array.from({ length: 24 }, (_, i) =>
      makeRecord({
        id: `r-${i}`,
        painPoint: sharedPain,
        journeyL1: '业务使用与连通',
        journeyL2: i % 2 === 0 ? '公网访问不通' : '端口映射异常',
      }),
    )

    const ruleJourney = base.map((r) => ({
      ...r,
      journeySource: 'rule',
      journeyMatchScore: 4,
    }))
    const llmJourney = base.map((r) => ({
      ...r,
      journeySource: 'llm',
      journeyMatchScore: undefined,
    }))

    const snapRule = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'complaint_ticket',
      records: ruleJourney,
    })
    const snapLlm = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'complaint_ticket',
      records: llmJourney,
    })

    const product = '弹性公网 IP'
    const clustersRule =
      snapRule.aggregates.painPointClustering?.products?.[product]?.primaryClusters?.length ?? 0
    const clustersLlm =
      snapLlm.aggregates.painPointClustering?.products?.[product]?.primaryClusters?.length ?? 0
    const max = Math.max(clustersRule, clustersLlm, 1)
    const delta = Math.abs(clustersRule - clustersLlm) / max

    expect(clustersRule).toBeGreaterThan(0)
    expect(delta).toBeLessThan(0.1)
  })
})
