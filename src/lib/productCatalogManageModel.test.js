import { describe, it, expect } from 'vitest'
import {
  mergeCatalogByKey,
  normalizeCatalogProducts,
  validateCatalogProducts,
  formatMergeCatalogResultMessage,
  catalogToTableRows,
  hasAnalysisRelevantCatalogChange,
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

  it('keeps post-use flags in table rows and enforces the focus dependency', () => {
    const normalized = normalizeCatalogProducts([
      {
        key: 'off',
        name: '未开启分析',
        analysisPostUseRating: false,
        focusTracked: true,
        specs: [],
      },
      {
        key: 'on',
        name: '重点产品',
        analysisPostUseRating: true,
        focusTracked: true,
        specs: [],
      },
    ])
    expect(normalized[0].focusTracked).toBe(false)
    expect(catalogToTableRows(normalized)).toMatchObject([
      { analysisPostUseRating: false, focusTracked: false },
      { analysisPostUseRating: true, focusTracked: true },
    ])
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

describe('hasAnalysisRelevantCatalogChange', () => {
  const base = {
    key: 'eip',
    name: '弹性公网IP',
    enabled: true,
    analysisPostUseRating: true,
    focusTracked: false,
    acceptParentName: true,
    taxonomyKey: 'eip',
    specs: [{ name: '移动IP', match: ['移动'] }],
    owners: { productManager: [{ userId: 'u1', username: 'alice' }] },
  }

  it('仅 owners（负责人）变化返回 false', () => {
    const next = [
      {
        ...base,
        owners: { productManager: [{ userId: 'u2', username: 'bob' }] },
      },
    ]
    expect(hasAnalysisRelevantCatalogChange([base], next)).toBe(false)
  })

  it('完全相同的目录返回 false', () => {
    expect(hasAnalysisRelevantCatalogChange([base], [{ ...base }])).toBe(false)
  })

  it.each([
    ['enabled 开关', { enabled: false }],
    ['analysisPostUseRating 开关', { analysisPostUseRating: false }],
    ['focusTracked 开关', { focusTracked: true }],
    ['产品名称', { name: '新名称' }],
    ['acceptParentName', { acceptParentName: false }],
    ['taxonomyKey', { taxonomyKey: 'shared_bw' }],
    ['规格匹配别名', { specs: [{ name: '移动IP', match: ['别的'] }] }],
    ['规格新增', { specs: [{ name: '移动IP' }, { name: '新规格' }] }],
  ])('分析相关字段变化（%s）返回 true', (_label, patch) => {
    expect(hasAnalysisRelevantCatalogChange([base], [{ ...base, ...patch }])).toBe(true)
  })

  it('新增产品返回 true', () => {
    expect(hasAnalysisRelevantCatalogChange([base], [base, { key: 'ecs', name: '云主机' }])).toBe(true)
  })

  it('删除产品返回 true', () => {
    expect(hasAnalysisRelevantCatalogChange([base, { key: 'ecs', name: '云主机' }], [base])).toBe(true)
  })
})
