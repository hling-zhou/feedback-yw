import { describe, expect, it } from 'vitest'
import {
  buildTicketRecordIndex,
  processFollowUpSatisfactionImportRows,
} from './followUpSatisfactionImport.js'
import { SATISFACTION_CALLBACK_REPORT_COLUMNS as COLS } from '../domain/followUpSatisfaction.js'
import { createInsightPeriod } from '../domain/insightPeriod.js'
import { SCHEMA_VERSION } from '../domain/constants.js'

const baseTicket = {
  id: 'rec-1',
  dataSourceType: 'complaint_ticket',
  ticketId: 'T-100',
  product: '云主机',
  rawText: 'x',
  customerQuote: '',
  requestScene: '报障',
  problemType: '功能',
  journeyL1: '使用',
  journeyL2: '环节',
  problemSummary: 'p',
  solutionSummary: '',
  rootCause: '',
  optimizationSuggestion: '',
  sentiment: 'neutral',
  themes: [],
  status: 'open',
  importedAt: '2026-05-01',
  importMonth: '2026-05',
  createdAt: '2026-05-10',
}

function makeRow(overrides = {}) {
  return {
    [COLS.followUpTicketId]: 'FH-001',
    [COLS.originalTicketId]: 'T-100',
    [COLS.followUpSuccessful]: '是',
    [COLS.score]: '10',
    [COLS.problemResolved]: '已解决',
    ...overrides,
  }
}

describe('followUpSatisfactionImport', () => {
  it('buildTicketRecordIndex prefers complaint over consultation for same ticketId', () => {
    const consultation = { ...baseTicket, id: 'c1', dataSourceType: 'consultation_ticket' }
    const complaint = { ...baseTicket, id: 'c2', dataSourceType: 'complaint_ticket' }
    const { byTicketId } = buildTicketRecordIndex([consultation, complaint])
    expect(byTicketId.get('T-100')?.id).toBe('c2')
  })

  it('applies follow-up to matched ticket', () => {
    const result = processFollowUpSatisfactionImportRows([makeRow()], [baseTicket], {
      importMonth: '2026-06',
      importBatchId: 'batch-1',
    })
    expect(result.updatedRecordCount).toBe(1)
    expect(result.appliedRowCount).toBe(1)
    expect(result.updatedRecords[0].followUpSatisfaction?.score).toBe(10)
    expect(result.updatedRecords[0].followUpSatisfaction?.importMonth).toBe('2026-06')
  })

  it('skips unsuccessful follow-up rows', () => {
    const result = processFollowUpSatisfactionImportRows(
      [makeRow({ [COLS.followUpSuccessful]: '否' })],
      [baseTicket],
      { importMonth: '2026-06' },
    )
    expect(result.skippedNotSuccessful).toBe(1)
    expect(result.updatedRecordCount).toBe(0)
  })

  it('records unmatched original ticket', () => {
    const result = processFollowUpSatisfactionImportRows(
      [makeRow({ [COLS.originalTicketId]: 'T-MISSING' })],
      [baseTicket],
      { importMonth: '2026-06' },
    )
    expect(result.unmatched).toHaveLength(1)
    expect(result.unmatched[0].reason).toMatch(/未找到/)
  })

  it('sets outOfPeriodWarning when ticket outside selected period', () => {
    const period = createInsightPeriod(
      {
        label: '2026-Q1',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        granularity: 'quarter',
        anchorYear: 2026,
        anchorQuarter: 1,
        status: 'active',
      },
      SCHEMA_VERSION,
    )
    const result = processFollowUpSatisfactionImportRows([makeRow()], [baseTicket], {
      importMonth: '2026-06',
      period,
    })
    expect(result.outOfPeriodCount).toBe(1)
    expect(result.updatedRecords[0].outOfPeriodWarning).toBe(true)
  })

  it('overwrites previous follow-up on same ticket', () => {
    const withOld = {
      ...baseTicket,
      followUpSatisfaction: {
        followUpTicketId: 'FH-OLD',
        followUpSuccessful: true,
        score: 6,
      },
    }
    const result = processFollowUpSatisfactionImportRows([makeRow()], [withOld], {
      importMonth: '2026-06',
    })
    expect(result.overwrittenCount).toBe(1)
    expect(result.updatedRecords[0].followUpSatisfaction?.followUpTicketId).toBe('FH-001')
  })

  it('skips successful follow-up without valid score and records warning', () => {
    const result = processFollowUpSatisfactionImportRows(
      [makeRow({ [COLS.score]: '' })],
      [baseTicket],
      { importMonth: '2026-06' },
    )
    expect(result.skippedInvalidScore).toBe(1)
    expect(result.updatedRecordCount).toBe(0)
    expect(result.warnings[0]?.message).toMatch(/评分/)
  })

  it('rejects duplicate followUpTicketId bound to different original tickets in batch', () => {
    const ticketB = { ...baseTicket, id: 'rec-2', ticketId: 'T-200' }
    const result = processFollowUpSatisfactionImportRows(
      [
        makeRow({ [COLS.originalTicketId]: 'T-100', [COLS.followUpTicketId]: 'FH-DUP' }),
        makeRow({ [COLS.originalTicketId]: 'T-200', [COLS.followUpTicketId]: 'FH-DUP' }),
      ],
      [baseTicket, ticketB],
      { importMonth: '2026-06' },
    )
    expect(result.updatedRecordCount).toBe(1)
    expect(result.unmatched).toHaveLength(1)
    expect(result.unmatched[0].reason).toMatch(/本批次/)
  })
})
