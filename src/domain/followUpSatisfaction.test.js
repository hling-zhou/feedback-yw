import { describe, expect, it } from 'vitest'
import {
  applyFollowUpSatisfactionPatch,
  buildDissatisfiedReasonPartsFromRow,
  buildDissatisfiedReasonsSummary,
  buildFollowUpSatisfactionFromReportRow,
  collectMeaningfulDissatisfiedReasonTexts,
  formatFollowUpSatisfactionDisplay,
  hasFollowUpSatisfaction,
  normalizeFollowUpSatisfaction,
  parseFollowUpSatisfactionDisplay,
  parseFollowUpScore,
  parseProblemResolved,
  parseYesNo,
  resolveFollowUpDissatisfiedReasons,
  resolveFollowUpTrendMonth,
  SATISFACTION_CALLBACK_REPORT_COLUMNS,
} from './followUpSatisfaction.js'

describe('followUpSatisfaction', () => {
  it('parseYesNo recognizes common affirmative values', () => {
    expect(parseYesNo('是')).toBe(true)
    expect(parseYesNo('成功')).toBe(true)
    expect(parseYesNo('否')).toBe(false)
    expect(parseYesNo('')).toBe(false)
  })

  it('parseProblemResolved maps Chinese labels', () => {
    expect(parseProblemResolved('已解决')).toBe('resolved')
    expect(parseProblemResolved('未解决')).toBe('unresolved')
    expect(parseProblemResolved('')).toBe(null)
  })

  it('parseFollowUpScore accepts 1-10 only', () => {
    expect(parseFollowUpScore('10')).toBe(10)
    expect(parseFollowUpScore(7.4)).toBe(7)
    expect(parseFollowUpScore('0')).toBeUndefined()
    expect(parseFollowUpScore('x')).toBeUndefined()
  })

  it('buildDissatisfiedReasonsSummary joins non-empty parts', () => {
    const summary = buildDissatisfiedReasonsSummary({
      overallService: '响应慢',
      staffAttitudeReason: '态度一般',
    })
    expect(summary).toContain('整体服务情况不满意原因：响应慢')
    expect(summary).toContain('服务人员的服务态度不满意原因：态度一般')
  })

  it('buildDissatisfiedReasonsSummary omits placeholder 无 values', () => {
    expect(
      buildDissatisfiedReasonsSummary({
        handlingDurationScore: '无',
        handlingDurationReason: '无',
        staffAttitudeScore: '无',
        staffAttitudeReason: '无',
        staffCapabilityScore: '无',
        staffCapabilityReason: '无',
        phoneCallbackOpinion: '无',
      }),
    ).toBe('')
    expect(
      buildDissatisfiedReasonsSummary({
        overallService: '响应慢',
        phoneCallbackOpinion: '无',
      }),
    ).toBe('整体服务情况不满意原因：响应慢')
  })

  it('resolveFollowUpDissatisfiedReasons strips legacy summary segments with 无', () => {
    expect(
      resolveFollowUpDissatisfiedReasons({
        followUpTicketId: 'FH-1',
        followUpSuccessful: true,
        dissatisfiedReasons:
          '请您对问题处理时长进行评价：无；处理时长不满意原因：无；整体服务情况不满意原因：响应慢',
      }),
    ).toBe('整体服务情况不满意原因：响应慢')
    expect(
      resolveFollowUpDissatisfiedReasons({
        followUpTicketId: 'FH-2',
        followUpSuccessful: true,
        dissatisfiedReasons: '无',
      }),
    ).toBe('')
  })

  it('collectMeaningfulDissatisfiedReasonTexts prefers parts and filters placeholders', () => {
    expect(
      collectMeaningfulDissatisfiedReasonTexts({
        followUpTicketId: 'FH-1',
        followUpSuccessful: true,
        dissatisfiedReasonParts: {
          overallService: '响应慢',
          staffAttitudeReason: '无',
          phoneCallbackOpinion: '暂无',
        },
      }),
    ).toEqual(['响应慢'])

    expect(
      collectMeaningfulDissatisfiedReasonTexts({
        followUpTicketId: 'FH-2',
        followUpSuccessful: true,
        dissatisfiedReasons: '整体服务情况不满意原因：响应慢；处理时长不满意原因：无',
      }),
    ).toEqual(['响应慢'])
  })

  it('normalizeFollowUpSatisfaction builds summary from parts', () => {
    const fu = normalizeFollowUpSatisfaction({
      followUpTicketId: 'FH-001',
      followUpSuccessful: true,
      score: 8,
      problemResolved: 'unresolved',
      dissatisfiedReasonParts: { overallService: '太慢' },
    })
    expect(fu?.dissatisfiedReasons).toContain('太慢')
    expect(fu?.problemResolved).toBe('unresolved')
  })

  it('format and parse display round-trip', () => {
    const text = formatFollowUpSatisfactionDisplay({
      followUpTicketId: 'FH-1',
      followUpSuccessful: true,
      score: 10,
      problemResolved: 'resolved',
    })
    expect(text).toBe('10（已解决）')
    expect(parseFollowUpSatisfactionDisplay(text)).toEqual({
      score: 10,
      problemResolved: 'resolved',
    })
  })

  it('resolveFollowUpTrendMonth prefers follow-up importMonth', () => {
    expect(
      resolveFollowUpTrendMonth({ importMonth: '2026-03' }, '2026-01'),
    ).toBe('2026-03')
    expect(resolveFollowUpTrendMonth({}, '2026-01')).toBe('2026-01')
    expect(resolveFollowUpTrendMonth({}, '')).toBe('')
  })

  it('buildFollowUpSatisfactionFromReportRow parses report columns', () => {
    const row = {
      [SATISFACTION_CALLBACK_REPORT_COLUMNS.followUpTicketId]: 'FH-99',
      [SATISFACTION_CALLBACK_REPORT_COLUMNS.followUpSuccessful]: '是',
      [SATISFACTION_CALLBACK_REPORT_COLUMNS.score]: '9',
      [SATISFACTION_CALLBACK_REPORT_COLUMNS.problemResolved]: '已解决',
      [SATISFACTION_CALLBACK_REPORT_COLUMNS.overallService]: '无',
    }
    const fu = buildFollowUpSatisfactionFromReportRow(row, { importMonth: '2026-05' })
    expect(fu?.followUpTicketId).toBe('FH-99')
    expect(fu?.followUpSuccessful).toBe(true)
    expect(fu?.score).toBe(9)
    expect(fu?.importMonth).toBe('2026-05')
    expect(fu?.dissatisfiedReasonParts?.overallService).toBeUndefined()
    expect(fu?.dissatisfiedReasons).toBeUndefined()
  })

  it('applyFollowUpSatisfactionPatch merges without dropping ticket fields', () => {
    const record = {
      id: 'r1',
      ticketId: 'T-001',
      rawText: 'text',
      customerQuote: '',
      requestScene: '场景',
      problemType: '类型',
      journeyL1: '使用',
      journeyL2: '环节',
      problemSummary: '痛点',
      solutionSummary: '',
      rootCause: '',
      optimizationSuggestion: '',
      sentiment: 'neutral',
      themes: [],
      status: 'open',
      importedAt: '2026-01-01',
    }
    const next = applyFollowUpSatisfactionPatch(
      record,
      {
        followUpTicketId: 'FH-1',
        followUpSuccessful: true,
        score: 10,
        problemResolved: 'resolved',
      },
      { outOfPeriodWarning: true },
    )
    expect(next.ticketId).toBe('T-001')
    expect(next.followUpSatisfaction?.score).toBe(10)
    expect(next.outOfPeriodWarning).toBe(true)
    expect(hasFollowUpSatisfaction(next)).toBe(true)
  })

  it('buildDissatisfiedReasonPartsFromRow reads headers', () => {
    const parts = buildDissatisfiedReasonPartsFromRow({
      [SATISFACTION_CALLBACK_REPORT_COLUMNS.phoneCallbackOpinion]: '希望加快',
    })
    expect(parts.phoneCallbackOpinion).toBe('希望加快')
  })
})
