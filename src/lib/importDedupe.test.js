import { describe, it, expect } from 'vitest'
import {
  buildExistingTicketKeySet,
  filterDuplicateImportRows,
} from './importDedupe.js'

describe('importDedupe', () => {
  it('keeps rows even when ticketId already exists in the system', () => {
    const { uniqueRows, skippedCount } = filterDuplicateImportRows(
      [
        { ticketId: 'T-1', importMonth: '2026-07' },
        { ticketId: 'T-2', importMonth: '2026-07' },
      ],
      { dataSourceType: 'complaint_ticket' },
    )
    expect(uniqueRows).toHaveLength(2)
    expect(skippedCount).toBe(0)
    expect(buildExistingTicketKeySet(['T-1'], 'complaint_ticket').size).toBe(1)
  })

  it('dedupes within the same batch, keeping the last row', () => {
    const { uniqueRows, skippedCount } = filterDuplicateImportRows(
      [
        { ticketId: 'T-9', rawText: 'first' },
        { ticketId: 'T-9', rawText: 'second' },
      ],
      { dataSourceType: 'complaint_ticket' },
    )
    expect(uniqueRows).toHaveLength(1)
    expect(uniqueRows[0].rawText).toBe('second')
    expect(skippedCount).toBe(1)
  })

  it('lets rows with empty ticketId pass through', () => {
    const { uniqueRows, skippedCount } = filterDuplicateImportRows(
      [{ ticketId: '' }, {}, { ticketId: '   ' }],
      { dataSourceType: 'complaint_ticket' },
    )
    expect(uniqueRows).toHaveLength(3)
    expect(skippedCount).toBe(0)
  })

  it('normalizes ticket ids when collapsing batch duplicates', () => {
    const { uniqueRows, skippedCount } = filterDuplicateImportRows(
      [
        { ticketId: '123.0', rawText: 'old' },
        { ticketId: ' 123 ', rawText: 'new' },
      ],
      { dataSourceType: 'complaint_ticket' },
    )
    expect(uniqueRows).toHaveLength(1)
    expect(uniqueRows[0].rawText).toBe('new')
    expect(skippedCount).toBe(1)
  })
})
