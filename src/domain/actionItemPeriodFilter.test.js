import { describe, expect, it } from 'vitest'
import {
  actionItemHasLinkedTicketInPeriod,
  buildTicketIdSetFromRecords,
  linkedTicketIdsInPeriod,
} from './actionItemPeriodFilter.js'

describe('actionItemPeriodFilter', () => {
  it('buildTicketIdSetFromRecords collects non-empty ticketId', () => {
    const set = buildTicketIdSetFromRecords([
      { ticketId: 'T-1' },
      { ticketId: '  T-2  ' },
      { ticketId: '' },
      {},
    ])
    expect([...set]).toEqual(['T-1', 'T-2'])
  })

  it('actionItemHasLinkedTicketInPeriod respects period ticket set', () => {
    const item = { linkedTicketIds: ['A', 'B'] }
    expect(actionItemHasLinkedTicketInPeriod(item, null)).toBe(true)
    expect(actionItemHasLinkedTicketInPeriod(item, new Set())).toBe(false)
    expect(actionItemHasLinkedTicketInPeriod(item, new Set(['B']))).toBe(true)
    expect(actionItemHasLinkedTicketInPeriod(item, new Set(['C']))).toBe(false)
    expect(
      actionItemHasLinkedTicketInPeriod({ linkedTicketIds: [] }, new Set(['T-1'])),
    ).toBe(true)
  })

  it('linkedTicketIdsInPeriod filters display ids', () => {
    expect(linkedTicketIdsInPeriod(['A', 'B', 'C'], new Set(['B', 'C']))).toEqual(['B', 'C'])
    expect(linkedTicketIdsInPeriod(['A'], null)).toEqual(['A'])
  })
})
