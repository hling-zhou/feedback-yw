import { describe, expect, it } from 'vitest'
import { buildTopicAnalysisChapters, ensureTopicAnalysis } from './buildTopicAnalysisChapters.js'
import { collectTopicEvidence } from './collectEvidence.js'
import { buildTopicBrief } from './buildBrief.js'
import { topicFromUserQuery } from './recommendTopics.js'
import { buildTopicMarkdown } from './markdown.js'

function ticket(overrides = {}) {
  return {
    id: 'r1',
    ticketId: 'T-1',
    dataSourceType: 'complaint_ticket',
    product: '弹性公网IP',
    problemType: '带宽限速',
    journeyL1: '开通与配置',
    journeyL2: '调整带宽',
    requestScene: '控制台变更',
    resourcePool: '华北1',
    productSpec: '共享型',
    painPoint: '带宽经常被限速影响业务',
    rawText: '客户反馈弹性公网IP带宽限速',
    importMonth: '2026-08',
    sourceColumns: {
      集团名称: '甲公司',
      集团客户编码: 'C001',
    },
    ...overrides,
  }
}

function concentrated(name, count = 8, total = 10) {
  return {
    total,
    rows: [{ name, count }, { name: '其他', count: total - count }],
    top: { name, count, recordIds: ['T-1', 'T-2'] },
    second: { name: '其他', count: total - count },
    headShare: count / total,
    secondShare: (total - count) / total,
    concentrated: true,
  }
}

function briefFromPack(pack, extras = {}) {
  return {
    topic: { title: '带宽限速', type: 'common_issue' },
    scope: { total: pack.sample?.total || 0, countsBySource: { complaint_ticket: pack.sample?.total || 0 } },
    sources: [
      { id: 'r1', ticketId: 'T-1', sourceLabel: '投诉', product: '弹性公网IP', customerName: '甲公司', summary: '限速' },
      { id: 'r2', ticketId: 'T-2', sourceLabel: '投诉', product: '弹性公网IP', customerName: '乙公司', summary: '限速' },
    ],
    quotes: [
      { id: 'r1', recordId: 'r1', ticketId: 'T-1', text: '申请调带宽时被限速', sourceLabel: '投诉' },
    ],
    judgments: [{ id: 'j1', text: '当前周期匹配相关记录。', sourceIds: ['T-1'] }],
    decision: { action: { type: 'investigate', what: '评估带宽策略' }, metrics: { monthCounts: { '2026-08': 6 } } },
    signalPack: pack,
    ...extras,
  }
}

