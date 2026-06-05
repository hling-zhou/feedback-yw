/**
 * 回访满意度端到端集成：导入 → 指标 → 下钻筛选 → 导出往返。
 * @see docs/TEST-PLAN.md TAG-FU-08～15
 */

import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../domain/constants.js'
import { createInsightPeriod } from '../domain/insightPeriod.js'
import { SATISFACTION_CALLBACK_REPORT_COLUMNS as COLS } from '../domain/followUpSatisfaction.js'
import { applyImportReplace } from '../domain/overridePolicy.js'
import { buildSourceSnapshot } from '../snapshots/buildSourceSnapshot.js'
import { filterRecordsForScope } from '../snapshots/recordScope.js'
import {
  buildFollowUpDrillDownUrl,
  matchesFollowUpFilters,
  parseFeedbackFollowUpSearchParams,
} from './feedbackFilters.js'
import {
  buildFollowUpSatisfactionMetrics,
  computeTenPointRateByMonth,
  filterFollowUpScoredRecords,
} from './followUpSatisfactionAnalytics.js'
import { processFollowUpSatisfactionImportRows } from './followUpSatisfactionImport.js'
import {
  formatExportSourceMonthSheetName,
  getExportV3Headers,
  groupRecordsBySourceAndMonth,
  recordToExportRowV3,
} from './ticketAnalysisExport.js'

/** @param {Partial<import('./types.js').FeedbackRecord>} overrides */
function ticket(overrides = {}) {
  return {
    id: 't-base',
    dataSourceType: 'complaint_ticket',
    ticketId: 'TK-1001',
    importMonth: '2026-05',
    product: '云主机',
    requestScene: '报障',
    problemType: '故障',
    ...overrides,
  }
}

function makeImportRow(overrides = {}) {
  return {
    [COLS.followUpTicketId]: 'FH-INT-001',
    [COLS.originalTicketId]: 'TK-1001',
    [COLS.product]: '云主机',
    [COLS.followUpSuccessful]: '是',
    [COLS.problemResolved]: '否',
    [COLS.score]: '8',
    [COLS.overallService]: '响应慢',
    ...overrides,
  }
}

