import { describe, it, expect } from 'vitest'
import {
  normalizeTicketId,
  extractMobileTicketId,
  isLegacyDemoTicketId,
  normalizeCreatedAt,
} from './desensitize.js'

describe('normalizeTicketId', () => {
  it('fixes scientific notation', () => {
    expect(normalizeTicketId('2.024080612345678e+15')).toMatch(/^\d+$/)
  })

  it('strips trailing .0', () => {
    expect(normalizeTicketId('202408061234.0')).toBe('202408061234')
  })

  it('preserves mobile cloud ticket id', () => {
    expect(normalizeTicketId('20220802092823X703918924')).toBe('20220802092823X703918924')
  })
})

describe('extractMobileTicketId', () => {
  it('extracts from handling text', () => {
    const text = '工单流水号：20220802092823X703918924|处理意见：已排查'
    expect(extractMobileTicketId(text)).toBe('20220802092823X703918924')
  })
})

describe('isLegacyDemoTicketId', () => {
  it('detects TK demo ids', () => {
    expect(isLegacyDemoTicketId('TK-2024-001')).toBe(true)
    expect(isLegacyDemoTicketId('20220802092823X703918924')).toBe(false)
  })
})

describe('normalizeCreatedAt', () => {
  it('normalizes slash date to yyyy-mm-dd', () => {
    expect(normalizeCreatedAt('2026/08/04')).toBe('2026-08-04')
  })

  it('keeps scientific notation string as-is for upstream handling', () => {
    expect(normalizeCreatedAt('4.5401E+12')).toBe('4.5401E+12')
  })
})
