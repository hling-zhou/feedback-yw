import { beforeEach, describe, expect, it, vi } from 'vitest'
import { polishTopicAnalysisWithLlm } from './llmBrief.js'
import { buildTopicAnalysisChapters } from './buildTopicAnalysisChapters.js'

vi.mock('../llmClient.js', () => ({
  isLlmAvailable: vi.fn(),
  llmChatCompletion: vi.fn(),
  getLlmCompletionText: vi.fn((data) => data?.choices?.[0]?.message?.content || ''),
  parseLlmMessageContent: vi.fn((text) => JSON.parse(text)),
}))

import { isLlmAvailable, llmChatCompletion } from '../llmClient.js'

function briefFixture() {
  const brief = {
    topic: { title: '带宽限速' },
    decision: { urgency: { level: 'P1' }, action: { owner: '产品' } },
    evidenceIds: ['r1'],
    sources: [{ id: 'r1', ticketId: 'T-1' }],
    quotes: [{ id: 'r1', recordId: 'r1', ticketId: 'T-1', text: '限速' }],
    signalPack: {
      sample: { total: 6, negative: 2, expectationRate: 0, expectationCount: 0, quoteCount: 4 },
      analysis: { scenarios: [], monthCounts: {}, recentAvg: 2, baselineAvg: 1 },
      dimensions: {
        problem: {
          total: 6,
          rows: [{ name: '带宽限速', count: 5 }],
          top: { name: '带宽限速', count: 5 },
          headShare: 5 / 6,
          concentrated: true,
        },
      },
      inventory: { openCount: 0, doneCount: 0, stoppedCount: 0, open: [] },
      splitSuggested: false,
    },
  }
  return { ...brief, analysis: buildTopicAnalysisChapters(brief) }
}

describe('polishTopicAnalysisWithLlm', () => {
  beforeEach(() => {
    vi.mocked(isLlmAvailable).mockReset()
    vi.mocked(llmChatCompletion).mockReset()
  })

  it('leaves rule chapters unchanged when LLM is absent', async () => {
    vi.mocked(isLlmAvailable).mockReturnValue(false)
    const brief = briefFixture()
    const next = await polishTopicAnalysisWithLlm(brief, {})
    expect(next.analysis).toEqual(brief.analysis)
    expect(next.decision.urgency.level).toBe('P1')
    expect(llmChatCompletion).not.toHaveBeenCalled()
  })

  it('polishes narrative without changing P-level, roles, or invented source ids', async () => {
    vi.mocked(isLlmAvailable).mockReturnValue(true)
    vi.mocked(llmChatCompletion).mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            narrative: '近期用户在调整带宽时反复遇到限速，需要先核对说明与容量。',
            whyHappenedNarrative: '假设问题集中在调整带宽路径上，可能与共享资源争抢有关，但工单尚未沉淀根因，不能当作已证实结论。还要对照近期是否加重。',
            recommendations: [{ id: 'rec-observe', text: '先沿该路径复核近期负向是否仍在增加。' }],
            sourceIds: ['r1', 'invented'],
          }),
        },
      }],
    })
    const brief = briefFixture()
    const next = await polishTopicAnalysisWithLlm(brief, { llmServerConfigured: true })
    expect(next.decision.urgency.level).toBe('P1')
    expect(next.decision.action.owner).toBe('产品')
    expect(next.analysis.narrative).toContain('调整带宽')
    expect(next.analysis.whyHappened.sourceIds).toEqual(['r1'])
    expect(next.analysis.recommendations.map((item) => item.type)).toEqual(brief.analysis.recommendations.map((item) => item.type))
  })
})
