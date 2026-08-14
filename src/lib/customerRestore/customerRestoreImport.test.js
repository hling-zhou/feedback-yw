import { describe, expect, it } from 'vitest'
import {
  applyCustomerRestoreToRecords,
  parseAndValidateCustomerRestoreSheet,
  patchCustomerRestoreFields,
} from './customerRestoreImport.js'

function ticket(overrides = {}) {
  return {
    id: 'c1',
    ticketId: 'T-100',
    dataSourceType: 'complaint_ticket',
    customerName: '',
    customerCode: '',
    sourceColumns: { 集团名称: '脱敏客户' },
    ...overrides,
  }
}

describe('customerRestoreImport', () => {
  it('requires 工单号 and at least one identity column', () => {
    const missingTicket = parseAndValidateCustomerRestoreSheet({
      headers: ['集团名称'],
      rows: [{ 集团名称: '甲公司' }],
    })
    expect(missingTicket.ok).toBe(false)
    expect(missingTicket.fileError).toContain('工单号')

    const missingIdentity = parseAndValidateCustomerRestoreSheet({
      headers: ['工单号'],
      rows: [{ 工单号: 'T-100' }],
    })
    expect(missingIdentity.ok).toBe(false)
    expect(missingIdentity.fileError).toContain('客户信息')
  })

  it('accepts 客户名称 / 客户编码 aliases and merges duplicate ticket rows', () => {
    const result = parseAndValidateCustomerRestoreSheet({
      headers: ['工单号*', '客户名称', '客户编码'],
      rows: [
        { '工单号*': 'T-100', 客户名称: '甲公司', 客户编码: '' },
        { '工单号*': 'T-100', 客户名称: '', 客户编码: 'C001' },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.validRows).toHaveLength(1)
    expect(result.validRows[0].fields).toEqual({
      集团名称: '甲公司',
      集团客户编码: 'C001',
    })
  })

  it('does not overwrite existing values with empty cells', () => {
    const next = patchCustomerRestoreFields(ticket(), {
      集团名称: '甲公司',
    })
    expect(next.customerName).toBe('甲公司')
    expect(next.sourceColumns['集团名称']).toBe('甲公司')

    const unchanged = patchCustomerRestoreFields(next, {})
    expect(unchanged).toBe(next)
    expect(unchanged.sourceColumns['集团名称']).toBe('甲公司')
  })

  it('updates tickets by ticketId and post-use ratings by originalTicketId only', () => {
    const records = [
      ticket(),
      ticket({
        id: 'consult',
        dataSourceType: 'consultation_ticket',
        sourceColumns: {},
      }),
      {
        id: 'rating-hit',
        dataSourceType: 'post_use_rating',
        ticketId: 'FU-9',
        originalTicketId: 'T-100',
        customerName: '脱敏',
        customerCode: '',
        sourceColumns: {},
      },
      {
        id: 'rating-miss',
        dataSourceType: 'post_use_rating',
        ticketId: 'T-100',
        originalTicketId: '',
        customerName: '不应改',
        sourceColumns: {},
      },
    ]
    const applied = applyCustomerRestoreToRecords(records, [{
      ticketId: 'T-100',
      fields: { 集团名称: '甲公司', 集团客户编码: 'C001' },
    }])
    expect(applied.skippedUnknownTicketIds).toEqual([])
    expect(applied.updatedRecordCount).toBe(3)
    expect(applied.updatedById.get('c1').customerCode).toBe('C001')
    expect(applied.updatedById.get('consult').customerName).toBe('甲公司')
    expect(applied.updatedById.get('rating-hit').customerName).toBe('甲公司')
    expect(applied.updatedById.has('rating-miss')).toBe(false)
  })

  it('skips unknown ticket ids and does not create records', () => {
    const applied = applyCustomerRestoreToRecords([ticket()], [{
      ticketId: 'MISSING',
      fields: { 集团名称: '甲公司' },
    }])
    expect(applied.updatedRecordCount).toBe(0)
    expect(applied.skippedUnknownTicketIds).toEqual(['MISSING'])
  })
})
