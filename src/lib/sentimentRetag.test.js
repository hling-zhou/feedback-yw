import { describe, expect, it } from 'vitest'
import { retagRecordSentiment } from './sentimentRetag.js'

const complaint = {
  id: 'c1',
  dataSourceType: 'complaint_ticket',
  rawText: '云主机开通20M共享带宽，现在实测仅40k',
  sentiment: 'negative',
  urgencyLevel: 'none',
  requestScene: '报障与排错',
  problemType: '性能问题',
  journeyL1: '使用中',
}

describe('retagRecordSentiment', () => {
  it('rewrites sentiment and leaves other tags alone', () => {
    const result = retagRecordSentiment(complaint)
    expect(result.changed).toBe(true)
    expect(result.record.sentiment).toBe('neutral_general')
    expect(result.record.requestScene).toBe('报障与排错')
    expect(result.record.problemType).toBe('性能问题')
    expect(result.record.journeyL1).toBe('使用中')
  })

  it('keeps a manually saved sentiment unless forced', () => {
    const manual = { ...complaint, manualTagFields: ['sentiment'] }
    const kept = retagRecordSentiment(manual)
    expect(kept.keptManual).toBe(true)
    expect(kept.changed).toBe(false)
    expect(kept.record.sentiment).toBe('negative')

    const forced = retagRecordSentiment(manual, { forceOverrideManualTags: true })
    expect(forced.record.sentiment).toBe('neutral_general')
    expect(forced.changed).toBe(true)
  })

  it('skips non-ticket records', () => {
    const result = retagRecordSentiment({
      ...complaint,
      dataSourceType: 'post_use_rating',
    })
    expect(result.skipped).toBe(true)
    expect(result.record.sentiment).toBe('negative')
  })
})
