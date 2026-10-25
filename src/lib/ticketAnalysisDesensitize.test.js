import { describe, it, expect } from 'vitest'
import {
  desensitizeColumnValue,
  desensitizeText,
  createAllDesensitizeOptions,
  createNoDesensitizeOptions,
  getEnabledDesensitizeLabels,
  DESENSITIZE_FIELDS,
} from './ticketAnalysisDesensitize.js'

describe('desensitizeColumnValue', () => {
  it('replaces column value with *** when enabled', () => {
    const opts = createAllDesensitizeOptions()
    expect(desensitizeColumnValue('user123', 'loginAccountName', opts)).toBe('***')
    expect(desensitizeColumnValue('GRP001', 'groupCustomerCode', opts)).toBe('***')
    expect(desensitizeColumnValue('中国铁塔', 'groupName', opts)).toBe('***')
  })

  it('preserves original value when disabled', () => {
    const opts = createNoDesensitizeOptions()
    expect(desensitizeColumnValue('user123', 'loginAccountName', opts)).toBe('user123')
    expect(desensitizeColumnValue('GRP001', 'groupCustomerCode', opts)).toBe('GRP001')
  })

  it('handles null/undefined value', () => {
    const opts = createAllDesensitizeOptions()
    // 空值脱敏后保持空字符串，避免 *** 造成"有值"的错觉
    expect(desensitizeColumnValue(null, 'loginAccountName', opts)).toBe('')
    expect(desensitizeColumnValue(undefined, 'loginAccountName', opts)).toBe('')
    expect(desensitizeColumnValue('', 'loginAccountName', opts)).toBe('')
    expect(desensitizeColumnValue('  ', 'loginAccountName', opts)).toBe('')
    expect(desensitizeColumnValue(null, 'loginAccountName', createNoDesensitizeOptions())).toBe('')
  })
})

describe('desensitizeText', () => {
  it('replaces IP addresses with masked format', () => {
    const text = '客户反馈 36.133.24.44 无法访问'
    const result = desensitizeText(text, { ipAddress: true })
    expect(result).toContain('***.***.***.***')
    expect(result).not.toContain('36.133.24.44')
  })

  it('replaces multiple IP addresses', () => {
    const text = '从 192.168.1.1 到 10.0.0.1 的链路不通'
    const result = desensitizeText(text, { ipAddress: true })
    expect(result).toBe('从 ***.***.***.*** 到 ***.***.***.*** 的链路不通')
  })

  it('replaces password info in text', () => {
    const text = '需提供云主机的帐号密码：abc123，验证后开通'
    const result = desensitizeText(text, { password: true })
    expect(result).toContain('密码:****')
    expect(result).not.toContain('abc123')
  })

  it('replaces password with colon separator', () => {
    const text = '密码: mypass123 请尽快处理'
    const result = desensitizeText(text, { password: true })
    expect(result).toContain('密码:****')
    expect(result).not.toContain('mypass123')
  })

  it('does not desensitize when options are false', () => {
    const text = 'IP 36.133.24.44 密码：secret'
    const result = desensitizeText(text, { ipAddress: false, password: false })
    expect(result).toBe(text)
  })

  it('handles empty text', () => {
    expect(desensitizeText('', { ipAddress: true, password: true })).toBe('')
    expect(desensitizeText(null, { ipAddress: true, password: true })).toBe('')
  })

  it('desensitizes both IP and password simultaneously', () => {
    const text = '账号密码: pass123 来自 IP 10.0.0.1'
    const result = desensitizeText(text, { ipAddress: true, password: true })
    expect(result).toContain('密码:****')
    expect(result).toContain('***.***.***.***')
    expect(result).not.toContain('pass123')
    expect(result).not.toContain('10.0.0.1')
  })
})

describe('createAllDesensitizeOptions / createNoDesensitizeOptions', () => {
  it('all options enabled', () => {
    const opts = createAllDesensitizeOptions()
    expect(opts.loginAccountName).toBe(true)
    expect(opts.groupCustomerCode).toBe(true)
    expect(opts.groupName).toBe(true)
    expect(opts.password).toBe(true)
    expect(opts.ipAddress).toBe(true)
  })

  it('no options enabled', () => {
    const opts = createNoDesensitizeOptions()
    expect(opts.loginAccountName).toBe(false)
    expect(opts.groupCustomerCode).toBe(false)
    expect(opts.groupName).toBe(false)
    expect(opts.password).toBe(false)
    expect(opts.ipAddress).toBe(false)
  })
})

describe('getEnabledDesensitizeLabels', () => {
  it('returns labels for all enabled fields', () => {
    const opts = createAllDesensitizeOptions()
    const labels = getEnabledDesensitizeLabels(opts)
    expect(labels).toHaveLength(5)
    expect(labels).toContain('登录账号名称')
    expect(labels).toContain('客户编码')
    expect(labels).toContain('客户名称')
    expect(labels).toContain('密码（正文中出现的密码信息）')
    expect(labels).toContain('IP地址（正文中出现的IP地址）')
  })

  it('returns empty array when no fields enabled', () => {
    const labels = getEnabledDesensitizeLabels(createNoDesensitizeOptions())
    expect(labels).toEqual([])
  })

  it('returns only selected labels', () => {
    const labels = getEnabledDesensitizeLabels({ loginAccountName: true, ipAddress: true })
    expect(labels).toEqual(['登录账号名称', 'IP地址（正文中出现的IP地址）'])
  })
})

describe('DESENSITIZE_FIELDS', () => {
  it('has 5 fields with correct structure', () => {
    expect(DESENSITIZE_FIELDS).toHaveLength(5)
    expect(DESENSITIZE_FIELDS.every((f) => f.key && f.label && f.type)).toBe(true)
  })

  it('has 3 column-type and 2 text-type fields', () => {
    const columnFields = DESENSITIZE_FIELDS.filter((f) => f.type === 'column')
    const textFields = DESENSITIZE_FIELDS.filter((f) => f.type === 'text')
    expect(columnFields).toHaveLength(3)
    expect(textFields).toHaveLength(2)
  })
})
