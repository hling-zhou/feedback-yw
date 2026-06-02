import { describe, expect, it } from 'vitest'
import { resolveOverviewRecommendationsForReport } from './resolveOverviewRecommendationsForReport.js'

describe('resolveOverviewRecommendationsForReport', () => {
  const v2Rec = {
    id: 'v2-1',
    priority: 'high',
    category: 'product',
    summary: 'V2 建议',
    sections: {
      executiveSummary: 'V2 建议',
      painClusterScores: {
        priorityScore: 4,
        rank: 1,
        totalFinal: 3,
        breadthScore: 3,
        sharePct: 10,
        ticketCount: 5,
        harmScore: 4,
        maxSeverity: 4,
        p90Emotion: 3,
        customerTierSummary: '—',
      },
    },
  }

  it('returns V2 recommendations when engine is pain_cluster_v2', () => {
    const recs = resolveOverviewRecommendationsForReport({
      recommendationsMeta: { recommendationEngine: 'pain_cluster_v2' },
      recommendations: [v2Rec],
    })
    expect(recs).toHaveLength(1)
    expect(recs[0].id).toBe('v2-1')
  })

  it('excludes legacy engine snapshots', () => {
    expect(
      resolveOverviewRecommendationsForReport({
        recommendationsMeta: { recommendationEngine: 'legacy_planning' },
        recommendations: [{ id: 'old', summary: '旧建议' }],
      }),
    ).toEqual([])
  })

  it('excludes recommendations without painClusterScores', () => {
    expect(
      resolveOverviewRecommendationsForReport({
        recommendationsMeta: { recommendationEngine: 'pain_cluster_v2' },
        recommendations: [{ id: 'old', summary: '旧 playbook', signalType: 'journey' }],
      }),
    ).toEqual([])
  })
})
