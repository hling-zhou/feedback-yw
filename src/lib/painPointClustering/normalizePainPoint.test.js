import { describe, expect, it } from 'vitest'
import { normalizePainPointKey } from './normalizePainPoint.js'

describe('normalizePainPointKey', () => {
  it('strips whitespace and punctuation for exact pre-merge', () => {
    const a = normalizePainPointKey('安全组规则未放行，导致公网端口无法访问。')
    const b = normalizePainPointKey('安全组规则未放行导致公网端口无法访问')
    expect(a).toBe(b)
  })

  it('case-folds latin letters', () => {
    expect(normalizePainPointKey('IPv6 Down')).toBe(normalizePainPointKey('ipv6 down'))
  })

  it('empty input → empty key', () => {
    expect(normalizePainPointKey('')).toBe('')
    expect(normalizePainPointKey('   ')).toBe('')
  })
})
