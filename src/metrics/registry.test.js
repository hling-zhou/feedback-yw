import { describe, it, expect } from 'vitest'
import { getComparableMetrics, getMetricsForSource } from './registry.js'

describe('metrics registry', () => {
  it('exposes comparable metrics for overview', () => {
    const comparable = getComparableMetrics()
    expect(comparable.some((m) => m.id === 'record_count')).toBe(true)
    expect(comparable.every((m) => m.comparableAcrossSources)).toBe(true)
  })

  it('sentiment only on ticket sources', () => {
    const ticket = getMetricsForSource('complaint_ticket')
    const survey = getMetricsForSource('user_survey')
    expect(ticket.some((m) => m.id === 'sentiment_distribution')).toBe(true)
    expect(survey.some((m) => m.id === 'sentiment_distribution')).toBe(false)
  })
})
