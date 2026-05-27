import { describe, it, expect } from 'vitest'
import {
  isTicketSource,
  validateImportFile,
  validateRowCount,
  defaultBatchName,
  preferredSheetName,
  normalizeImportMonth,
  pickImportRowMeta,
} from './importUtils.js'

describe('importUtils', () => {
  it('isTicketSource', () => {
    expect(isTicketSource('complaint_ticket')).toBe(true)
    expect(isTicketSource('user_survey')).toBe(false)
  })

  it('validateImportFile rejects unknown ext', () => {
    const file = new File(['x'], 'data.txt', { type: 'text/plain' })
    expect(validateImportFile(file).ok).toBe(false)
  })

  it('validateImportFile accepts csv', () => {
    const file = new File(['a,b'], 't.csv', { type: 'text/csv' })
    expect(validateImportFile(file).ok).toBe(true)
  })

  it('validateRowCount enforces max', () => {
    expect(validateRowCount(5001).ok).toBe(false)
    expect(validateRowCount(100).ok).toBe(true)
  })

  it('defaultBatchName includes source label', () => {
    expect(defaultBatchName('consultation_ticket', '2025-05')).toContain('咨询')
  })

  it('normalizeImportMonth validates YYYY-MM', () => {
    expect(normalizeImportMonth('2025-05')).toBe('2025-05')
    expect(normalizeImportMonth('2025-5')).toBe(null)
    expect(normalizeImportMonth('')).toBe(null)
  })

  it('pickImportRowMeta passes import month from row', () => {
    const meta = pickImportRowMeta({
      importMonth: '2025-03',
      importBatchId: 'b1',
      importedAt: '2025-03-10T00:00:00.000Z',
    })
    expect(meta.importMonth).toBe('2025-03')
    expect(meta.importBatchId).toBe('b1')
  })

  it('preferredSheetName picks 投诉 sheet', () => {
    expect(
      preferredSheetName('complaint_ticket', ['汇总', '投诉明细', '其他']),
    ).toBe('投诉明细')
  })
})
