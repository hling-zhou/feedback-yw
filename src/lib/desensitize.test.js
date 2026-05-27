import { describe, it, expect } from 'vitest'
import {
  maskIpAddresses,
  desensitizeImportRow,
  normalizeTicketId,
  extractMobileTicketId,
  isLegacyDemoTicketId,
} from './desensitize.js'

describe('maskIpAddresses', () => {
  it('masks IPv4', () => {
    expect(maskIpAddresses('客户反馈 192.168.1.100 无法访问')).toBe(
      '客户反馈 [IP已脱敏] 无法访问',
    )
  })

  it('masks IPv4 after Chinese colon', () => {
    expect(maskIpAddresses('资源IP：10.12.3.4')).toBe('资源IP：[IP已脱敏]')
  })

  it('masks IPv4 with port', () => {
    expect(maskIpAddresses('白名单 10.0.0.5:8085')).toBe('白名单 [IP已脱敏]')
  })

  it('leaves non-IP text unchanged', () => {
    expect(maskIpAddresses('无 IP 的工单')).toBe('无 IP 的工单')
    expect(maskIpAddresses('弹性公网IP无法访问')).toBe('弹性公网IP无法访问')
  })
})

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

describe('desensitizeImportRow', () => {
  it('skips when disabled', () => {
    const row = { handlingText: '192.168.0.1' }
    expect(desensitizeImportRow(row, false).handlingText).toBe('192.168.0.1')
  })
})
