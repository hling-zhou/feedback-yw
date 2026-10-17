import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PostUseHtmlReportDocument from './PostUseHtmlReportDocument.jsx'

function model() {
  return {
    title: '用后即评月报',
    kpis: {
      productCount: 1,
      totalSample: 2,
      avgScore: 8,
      belowNineCount: 1,
      belowNineNames: ['弹性公网IP'],
      callbackUnqualifiedCount: 0,
      callbackUnqualifiedNames: [],
      vsCompanyLabel: '与公司均分持平',
      vsCompanyTone: 'flat',
      momLabel: '暂无上月对比',
      momTone: 'na',
    },
    charts: {
      statusTrend: { data: [], areas: [] },
      scoreTrend: { data: [], areas: [] },
      satisfactionTrend: { data: [], areas: [] },
    },
    productCards: [{
      productName: '弹性公网IP',
      experienceScore: 8,
      satisfactionRate: 90,
      mixedAvg: 8,
      mixedSample: 2,
      lowScoreCount: 0,
      comparisons: {
        experienceScore: { label: '较上月高 0.2', tone: 'up' },
        satisfactionRate: { label: '较上月低 1 个百分点', tone: 'down' },
        mixedAvg: { label: '较上月持平', tone: 'flat' },
        mixedSample: { label: '较上月多 1', tone: 'flat' },
        lowScoreCount: { label: '较上月少 1', tone: 'up' },
      },
      belowNine: true,
      callbackUnqualified: false,
      visitNarratives: ['某某公司：反馈「功能有缺失」，经客服部回访，核实为「第一次回访」，经产品组评估，「需求接纳」。'],
      scoreTrend: { data: [], areas: [] },
      issue: null,
    }],
    previousVisits: [],
    preview: {
      reviewChecklist: [],
      scoreDistributionTable: [],
      sceneJourneys: [],
      monthlyScoreTable: [],
      needs: [],
      customers: [],
      reasons: [],
    },
    issues: [],
    overflow: [],
    quoteRegistry: [],
    todo: {
      proposedCount: 0,
      closedCount: 0,
      notRecoveredCount: 0,
      proposed: [],
      closed: [],
      notRecovered: [],
      callbackHighlights: [],
      callbackCount: 0,
    },
  }
}

describe('PostUseHtmlReportDocument render', () => {
  it('renders the redesigned sections and the visit sentence', () => {
    const html = renderToStaticMarkup(
      <PostUseHtmlReportDocument
        model={model()}
        canEdit
        judgment="本月整体稳定"
        todoNote=""
        issueNarratives={{}}
        visitSupplements={{}}
        hiddenSectionIds={[]}
        onJudgmentChange={() => {}}
        onTodoNoteChange={() => {}}
        onIssueChange={() => {}}
        onVisitSupplementChange={() => {}}
      />,
    )
    expect(html).toContain('report-module')
    expect(html.match(/report-module/g).length).toBeGreaterThanOrEqual(5)
    expect(html).toContain('本月概述')
    expect(html).toContain('post-use-html-report-kpi-hints--inline')
    expect(html).toContain('与公司均分持平')
    expect(html).toContain('暂无上月对比')
    expect(html).toContain('分产品情况')
    expect(html).toContain('待办事情及进展')
    expect(html).toContain('上期客服部回访结果补充')
    expect(html).toContain('上期无客服部回访记录')
    expect(html).toContain('经客服部回访，核实为「第一次回访」')
    expect(html).toContain('弹性公网IP')
    expect(html).toContain('post-use-html-report-kpis--product')
    expect(html).toContain('较上月高 0.2')
    expect(html).toContain('较上月低 1 个百分点')
    expect(html).toContain('较上月多 1')
    expect(html).toContain('较上月少 1')
  })

  it('hides the previous-visit supplement on a quarterly report', () => {
    const html = renderToStaticMarkup(
      <PostUseHtmlReportDocument
        model={{
          ...model(),
          showPreviousVisits: false,
          copy: { overviewTitle: '本季概述', todoProposed: '本季提出', todoClosed: '本季关闭' },
          kpis: { ...model().kpis, momLabel: '较上季度高 0.2', momTone: 'up' },
        }}
        canEdit
        judgment="本季整体稳定"
        todoNote=""
        issueNarratives={{}}
        visitSupplements={{}}
        hiddenSectionIds={[]}
        onJudgmentChange={() => {}}
        onTodoNoteChange={() => {}}
        onIssueChange={() => {}}
        onVisitSupplementChange={() => {}}
      />,
    )
    expect(html).toContain('本季概述')
    expect(html).toContain('较上季度高 0.2')
    expect(html).toContain('本季提出')
    expect(html).not.toContain('上期客服部回访结果补充')
    expect(html).not.toContain('显示上期回访补充')
  })
})
