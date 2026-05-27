import { describe, it, expect } from 'vitest'
import {
  mergeCatalogByKey,
  normalizeCatalogProducts,
  validateCatalogProducts,
  formatMergeCatalogResultMessage,
} from './productCatalogManageModel.js'

describe('productCatalogManageModel', () => {
  it('normalizeCatalogProducts filters invalid rows', () => {
    const list = normalizeCatalogProducts([
      { key: 'eip', name: '弹性公网IP', enabled: true, specs: [{ name: 'A' }] },
      { name: 'no-key' },
    ])
    expect(list).toHaveLength(1)
    expect(list[0].key).toBe('eip')
  })

  it('validateCatalogProducts rejects duplicate keys', () => {
    expect(() =>
      validateCatalogProducts([
        { key: 'a', name: 'A', enabled: true, specs: [] },
        { key: 'a', name: 'B', enabled: false, specs: [] },
      ]),
    ).toThrow(/重复/)
  })

  it('mergeCatalogByKey adds new product and spec', () => {
    const current = [
      {
        key: 'eip',
        name: '弹性公网IP',
        enabled: true,
        taxonomyKey: 'eip',
        specs: [{ name: 'Spec1' }],
      },
    ]
    const incoming = [
      {
        key: 'ecs',
        name: '云主机',
        enabled: false,
        taxonomyKey: 'ecs',
        specs: [{ name: 'S1' }],
      },
      {
        key: 'eip',
        name: '弹性公网IP',
        enabled: true,
        taxonomyKey: 'eip',
        specs: [{ name: 'Spec2', match: ['alias'] }],
      },
    ]
    const { products, added } = mergeCatalogByKey(current, incoming)
    expect(products).toHaveLength(2)
    expect(products.find((p) => p.key === 'ecs')?.taxonomyKey).toBe('ecs')
    expect(products.find((p) => p.key === 'eip')?.specs).toHaveLength(2)
    expect(added.products).toBe(1)
    expect(added.specs).toBe(2)
  })

  it('mergeCatalogByKey updates existing product and overwrites spec match', () => {
    const current = [
      {
        key: 'eip',
        name: '旧名称',
        enabled: false,
        taxonomyKey: 'eip',
        acceptParentName: true,
        specs: [{ name: 'Spec1', match: ['old-a', 'old-b'] }],
      },
    ]
    const incoming = [
      {
        key: 'eip',
        name: '弹性公网IP',
        enabled: true,
        taxonomyKey: 'eip',
        acceptParentName: false,
        specs: [{ name: 'Spec1', match: ['new-only'] }],
      },
    ]
    const { products, updated } = mergeCatalogByKey(current, incoming)
    const eip = products.find((p) => p.key === 'eip')
    expect(eip?.name).toBe('弹性公网IP')
    expect(eip?.enabled).toBe(true)
    expect(eip?.acceptParentName).toBe(false)
    expect(eip?.specs[0].match).toEqual(['new-only'])
    expect(updated.products).toBe(1)
    expect(updated.specs).toBe(1)
  })

  it('formatMergeCatalogResultMessage summarizes counts', () => {
    const text = formatMergeCatalogResultMessage({
      added: { products: 1, specs: 2 },
      updated: { products: 0, specs: 3 },
    })
    expect(text).toContain('新增 产品 1')
    expect(text).toContain('规格 3')
  })
})
