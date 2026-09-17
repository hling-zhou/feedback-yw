import { describe, it, expect } from 'vitest'
import {
  sanitizeProductKey,
  stripInvisibleChars,
  validateProductKey,
} from './keyHygiene.js'

describe('stripInvisibleChars', () => {
  it('strips zero-width non-joiner U+200C', () => {
    expect(stripInvisibleChars('CloudDNS\u200c')).toBe('CloudDNS')
  })
  it('strips zero-width space U+200B and BOM U+FEFF', () => {
    expect(stripInvisibleChars('\u200bvpc\u200b')).toBe('vpc')
    expect(stripInvisibleChars('\ufeffeip')).toBe('eip')
  })
  it('preserves normal text', () => {
    expect(stripInvisibleChars('vpc_endpoint')).toBe('vpc_endpoint')
    expect(stripInvisibleChars('CloudDNS')).toBe('CloudDNS')
  })
  it('handles empty and nullish', () => {
    expect(stripInvisibleChars('')).toBe('')
    expect(stripInvisibleChars(null)).toBe('')
    expect(stripInvisibleChars(undefined)).toBe('')
  })
})

describe('validateProductKey', () => {
  it('accepts normal alphanumeric+underscore keys', () => {
    expect(validateProductKey('vpc_endpoint')).toBe('vpc_endpoint')
    expect(validateProductKey('CloudDNS')).toBe('CloudDNS')
    expect(validateProductKey('  eip  ')).toBe('eip')
  })
  it('throws on zero-width characters (does NOT silently strip)', () => {
    expect(() => validateProductKey('CloudDNS\u200c')).toThrow(
      /零宽|不可见/,
    )
  })
  it('throws on empty', () => {
    expect(() => validateProductKey('')).toThrow('不能为空')
    expect(() => validateProductKey('   ')).toThrow('不能为空')
  })
  it('throws on non-alphanumeric characters', () => {
    expect(() => validateProductKey('vpc-endpoint')).toThrow(
      /只允许字母|数字|下划线/,
    )
    expect(() => validateProductKey('shared.bw')).toThrow()
  })
})

describe('sanitizeProductKey', () => {
  it('strips zero-width chars and returns clean key (migration path)', () => {
    expect(sanitizeProductKey('CloudDNS\u200c')).toBe('CloudDNS')
  })
  it('returns empty string for empty input (no throw)', () => {
    expect(sanitizeProductKey('')).toBe('')
    expect(sanitizeProductKey(null)).toBe('')
    expect(sanitizeProductKey(undefined)).toBe('')
  })
  it('returns the key as-is for normal keys', () => {
    expect(sanitizeProductKey('vpc_endpoint')).toBe('vpc_endpoint')
    expect(sanitizeProductKey('eip')).toBe('eip')
  })
})
