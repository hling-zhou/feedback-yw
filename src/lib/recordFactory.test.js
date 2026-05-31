import { describe, expect, it } from 'vitest'
import { createTicketRecord } from './recordFactory.js'

describe('createTicketRecord', () => {
  it('preserves complaint cause final fields from import pipeline', () => {
    const record = createTicketRecord({
      dataSourceType: 'complaint_ticket',
      rawText: 'x',
      customerQuote: 'x',
      complaintCauseL1Final: '客户体验类投诉',
      complaintCauseL2Final: '客户其他问题',
      complaintCauseL3Final: '客户自身其他问题',
    })
    expect(record.complaintCauseL1Final).toBe('客户体验类投诉')
    expect(record.complaintCauseL2Final).toBe('客户其他问题')
    expect(record.complaintCauseL3Final).toBe('客户自身其他问题')
  })

  it('preserves customerTier from import', () => {
    const record = createTicketRecord({
      dataSourceType: 'complaint_ticket',
      rawText: 'x',
      customerQuote: 'x',
      customerTier: '金牌',
    })
    expect(record.customerTier).toBe('金牌')
  })
})
