import { describe, it, expect } from 'vitest'
import {
  buildExistingTicketKeySet,
  filterDuplicateImportRows,
} from './importDedupe.js'

describe('importDedupe', () => {
  it('skips rows whose ticketId already exists, regardless of importMonth', () => {
    const existingKeys = buildExistingTicketKeySet(['T-1'], 'complaint_ticket')
    const { uniqueRows, skippedCount } = filterDuplicateImportRows(
      [
        { ticketId: 'T-1', importMonth: '2026-07' },
        { ticketId: 'T-2', importMonth: '2026-07' },
      ],
      { dataSourceType: 'complaint_ticket', existingKeys },
    )
    expect(uniqueRows).toHaveLength(1)
    expect(uniqueRows[0].ticketId).toBe('T-2')
    expect(skippedCount).toBe(1)
  })

  it('matches after normalization on both sides (trim / trailing .0)', () => {
    const existingKeys = buildExistingTicketKeySet(['123'], 'complaint_ticket')
    const { uniqueRows, skippedCount } = filterDuplicateImportRows(
      [{ ticketId: ' 123.0 ' }],
      { dataSourceType: 'complaint_ticket', existingKeys },
    )
    expect(uniqueRows).toHaveLength(0)
    expect(skippedCount).toBe(1)
  })

  it('dedupes within the same batch, keeping the first row', () => {
    const { uniqueRows, skippedCount } = filterDuplicateImportRows(
      [
        { ticketId: 'T-9', rawText: 'first' },
        { ticketId: 'T-9', rawText: 'second' },
      ],
      { dataSourceType: 'complaint_ticket' },
    )
    expect(uniqueRows).toHaveLength(1)
    expect(uniqueRows[0].rawText).toBe('first')
    expect(skippedCount).toBe(1)
  })

  it('lets rows with empty ticketId pass through', () => {
    const { uniqueRows, skippedCount } = filterDuplicateImportRows(
      [{ ticketId: '' }, {}, { ticketId: '   ' }],
      { dataSourceType: 'complaint_ticket', existingKeys: new Set(['x']) },
    )
    expect(uniqueRows).toHaveLength(3)
    expect(skippedCount).toBe(0)
  })

  it('does not skip when dataSourceType differs', () => {
    const existingKeys = buildExistingTicketKeySet(['T-1'], 'consultation_ticket')
    const { uniqueRows, skippedCount } = filterDuplicateImportRows(
      [{ ticketId: 'T-1' }],
      { dataSourceType: 'complaint_ticket', existingKeys },
    )
    expect(uniqueRows).toHaveLength(1)
    expect(skippedCount).toBe(0)
  })

  it('does not mutate the caller-provided existingKeys set', () => {
    const existingKeys = buildExistingTicketKeySet(['T-1'], 'complaint_ticket')
    filterDuplicateImportRows([{ ticketId: 'T-2' }], {
      dataSourceType: 'complaint_ticket',
      existingKeys,
    })
    expect(existingKeys.size).toBe(1)
  })
})
