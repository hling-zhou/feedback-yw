import { describe, expect, it } from 'vitest'
import {
  SPEC_MERGE_RULES,
  SHARED_BANDWIDTH_SPEC_NAME,
  applySpecMergeRules,
} from './specMergeRules.js'

/** @param {Partial<import('../productCatalogLoader.js').CatalogProduct>} p */
function product(p) {
  return {
    key: p.key,
    name: p.name || p.key,
    enabled: true,
    analysisPostUseRating: true,
    focusTracked: false,
    taxonomyKey: p.key,
    acceptParentName: true,
    specs: p.specs || [],
  }
}

describe('spec merge rules', () => {
  it('moves child specs into the parent and drops the standalone child', () => {
    const { products, changed } = applySpecMergeRules([
      product({ key: 'vpn', name: '融合VPN' }),
      product({ key: 'ssl_vpn', name: 'SSL VPN' }),
      product({ key: 'ipsec_vpn', name: 'IPSec VPN' }),
      product({ key: 'eip', name: '弹性公网IP' }),
    ])
    expect(changed).toBe(true)
    expect(products.map((p) => p.key).sort()).toEqual(['eip', 'vpn'])
    const vpn = products.find((p) => p.key === 'vpn')
    expect(vpn?.specs?.map((s) => s.name)).toEqual(['SSL VPN', 'IPSec VPN'])
    expect(vpn?.specs?.[0].match).toContain('SSLVPN')
  })

  it('matches children by product name when the online key differs', () => {
    const { products, changed } = applySpecMergeRules([
      product({ key: 'vpc', name: '虚拟私有云', specs: [{ name: '虚拟私有云', match: ['VPC'] }] }),
      product({ key: 'product_1789583185037', name: '对等连接' }),
      product({ key: 'peer_conn', name: '安全组' }),
    ])
    expect(changed).toBe(true)
    expect(products.map((p) => p.key)).toEqual(['vpc'])
    const vpc = products.find((p) => p.key === 'vpc')
    expect(vpc?.specs?.map((s) => s.name)).toEqual(['虚拟私有云', '对等连接', '安全组'])
  })

  it('applies the whole rule as an atomic unit when only one child is present', () => {
    // 规则是原子的：只要命中任一子产品，就把该规则声明的全部规格补齐，
    // 避免目录里出现「父产品已建、规格只剩一半」的不一致状态。
    const { products } = applySpecMergeRules([
      product({ key: 'vpc', name: '虚拟私有云' }),
      product({ key: 'peering', name: '对等连接' }),
    ])
    expect(products.map((p) => p.key)).toEqual(['vpc'])
    expect(products[0].specs?.map((s) => s.name)).toEqual(['对等连接', '安全组'])
  })

  it('keeps the shared_bw standalone product (key match only, never by name)', () => {
    const { products, changed } = applySpecMergeRules([
      product({ key: 'eip', name: '弹性公网IP' }),
      product({ key: 'shared_bw', name: '共享带宽' }),
    ])
    expect(changed).toBe(false)
    expect(products.map((p) => p.key).sort()).toEqual(['eip', 'shared_bw'])
    expect(products.find((p) => p.key === 'eip')?.specs).toEqual([])
  })

  it('still merges the legacy 共享带宽 product key into eip', () => {
    const { products, changed } = applySpecMergeRules([
      product({ key: 'eip', name: '弹性公网IP' }),
      product({ key: '共享带宽', name: '共享带宽' }),
    ])
    expect(changed).toBe(true)
    expect(products.map((p) => p.key)).toEqual(['eip'])
    expect(products[0].specs?.map((s) => s.name)).toEqual([SHARED_BANDWIDTH_SPEC_NAME])
  })

  it('skips a rule entirely when the parent product is absent', () => {
    const { products, changed } = applySpecMergeRules([product({ key: 'ssl_vpn', name: 'SSL VPN' })])
    expect(changed).toBe(false)
    expect(products.map((p) => p.key)).toEqual(['ssl_vpn'])
  })

  it('is idempotent and does not duplicate specs', () => {
    const input = [product({ key: 'cc', name: '云组网' }), product({ key: 'cloud_interconnect', name: '云互联' })]
    const first = applySpecMergeRules(input)
    const second = applySpecMergeRules(first.products)
    expect(second.changed).toBe(false)
    expect(second.products).toEqual(first.products)
  })

  it('does not mutate the input catalog', () => {
    const input = [product({ key: 'cc', name: '云组网' }), product({ key: 'cloud_interconnect', name: '云互联' })]
    const snapshot = JSON.stringify(input)
    applySpecMergeRules(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('declares a unique id per rule', () => {
    const ids = SPEC_MERGE_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rule of SPEC_MERGE_RULES) {
      expect(rule.parentKey, rule.id).toBeTruthy()
      expect(rule.childKeys.length + rule.childNames.length, rule.id).toBeGreaterThan(0)
    }
  })
})