describe('followUpSatisfaction integration', () => {
  it('import patch → 10 分率分母仅含回访成功且有评分工单', () => {
    const tickets = [
      ticket({ id: 't1', ticketId: 'TK-1001' }),
      ticket({ id: 't2', ticketId: 'TK-1002' }),
      ticket({
        id: 't3',
        ticketId: 'TK-1003',
        followUpSatisfaction: {
          followUpTicketId: 'FH-OLD',
          followUpSuccessful: false,
          score: 10,
        },
      }),
    ]

    const importResult = processFollowUpSatisfactionImportRows(
      [makeImportRow()],
      tickets,
      { importMonth: '2026-06' },
    )
    expect(importResult.updatedRecordCount).toBe(1)

    const merged = tickets.map((t) =>
      importResult.updatedRecords.find((u) => u.id === t.id) || t,
    )

    expect(filterFollowUpScoredRecords(merged)).toHaveLength(1)
    const rateRows = computeTenPointRateByMonth(merged)
    expect(rateRows).toEqual([
      { month: '2026-06', tenCount: 0, total: 1, rate: 0 },
    ])
  })

  it('idempotent re-import with same followUpTicketId updates score in metrics', () => {
    const tickets = [ticket()]
    const first = processFollowUpSatisfactionImportRows([makeImportRow()], tickets, {
      importMonth: '2026-06',
    })
    const patched = first.updatedRecords[0]

    const second = processFollowUpSatisfactionImportRows(
      [makeImportRow({ [COLS.score]: '10', [COLS.problemResolved]: '是' })],
      [patched],
      { importMonth: '2026-06' },
    )
    const finalRecord = second.updatedRecords[0]
    expect(finalRecord.followUpSatisfaction?.score).toBe(10)

    const metrics = buildFollowUpSatisfactionMetrics([finalRecord])
    expect(metrics.tenPointRateByMonth).toEqual([
      { month: '2026-06', tenCount: 1, total: 1, rate: 1 },
    ])
  })

  it('export v3 sheet grouping by source + month', () => {
    const records = [
      ticket({ id: 'a', importMonth: '2026-05' }),
      ticket({
        id: 'b',
        dataSourceType: 'consultation_ticket',
        importMonth: '2026-05',
      }),
    ]
    const groups = groupRecordsBySourceAndMonth(records)
    expect(groups.size).toBe(2)
    expect(formatExportSourceMonthSheetName('complaint_ticket', '2026-05')).toBe(
      '投诉工单-2026年5月',
    )
    expect(formatExportSourceMonthSheetName('consultation_ticket', '2026-05')).toBe(
      '咨询工单-2026年5月',
    )
    expect(getExportV3Headers()).toContain('回访满意度')
  })

  it('export row → IMPORT_REPLACE round-trip preserves follow-up fields', () => {
    const record = ticket({
      followUpSatisfaction: {
        followUpTicketId: 'FH-RT',
        followUpSuccessful: true,
        score: 9,
        problemResolved: 'unresolved',
        dissatisfiedReasons: '响应慢',
        importMonth: '2026-05',
      },
    })
    const row = recordToExportRowV3(record)

    const imported = applyImportReplace(record, row)
    expect(imported.followUpSatisfaction?.score).toBe(9)
    expect(imported.followUpSatisfaction?.dissatisfiedReasons).toBe('响应慢')
  })

  it('drill-down URL params match chart non-10 subset', () => {
    const record = ticket({
      followUpSatisfaction: {
        followUpTicketId: 'FH-DRILL',
        followUpSuccessful: true,
        score: 7,
        problemResolved: 'unresolved',
        dissatisfiedReasonParts: { overallService: '响应慢' },
        importMonth: '2026-05',
      },
    })

    const url = buildFollowUpDrillDownUrl({
      productName: '云主机',
      requestScene: '报障',
      reasonDim: 'overallService',
    })
    const params = parseFeedbackFollowUpSearchParams(new URL(url, 'http://local').searchParams)

    expect(matchesFollowUpFilters(record, params)).toBe(true)
    expect(params.followUp).toBe('non10')
  })

  it('post_use_rating snapshot embeds followUpSatisfactionMetrics after import', () => {
    const importResult = processFollowUpSatisfactionImportRows(
      [makeImportRow({ [COLS.score]: '10', [COLS.problemResolved]: '是' })],
      [ticket()],
      { importMonth: '2026-06' },
    )
    const enriched = importResult.updatedRecords[0]

    const snap = buildSourceSnapshot({
      insightPeriodId: 'p1',
      dataSourceType: 'post_use_rating',
      records: [],
      ticketRecordsForFollowUp: [enriched],
    })

    expect(snap.aggregates.followUpSatisfactionMetrics?.scoredCount).toBe(1)
    expect(snap.aggregates.followUpSatisfactionMetrics?.tenPointRateByMonth[0]?.rate).toBe(1)
  })

  it('outOfPeriodWarning set when ticket outside import period', () => {
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
    const result = processFollowUpSatisfactionImportRows(
      [makeImportRow()],
      [ticket({ importMonth: '2026-05' })],
      { importMonth: '2026-06', period },
    )
    expect(result.outOfPeriodCount).toBe(1)
    expect(result.updatedRecords[0].outOfPeriodWarning).toBe(true)
  })

  it('follow-up snapshot metrics respect insight period scope on ticket records', () => {
    const period = createInsightPeriod(
      {
        label: '2026-05',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        granularity: 'month',
        anchorYear: 2026,
        anchorMonth: 5,
        status: 'active',
      },
      SCHEMA_VERSION,
    )
    const inPeriod = ticket({
      id: 'in-period',
      importMonth: '2026-05',
      followUpSatisfaction: {
        followUpTicketId: 'FH-IN',
        followUpSuccessful: true,
        score: 10,
        importMonth: '2026-05',
      },
    })
    const outOfPeriod = ticket({
      id: 'out-period',
      importMonth: '2026-04',
      followUpSatisfaction: {
        followUpTicketId: 'FH-OUT',
        followUpSuccessful: true,
        score: 8,
        importMonth: '2026-04',
      },
    })
    const allTickets = [inPeriod, outOfPeriod]
    const ticketRecordsForFollowUp = [
      ...filterRecordsForScope(allTickets, period, 'complaint_ticket'),
      ...filterRecordsForScope(allTickets, period, 'consultation_ticket'),
    ]

    const snap = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'post_use_rating',
      records: [],
      ticketRecordsForFollowUp,
    })

    expect(ticketRecordsForFollowUp).toHaveLength(1)
    expect(snap.aggregates.followUpSatisfactionMetrics?.scoredCount).toBe(1)
  })
})
