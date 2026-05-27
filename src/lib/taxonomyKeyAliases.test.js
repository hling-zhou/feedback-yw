import { describe, expect, it } from 'vitest'
import { canonicalTaxonomyKey, normalizeRecordTaxonomyKeys } from './taxonomyKeyAliases.js'

describe('taxonomyKeyAliases', () => {
  it('maps legacy dc keys', () => {
    expect(canonicalTaxonomyKey('ecc')).toBe('dc')
    expect(canonicalTaxonomyKey('yunzx')).toBe('dc')
    expect(canonicalTaxonomyKey('yunzhuanxian')).toBe('dc')
    expect(canonicalTaxonomyKey('dc')).toBe('dc')
  })

  it('normalizes slb to lowercase key', () => {
    expect(canonicalTaxonomyKey('slb')).toBe('slb')
    expect(canonicalTaxonomyKey('SLB')).toBe('slb')
  })

  it('normalizes record keys in place', () => {
    const record = { productKey: 'ecc', taxonomyKey: 'SLB' }
    expect(normalizeRecordTaxonomyKeys(record)).toBe(true)
    expect(record.productKey).toBe('dc')
    expect(record.taxonomyKey).toBe('slb')
  })
})
