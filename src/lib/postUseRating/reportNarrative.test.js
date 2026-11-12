import { describe, expect, it, vi } from 'vitest'

const calls = []
vi.mock('../llmClient.js', () => ({
  llmChatCompletion: vi.fn(async (_settings, body) => {
    calls.push(body)
    return { text: JSON.stringify(calls.length === 1
      ? { summary: '低分反馈集中于页面加载' }
      : { detail: '页面加载问题在两条原话中出现。', action: '产品甲核对首屏资源并验收加载时间。', conclusion: '下期复核加载时间与客户确认结果。' }) }
  }),
  getLlmCompletionText: (response) => response.text,
  parseLlmMessageContent: (text) => JSON.parse(text),
}))

import { buildReportProductNarrative, generateReportProductDraft, reportNarrativeFingerprint } from './reportNarrative.js'

describe('report narrative generation', () => {
  it('keeps rule-owned metrics and excludes unlinked sources from action citations', async () => {
    calls.length = 0
    const evidence = {
      rawPieceCount: 2, rawRecordCount: 2, excludedIssueCount: 0,
      pieces: [{ recordId: 'rating-a' }, { recordId: 'rating-b' }],
      issues: [{ status: 'open', linkedTraceIds: ['trace-linked'], linkedVisitIds: [] }],
      themes: [{ issue: '页面打开慢', activeCount: 2, excludedCount: 0, rawCount: 2, lowestScore: 2 }],
      quotes: [{ text: '页面打开慢', count: 2, lowestScore: 2, excludedCount: 0, recordIds: ['rating-a', 'rating-b'] }],
      highlights: [{ text: '页面打开慢', count: 2, lowestScore: 2, excludedCount: 0 }],
    }
    const narrative = buildReportProductNarrative({
      productName: '弹性公网IP', evidence,
      overview: { avgScore: 8.5, sampleSize: 10, state: '观察', stateCode: 'watch' },
      traces: [
        { id: 'trace-linked', productName: '弹性公网IP', progress: '已定位首屏资源', assigneeName: '产品甲' },
        { id: 'trace-unlinked', productName: '弹性公网IP', progress: '另一个客户的情况' },
      ],
    })
    const draft = await generateReportProductDraft({}, narrative)
    expect(calls).toHaveLength(2)
    expect(calls[0].messages[1].content).toContain('rating-a')
    expect(draft.detail).toContain('问题综合：「页面打开慢」原始 2 次')
    expect(draft.conclusion).toContain('体验均分 8.5 分，体验样本 10 条')
    expect(draft.action).toContain('产品部溯源 trace-linked')
    expect(draft.action).not.toContain('产品部溯源 trace-unlinked')
    expect(reportNarrativeFingerprint(narrative.facts)).toBe(reportNarrativeFingerprint(narrative.facts))
    expect(reportNarrativeFingerprint({ ...narrative.facts, quotes: [] })).not.toBe(reportNarrativeFingerprint(narrative.facts))
  })
})
