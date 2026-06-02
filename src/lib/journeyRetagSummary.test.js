import { describe, expect, it } from 'vitest'
import {
  diagnoseUnknownJourneyReason,
  formatBulkRetagResultMessage,
  summarizeRetagPainPointChanges,
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

  it('summarizeRetagPainPointChanges detects material pain point updates', () => {
    const delta = summarizeRetagPainPointChanges(
      Array.from({ length: 100 }, (_, index) => ({
        id: `r-${index}`,
        painPoint: `旧-${index}`,
      })),
      Array.from({ length: 100 }, (_, index) => ({
        id: `r-${index}`,
        painPoint: index < 2 ? `新-${index}` : `旧-${index}`,
      })),
    )
    expect(delta.changed).toBe(2)
    expect(delta.shouldPromptInsightRefresh).toBe(false)

    const material = summarizeRetagPainPointChanges(
      Array.from({ length: 10 }, (_, index) => ({
        id: `r-${index}`,
        painPoint: `旧-${index}`,
      })),
      Array.from({ length: 10 }, (_, index) => ({
        id: `r-${index}`,
        painPoint: index < 3 ? `新-${index}` : `旧-${index}`,
      })),
    )
    expect(material.changed).toBe(3)
    expect(material.shouldPromptInsightRefresh).toBe(true)
  })

  it('formatBulkRetagResultMessage prompts insight refresh when pain points changed materially', () => {
    const msg = formatBulkRetagResultMessage({
      total: 20,
      beforeUnknown: 0,
      afterUnknown: 0,
      summary: summarizeUnknownJourneyRecords([]),
      painPointDelta: {
        changed: 5,
        total: 20,
        changeRate: 0.25,
        newlyFilled: 2,
        cleared: 0,
        shouldPromptInsightRefresh: true,
      },
    })
    expect(msg).toContain('需求痛点：5 条已变更')
    expect(msg).toContain('刷新洞察')
  })
})
