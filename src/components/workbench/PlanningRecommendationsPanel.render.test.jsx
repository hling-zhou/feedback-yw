import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import PlanningRecommendationsPanel from './PlanningRecommendationsPanel.jsx'

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    Link: ({ to, children, ...props }) => <a href={typeof to === 'string' ? to : '#'} {...props}>{children}</a>,
  }
})

vi.mock('../../context/InsightsContext.jsx', () => ({
  useInsights: () => ({
    adapter: null,
    settings: null,
    polishPlanningRecommendations: async () => {},
  }),
}))

vi.mock('../../hooks/useAppMessage.js', () => ({
  useAppMessage: () => ({
    success: () => {},
    error: () => {},
  }),
}))

vi.mock('../../lib/themeSemantic.js', () => ({
  canUseSemanticMatch: () => false,
}))

vi.mock('./PlanningRecommendationsHelpModal.jsx', () => ({
  default: () => <span>help</span>,
}))

vi.mock('./PlanningRecommendationSectionsView.jsx', () => ({
  default: ({ sections }) => (
    <div>
      {sections?.painClusterScores ? '优先级评定' : 'no-score'}
      {(sections?.productActions || []).join('；')}
    </div>
  ),
}))

vi.mock('../ui/SimpleList.jsx', () => ({
  default: ({ dataSource = [], renderItem }) => (
    <div>{dataSource.map((item, index) => <div key={item.id || index}>{renderItem(item, index)}</div>)}</div>
  ),
}))

function renderPanel(conclusions) {
  return renderToStaticMarkup(
    <PlanningRecommendationsPanel conclusions={conclusions} feedbacks={[]} />,
  )
}

describe('PlanningRecommendationsPanel render', () => {
  it('renders formal clusters separately from fallback references', () => {
    const html = renderPanel({
      source: 'rule',
      insightPeriodId: 'period-1',
      periodLabel: '2026年6月',
      recommendationsMeta: {
        recommendationEngine: 'pain_cluster_v2',
        previousPeriodId: 'period-0',
      },
      recommendations: [
        {
          id: 'cluster-1',
          stableKey: 'pcl-1',
          signalType: 'pain_cluster_v2',
          priority: 'high',
          category: 'product',
          summary: '公网IP无法访问',
          text: '公网IP无法访问',
          scope: { product: '弹性公网IP', journeyL1: '使用', journeyL2: '连通性验证', problemType: '可用性/连通性故障' },
          sections: {
            painClusterScores: {
              priorityScore: 4.5,
              rank: 1,
              totalFinal: 3,
              breadthScore: 5,
              sharePct: 50,
              ticketCount: 2,
              harmScore: 4.1,
              maxSeverity: 5,
              p90Emotion: 4,
              sourceDistributionLines: [],
              customerTierSummary: '金牌1',
            },
            productActions: ['补齐连通性自助诊断'],
          },
          generationMeta: { selectedReason: '痛点聚类 V2 入选', score: 4.5 },
        },
        {
          id: 'fallback-1',
          stableKey: 'pfr-1',
          signalType: 'journey_problem_fallback',
          priority: 'low',
          category: 'product',
          summary: '控制台配置路径不清晰',
          text: '控制台配置路径不清晰',
          scope: { product: '弹性公网IP', journeyL1: '使用', journeyL2: '连通性验证', problemType: '配置与操作' },
          evidenceStrength: 'weak',
          insufficientEvidence: true,
          evidenceNote: '小产品频次兜底',
          generationMeta: { selectedReason: '按旅程×问题类型频次推断' },
        },
      ],
      dataCoverageNotes: [],
    })

    expect(html).toContain('本期正式聚类 1 条')
    expect(html).toContain('参考项 1 条')
    expect(html).toContain('弹性公网IP')
    expect(html).toContain('（1 条 · 高 1）')
    expect(html).toContain('小样本参考项')
    expect(html).toContain('不按正式聚类评分口径展示')
    expect(html).toContain('推断型')
  })
})
