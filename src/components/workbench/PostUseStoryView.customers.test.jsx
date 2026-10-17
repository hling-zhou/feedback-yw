import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PostUseStoryView from './PostUseStoryView.jsx'

vi.mock('../../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('../charts/TrendChart.jsx', () => ({
  default: () => <div>trend</div>,
}))

function model() {
  return {
    scope: { periodLabel: '2026年6月', catalogVersion: 'v1', ruleVersion: 'v1' },
    conclusions: [{ key: 'overall', label: '整体状态', value: '稳定', detail: '样本 1', target: '#post-use-status' }],
    metrics: {
      internalExperience: { avgScore: 8, totalSample: 1 },
      satisfaction: { rate: 100, totalSample: 0 },
      external: { yunwang: { avgScore: 8, totalSample: 1 }, company: { avgScore: 8, totalSample: 1 } },
      nonTenDistributionProducts: [],
      scoreDistribution: {},
      statusTrends: {},
    },
    productOverview: [],
    trendsAndChanges: { scoreTrend: { data: [] }, satisfactionTrend: { data: [] }, changes: [] },
    drivers: {
      sceneJourneys: [],
      needs: [],
      highFrequencyLowScoreReasons: [],
      customers: [{
        customerName: '客户A',
        customerCode: 'C001',
        products: ['云专线'],
        nonTenCount: 1,
        avgScore: 8,
        highFrequency: false,
        latestQuote: '功能有缺失',
        visitEvidenceCount: 2,
        visitItems: [
          { visitResult: '第一次回访', internalConclusion: '需求接纳', remark: '备注一' },
          { visitResult: '第二次回访', internalConclusion: '待客户反馈', remark: '' },
        ],
      }],
    },
    actionsAndRecovery: { triggerGroups: [], rows: [], recoveryRows: [], notRecovered: 0 },
    quality: null,
  }
}

describe('PostUseStoryView customer visits', () => {
  it('shows each visit result, internal evaluation, and remark on its own line', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PostUseStoryView model={model()} creatingSignalKey="" onCreateAction={() => {}} onOpenTicket={() => {}} />
      </MemoryRouter>,
    )

    expect(html).toContain('客服部回访记录')
    expect(html).toContain('回访结果内部评估/回应')
    expect(html).toContain('>2</span>')
    expect(html).toContain('1. 需求接纳')
    expect(html).toContain('2. 待客户反馈')
    expect(html).toContain('1. 备注一')
    expect(html).toContain('2. —')
  })

  it('shows experience score comparisons and the two problem-product cards', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PostUseStoryView
          model={{
            ...model(),
            metrics: {
              ...model().metrics,
              internalExperience: { avgScore: 9.1, totalSample: 20 },
              external: {
                yunwang: { avgScore: 9.1, totalSample: 20 },
                company: { avgScore: 9.4, totalSample: 100 },
              },
              previousDepartmentScore: { avgScore: 8.8, totalSample: 18, momPrefix: '较上月' },
            },
            productOverview: [
              { productName: '云电脑', avgScore: 8.4, sampleSize: 12, satisfactionBelowBaseline: true },
              { productName: '弹性公网IP', avgScore: 9.6, sampleSize: 20, satisfactionBelowBaseline: false },
            ],
          }}
          creatingSignalKey=""
          onCreateAction={() => {}}
          onOpenTicket={() => {}}
        />
      </MemoryRouter>,
    )

    expect(html).toContain('部门均分（三渠道）')
    expect(html).not.toContain('云网均分（三渠道）')
    expect(html).toContain('低于公司均分 0.3')
    expect(html).toContain('较上月高 0.3')
    expect(html).toContain('flex flex-wrap items-baseline gap-x-3')
    expect(html).toContain('9 分以下产品数')
    expect(html).toContain('投诉回访不达标产品数')
    expect(html).toContain('云电脑')
    expect(html).not.toContain('弹性公网IP、云电脑')
  })
})
