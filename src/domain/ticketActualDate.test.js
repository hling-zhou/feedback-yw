import { describe, expect, it } from 'vitest'
import {
  extractTicketActualDate,
  matchesTicketActualDateRange,
  parseTicketDateFilterParam,
} from './ticketActualDate.js'

describe('ticketActualDate', () => {
  it('extractTicketActualDate parses YYYYMMDD prefix from ticket id', () => {
    expect(extractTicketActualDate('20260511192237X557699887')).toBe('2026-05-11')
    expect(extractTicketActualDate(' 20260101000000ABC ')).toBe('2026-01-01')
  })

  it('extractTicketActualDate rejects invalid calendar dates and non-standard ids', () => {
    expect(extractTicketActualDate('20260230X123')).toBeNull()
    expect(extractTicketActualDate('WO-12345')).toBeNull()
    expect(extractTicketActualDate('')).toBeNull()
  })

  it('parseTicketDateFilterParam validates YYYY-MM-DD', () => {
    expect(parseTicketDateFilterParam('2026-05-11')).toBe('2026-05-11')
    expect(parseTicketDateFilterParam('2026-13-01')).toBeNull()
  })

  it('matchesTicketActualDateRange filters ticket records by inclusive range', () => {
    const record = {
      dataSourceType: 'complaint_ticket',
      ticketId: '20260511192237X557699887',
    }
    expect(matchesTicketActualDateRange(record, {})).toBe(true)
    expect(matchesTicketActualDateRange(record, { from: '2026-05-01', to: '2026-05-31' })).toBe(true)
    expect(matchesTicketActualDateRange(record, { from: '2026-05-12' })).toBe(false)
    expect(matchesTicketActualDateRange(record, { to: '2026-05-10' })).toBe(false)
    expect(
      matchesTicketActualDateRange(
        { dataSourceType: 'post_use_rating', ticketId: '20260511192237X557699887' },
        { from: '2026-05-01' },
      ),
    ).toBe(false)
  })
})