describe('buildTopicAnalysisChapters', () => {
  it('includes source mix and typed recommendations', () => {
    const chapters = buildTopicAnalysisChapters(briefFromPack({
      sample: { total: 10, negative: 4, expectationRate: 0.4, expectationCount: 4, quoteCount: 10 },
      analysis: { scenarios: ['worsening'], keyCustomer: true, monthCounts: { '2026-08': 6 }, recentAvg: 3, baselineAvg: 1 },
      dimensions: {
        problem: concentrated('带宽限速'),
        journeyL2: concentrated('调整带宽'),
        requestScene: concentrated('控制台变更'),
      },
      inventory: { openCount: 0, doneCount: 1, stoppedCount: 0, open: [] },
      splitSuggested: false,
      quoteClusters: [{ key: '申请调带宽', count: 4, recordIds: ['r1'] }],
    }))
    expect(chapters.quantitative.sourceMix.some((row) => row.count === 10)).toBe(true)
    expect(chapters.recommendations.length).toBeGreaterThan(0)
    expect(chapters.recommendations.every((item) => item.type)).toBe(true)
    expect(chapters.whyHappened.chain).toHaveLength(5)
  })

  it('puts split first when the topic should be split', () => {
    const chapters = buildTopicAnalysisChapters(briefFromPack({
      sample: { total: 8, negative: 3, expectationRate: 0, expectationCount: 0, quoteCount: 8 },
      analysis: { scenarios: ['worsening'], monthCounts: {}, recentAvg: 2, baselineAvg: 1 },
      dimensions: { problem: concentrated('A', 4, 8) },
      inventory: { openCount: 0, doneCount: 0, stoppedCount: 0, open: [] },
      splitSuggested: true,
    }))
    expect(chapters.recommendations[0].type).toBe('split')
    expect(chapters.whyHappened.hypotheses.blocked).toBe('split')
    expect(chapters.whyHappened.hypotheses.items).toEqual([])
  })

  it('gives competing hypotheses with counter-evidence when several dimensions concentrate', () => {
    const chapters = buildTopicAnalysisChapters(briefFromPack({
      sample: { total: 12, negative: 6, expectationRate: 0.1, expectationCount: 1, quoteCount: 10 },
      analysis: { scenarios: ['chronic'], monthCounts: { '2026-07': 5, '2026-08': 7 }, recentAvg: 3, baselineAvg: 2 },
      dimensions: {
        problem: concentrated('带宽限速', 9, 12),
        journeyL2: concentrated('调整带宽', 8, 12),
        resourcePool: concentrated('华北1', 7, 12),
        requestScene: concentrated('控制台变更', 7, 12),
      },
      inventory: { openCount: 0, doneCount: 0, stoppedCount: 0, open: [] },
      splitSuggested: false,
      painFragments: [{ name: '带宽经常被限速', count: 4 }],
      rootCauses: [{ name: '共享带宽争抢', count: 3 }],
      crossTabs: {
        problemByJourney: [{ a: '带宽限速', b: '调整带宽', count: 8 }],
        problemByPool: [{ a: '带宽限速', b: '华北1', count: 7 }],
        problemBySpec: [],
      },
    }))
    expect(chapters.whyHappened.hypotheses.items.length).toBeGreaterThanOrEqual(2)
    expect(chapters.whyHappened.hypotheses.items.some((item) => item.counter)).toBe(true)
    expect(chapters.whyHappened.crossTabs.some((table) => table.key === 'problemByJourney')).toBe(true)
  })

  it('does not name a primary cause when the sample is too small', () => {
    const chapters = buildTopicAnalysisChapters(briefFromPack({
      sample: { total: 3, negative: 2, expectationRate: 0, expectationCount: 0, quoteCount: 2 },
      analysis: { scenarios: [], monthCounts: { '2026-08': 3 }, recentAvg: 3, baselineAvg: null },
      dimensions: { problem: concentrated('带宽限速', 3, 3) },
      inventory: { openCount: 0, doneCount: 0, stoppedCount: 0, open: [] },
      splitSuggested: false,
    }))
    expect(chapters.whyHappened.hypotheses.blocked).toBe('sparse')
    expect(chapters.whyHappened.hypotheses.items).toEqual([])
  })

  it('keeps appendix source count aligned with collected evidence', () => {
    const records = [
      ticket(),
      ticket({ id: 'r2', ticketId: 'T-2', product: '云主机', importMonth: '2026-07' }),
      ticket({ id: 'r3', ticketId: 'T-3', dataSourceType: 'consultation_ticket', importMonth: '2026-06' }),
    ]
    const evidence = collectTopicEvidence({
      topic: topicFromUserQuery('带宽限速', { type: 'common_issue' }),
      periodLabel: '近3个月',
      records,
    })
    const brief = buildTopicBrief({ evidence })
    expect(brief.signalPack.sample.total).toBe(evidence.total)
    expect(brief.sources).toHaveLength(evidence.sources.length)
    expect(brief.analysis.quantitative.sourceMix.length).toBeGreaterThan(0)
    const md = buildTopicMarkdown(brief)
    expect(md).toContain('规模与结构')
    expect(md).toContain('为什么发生（假设）')
    expect(md).toContain('建议')
    expect(md).toContain('依据与口径')
  })

  it('assembles complete rule chapters without LLM', () => {
    const brief = buildTopicBrief({
      evidence: collectTopicEvidence({
        topic: topicFromUserQuery('带宽限速', { type: 'common_issue' }),
        records: [
          ticket(),
          ticket({ id: 'r2', ticketId: 'T-2', importMonth: '2026-07', sentiment: 'negative' }),
          ticket({ id: 'r3', ticketId: 'T-3', importMonth: '2026-06', journeyL2: '调整带宽' }),
        ],
      }),
    })
    expect(brief.analysis.quantitative.sourceMix.length).toBeGreaterThan(0)
    expect(brief.analysis.qualitative.facts.length).toBeGreaterThan(0)
    expect(brief.analysis.whyHappened.chain).toHaveLength(5)
    expect(brief.analysis.recommendations.length).toBeGreaterThan(0)
    expect(brief.decision.urgency.level).toMatch(/^P[012]$/)
    expect(brief.llmApplied).toBe(false)
  })

  it('rebuilds chapters for old briefs that lack analysis', () => {
    const old = briefFromPack({
      sample: { total: 6, negative: 2, expectationRate: 0, expectationCount: 0, quoteCount: 4 },
      analysis: { scenarios: [], monthCounts: {}, recentAvg: 2, baselineAvg: 1 },
      dimensions: { problem: concentrated('带宽限速', 5, 6) },
      inventory: { openCount: 1, doneCount: 0, stoppedCount: 0, open: [{ title: '跟进限速' }] },
      splitSuggested: false,
    })
    delete old.analysis
    const next = ensureTopicAnalysis(old)
    expect(next.analysis.recommendations[0].type).toBe('follow_up')
    expect(next.analysis.quantitative).toBeTruthy()
  })
})
