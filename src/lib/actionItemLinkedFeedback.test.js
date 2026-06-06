import { describe, expect, it } from 'vitest'
import {
  buildFeedbackIndexByTicketId,
  groupLinkedTicketIdsByMonth,
  formatLinkedTicketIdsGroupedForExport,
  UNKNOWN_LINKED_FEEDBACK_MONTH,
} from './actionItemLinkedFeedback.js'

describe('actionItemLinkedFeedback', () => {
  const index = buildFeedbackIndexByTicketId([
    { ticketId: 'T-1', importMonth: '2026-04' },
    { ticketId: 'T-2', importMonth: '2026-05' },
    { ticketId: 'T-3', importMonth: '2026-05' },
  ])

  it('buildFeedbackIndexByTicketId indexes by ticketId', () => {
    expect(index.get('T-1')?.importMonth).toBe('2026-04')
    expect(index.size).toBe(3)
  })

  it('groupLinkedTicketIdsByMonth groups by importMonth descending', () => {
    const groups = groupLinkedTicketIdsByMonth(['T-1', 'T-2', 'T-3', 'T-9'], index)
    expect(groups).toEqual([
      {
        month: '2026-05',
        label: '2026年5月',
        ticketIds: ['T-2', 'T-3'],
      },
      {
        month: '2026-04',
        label: '2026年4月',
        ticketIds: ['T-1'],
      },
      {
        month: UNKNOWN_LINKED_FEEDBACK_MONTH,
        label: UNKNOWN_LINKED_FEEDBACK_MONTH,
        ticketIds: ['T-9'],
      },
    ])
  })

  it('formatLinkedTicketIdsGroupedForExport joins month buckets', () => {
    const groups = groupLinkedTicketIdsByMonth(['T-2', 'T-1'], index)
    expect(formatLinkedTicketIdsGroupedForExport(groups)).toBe(
      '2026-05: T-2\n2026-04: T-1',
    )
  })
})
