import { describe, it, expect } from 'vitest'
import { buildDedupeKey, isTicketRecord, recordKind } from './records.js'
import { createTicketRecord } from '../lib/recordFactory.js'

describe('records', () => {
  it('buildDedupeKey includes dataSourceType', () => {
    const key = buildDedupeKey({
      dataSourceType: 'complaint_ticket',
      importMonth: '2025-05',
      ticketId: '123',
    })
    expect(key).toBe('complaint_ticket::2025-05::ticket::123')
  })

  it('buildDedupeKey falls back to record id when ticketId missing', () => {
    const a = buildDedupeKey({
      dataSourceType: 'complaint_ticket',
      importMonth: '2026-04',
      id: 'uuid-a',
    })
    const b = buildDedupeKey({
      dataSourceType: 'complaint_ticket',
      importMonth: '2026-04',
      id: 'uuid-b',
    })
    expect(a).not.toBe(b)
    expect(a).toContain('uuid-a')
  })

  it('buildDedupeKey does not collapse rows with empty ticketId', () => {
    const key = buildDedupeKey({
      dataSourceType: 'complaint_ticket',
      importMonth: '2026-04',
      ticketId: '',
    })
    expect(key).toBe('')
  })

  it('recordKind distinguishes ticket sources', () => {
    expect(recordKind('consultation_ticket')).toBe('ticket')
    expect(recordKind('user_survey')).toBe('survey')
  })

  it('isTicketRecord for complaint ticket', () => {
    const r = createTicketRecord({ rawText: 'a', customerQuote: 'b' })
    expect(isTicketRecord(r)).toBe(true)
  })
})
