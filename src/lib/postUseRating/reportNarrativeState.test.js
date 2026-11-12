import { describe, expect, it } from 'vitest'
import { mergeManualReportIssueNarratives } from './reportNarrativeState.js'

describe('report narrative edit state', () => {
  it('does not turn rule or AI display text into a manual override when saving other fields', () => {
    const current = { 'product:A': { conclusion: 'AI 结论', action: 'AI 举措' } }
    expect(mergeManualReportIssueNarratives({}, current, {})).toEqual({})
    expect(mergeManualReportIssueNarratives({}, current, {
      'product:A': { conclusion: true },
    })).toEqual({ 'product:A': { conclusion: 'AI 结论' } })
    expect(mergeManualReportIssueNarratives({ 'product:A': { action: '人工举措' } }, current, {
      'product:A': { conclusion: true },
    })).toEqual({ 'product:A': { action: '人工举措', conclusion: 'AI 结论' } })
  })
})
