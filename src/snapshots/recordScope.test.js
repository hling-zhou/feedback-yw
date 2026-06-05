import { describe, expect, it } from 'vitest'
import { buildSourceSnapshot } from './buildSourceSnapshot.js'
import {
  resolveSnapshotRecords,
  postUseRatingFollowUpHasContent,
  workbenchSourceHasContent,
  workbenchTicketRecords,
} from './recordScope.js'

describe('resolveSnapshotRecords', () => {
  it('drops records whose dataSourceType no longer matches snapshot', () => {
    const feedbacks = [
      { id: 'a', dataSourceType: 'consultation_ticket', importMonth: '2026-04' },
      { id: 'b', dataSourceType: 'complaint_ticket', importMonth: '2026-04' },
    ]
    const snapshot = {
      dataSourceType: 'complaint_ticket',
      recordIds: ['a', 'b'],
    }
    expect(resolveSnapshotRecords(feedbacks, snapshot).map((r) => r.id)).toEqual(['b'])
  })

  it('workbenchTicketRecords falls back to period scope when snapshot is rebuilding', () => {
    const period = {
      id: 'period:month:2026-04',
      granularity: 'month',
      anchorYear: 2026,
      anchorMonth: 4,
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      label: '2026-04',
    }
    const feedbacks = [
      {
        id: 'a',
        dataSourceType: 'consultation_ticket',
        importMonth: '2026-04',
        journeyL1: 'x',
        journeyL2: 'y',
      },
    ]
    const snapshot = {
      dataSourceType: 'consultation_ticket',
      status: 'rebuilding',
      recordIds: [],
    }
    expect(workbenchTicketRecords(feedbacks, period, snapshot)).toHaveLength(1)
    expect(
      workbenchSourceHasContent(feedbacks, period, snapshot),
    ).toBe(true)
  })

  it('post_use_rating tab has content when only follow-up ticket enrichments exist', () => {
    const period = {
      id: 'period:month:2026-04',
      granularity: 'month',
      anchorYear: 2026,
      anchorMonth: 4,
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      label: '2026-04',
    }
    const feedbacks = [
      {
        id: 't1',
        dataSourceType: 'complaint_ticket',
        importMonth: '2026-04',
        followUpSatisfaction: {
          followUpTicketId: 'FH-1',
          followUpSuccessful: true,
          score: 9,
          importMonth: '2026-04',
        },
      },
    ]
    const snapshot = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'post_use_rating',
      records: [],
      ticketRecordsForFollowUp: feedbacks,
    })
    expect(snapshot.summary.recordCount).toBe(0)
    expect(snapshot.aggregates.followUpSatisfactionMetrics?.scoredCount).toBe(1)
    expect(workbenchSourceHasContent(feedbacks, period, snapshot)).toBe(true)
    expect(postUseRatingFollowUpHasContent(feedbacks, period, null)).toBe(true)
  })
})
