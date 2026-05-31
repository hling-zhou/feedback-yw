import { describe, expect, it } from 'vitest'
import {
  buildSentimentJourneyProblemCrossTab,
  journeyLabelFromRecord,
  rankUrgentNegativeJourneys,
} from './sentimentExperienceAnalytics.js'

const base = {
  id: '1',
  rawText: 't',
  customerQuote: 't',
  requestScene: '报障',
  problemType: '连通性',
  journeyL1: '公网访问',
  journeyL2: '端口不通',
  sentiment: 'negative',
  urgencyLevel: 'high',
  themes: [],
  problemSummary: '',
  solutionSummary: '',
  rootCause: '',
  optimizationSuggestion: '',
  status: 'open',
  importedAt: '2026-01-01',
}

describe('sentimentExperienceAnalytics', () => {
  it('journeyLabelFromRecord formats L1 > L2', () => {
    expect(journeyLabelFromRecord(base)).toBe('公网访问 > 端口不通')
  })

  it('rankUrgentNegativeJourneys prioritizes urgent+negative journeys', () => {
    const rows = rankUrgentNegativeJourneys([
      base,
      { ...base, id: '2', journeyL1: '开通', journeyL2: '审批慢', sentiment: 'neutral_inquiry' },
      { ...base, id: '3', journeyL1: '公网访问', journeyL2: '端口不通', sentiment: 'strong_negative' },
    ])
    expect(rows[0].journeyLabel).toBe('公网访问 > 端口不通')
    expect(rows[0].urgentNegativeCount).toBe(2)
  })

  it('buildSentimentJourneyProblemCrossTab groups by journey and problem type', () => {
    const rows = buildSentimentJourneyProblemCrossTab([
      base,
      { ...base, id: '2', problemType: '性能', sentiment: 'mild_negative', urgencyLevel: 'none' },
      { ...base, id: '3', sentiment: 'strong_negative' },
    ])
    expect(rows).toHaveLength(2)
    const main = rows.find((r) => r.problemType === '连通性')
    expect(main?.total).toBe(2)
    expect(main?.urgentNegativeCount).toBe(2)
    expect(main?.sentiments.strong_negative).toBe(1)
    expect(main?.sentiments.negative).toBe(1)
  })
})
