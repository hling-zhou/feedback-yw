import { describe, expect, it } from 'vitest'
import { countCustomerTiers, normalizeCustomerTier } from './customerTier.js'

describe('normalizeCustomerTier', () => {
  it('accepts canonical tier labels', () => {
    expect(normalizeCustomerTier('金牌')).toBe('金牌')
    expect(normalizeCustomerTier('银牌')).toBe('银牌')
    expect(normalizeCustomerTier('铜牌')).toBe('铜牌')
    expect(normalizeCustomerTier('普通')).toBe('普通')
  })

  it('maps common aliases', () => {
    expect(normalizeCustomerTier('金')).toBe('金牌')
    expect(normalizeCustomerTier('Gold')).toBe('金牌')
    expect(normalizeCustomerTier('银')).toBe('银牌')
    expect(normalizeCustomerTier('bronze')).toBe('铜牌')
    expect(normalizeCustomerTier('标准')).toBe('普通')
  })

  it('returns undefined for empty or unknown values', () => {
    expect(normalizeCustomerTier('')).toBeUndefined()
    expect(normalizeCustomerTier('  ')).toBeUndefined()
    expect(normalizeCustomerTier('钻石')).toBeUndefined()
  })
})

describe('countCustomerTiers', () => {
  it('counts normalized tiers in records', () => {
    const counts = countCustomerTiers([
      { customerTier: '金牌' },
      { customerTier: '金牌' },
      { customerTier: '银' },
      { customerTier: undefined },
    ])
    expect(counts).toEqual({ 金牌: 2, 银牌: 1, 铜牌: 0, 普通: 0 })
  })
})
