import { describe, expect, it } from 'vitest'
import {
  diagnoseUnknownJourneyReason,
  formatBulkRetagResultMessage,
  summarizeUnknownJourneyRecords,
} from './journeyRetagSummary.js'

describe('journeyRetagSummary', () => {
  it('diagnoses empty and short text', () => {
    expect(
      diagnoseUnknownJourneyReason({
        id: '1',
        journeyL1: '未识别环节',
        handlingText: '',
      }),
    ).toBe('empty_text')
    expect(
      diagnoseUnknownJourneyReason({
        id: '2',
        journeyL1: '未识别环节',
        handlingText: '无法判断',
      }),
    ).toBe('short_text')
  })

  it('summarizes unknown records by reason', () => {
    const summary = summarizeUnknownJourneyRecords([
      { id: '1', journeyL1: '未识别环节', handlingText: '' },
      { id: '2', journeyL1: '未识别环节', handlingText: 'x' },
      { id: '3', journeyL1: '开通与配置', journeyL2: '创建实例' },
    ])
    expect(summary.count).toBe(2)
    expect(summary.reasons.empty_text).toBe(1)
    expect(summary.reasons.short_text).toBe(1)
  })

  it('formats bulk retag result message', () => {
    const msg = formatBulkRetagResultMessage({
      total: 100,
      beforeUnknown: 19,
      afterUnknown: 5,
      summary: summarizeUnknownJourneyRecords([
        { id: '1', journeyL1: '未识别环节', handlingText: '' },
        { id: '2', journeyL1: '未识别环节', handlingText: 'abc' },
      ]),
    })
    expect(msg).toContain('新识别 14 条')
    expect(msg).toContain('仍 5 条')
    expect(msg).toContain('打标正文为空')
  })
})
