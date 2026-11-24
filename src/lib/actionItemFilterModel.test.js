import { describe, expect, it } from 'vitest'
import {
  actionItemFiltersToListQuery,
  buildActionItemProductFilterOptions,
  countActiveActionItemFilters,
  createEmptyActionItemFilters,
  formatActionItemFilterChipLabel,
  listActiveActionItemFilterChipKeys,
} from './actionItemFilterModel.js'
import {
  buildActionItemFilterPatchFromDraft,
  isActionItemFilterDraftValid,
} from './actionItemFilterEditors.js'

describe('actionItemFilterModel', () => {
  it('lists active chip keys and formats labels', () => {
    const values = {
      ...createEmptyActionItemFilters(),
      productKeys: ['vpc', 'eip'],
      statuses: ['pending_evaluation'],
      ticketId: 'T-001',
      problemType: '故障',
      journeyL1: '使用',
    }
    // 「数据来源」筛选项已删（11-24 拍板：档位入口单源=Segmented tab，列表筛选不再重复档维度）
    expect(listActiveActionItemFilterChipKeys(values)).toEqual([
      'ticketId',
      'productKeys',
      'statuses',
      'problemType',
      'journeyL1',
    ])
    expect(countActiveActionItemFilters(values)).toBe(5)
    expect(
      formatActionItemFilterChipLabel('productKeys', values, {
        productNameByKey: new Map([
          ['vpc', 'VPC'],
          ['eip', 'EIP'],
        ]),
      }),
    ).toBe('2 个')
    expect(formatActionItemFilterChipLabel('statuses', values)).toBe('待评估')
    expect(formatActionItemFilterChipLabel('ticketId', values)).toBe('T-001')
    expect(formatActionItemFilterChipLabel('problemType', values)).toBe('故障')
    expect(formatActionItemFilterChipLabel('journeyL1', values)).toBe('使用')
    expect(actionItemFiltersToListQuery(values)).toEqual({
      productKeys: 'vpc,eip',
      statuses: 'pending_evaluation',
      ticketId: 'T-001',
      problemType: '故障',
      journeyL1: '使用',
    })
  })
})

describe('buildActionItemProductFilterOptions', () => {
  it('keeps unique productKey values and prefers catalog names', () => {
    const options = buildActionItemProductFilterOptions(
      [
        { productKey: 'eip', productName: '弹性公网 IP' },
        { productKey: 'eip', productName: '弹性公网IP' },
        { productKey: 'custom_live', productName: '云直播' },
        { productKey: '', productName: '忽略空 key' },
      ],
      new Map([
        ['eip', '弹性公网IP'],
        ['vpc', '虚拟私有云'],
      ]),
    )
    expect(options).toHaveLength(3)
    expect(options.find((item) => item.value === 'eip')).toEqual({
      value: 'eip',
      label: '弹性公网IP',
    })
    expect(options.find((item) => item.value === 'custom_live')).toEqual({
      value: 'custom_live',
      label: '云直播',
    })
    expect(options.find((item) => item.value === 'vpc')).toEqual({
      value: 'vpc',
      label: '虚拟私有云',
    })
    const values = options.map((item) => item.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('excludes out-of-analysis-scope catalog products when catalog provided (11-24: 云主机/云硬盘等不该出现在复合搜索)', () => {
    // 分析范围口径 = enabled || analysisPostUseRating（与专题分析 analysisScope 同判据）
    /** @type {import('./productCatalogLoader.js').CatalogProduct[]} */
    const catalog = [
      { key: 'eip', name: '弹性公网IP', enabled: true, analysisPostUseRating: true, taxonomyKey: 'eip', specs: [] },
      { key: 'cvm', name: '云主机', enabled: false, analysisPostUseRating: false, taxonomyKey: 'cvm', specs: [] },
      { key: 'shared_bw', name: '共享带宽', enabled: false, analysisPostUseRating: true, taxonomyKey: 'shared_bw', specs: [] },
    ]
    const options = buildActionItemProductFilterOptions(
      [
        { productKey: 'eip', productName: '弹性公网IP' },
        { productKey: 'cvm', productName: '云主机' },
        { productKey: 'shared_bw', productName: '共享带宽' },
        { productKey: 'custom_legacy', productName: '库内历史遗留' },
      ],
      new Map(),
      catalog,
    )
    const values = options.map((item) => item.value)
    expect(values).toContain('eip')
    expect(values).toContain('shared_bw')
    expect(values).not.toContain('cvm')
    // 目录给出的范围外 key 一并排除（库内存量历史数据）
    expect(values).not.toContain('custom_legacy')
  })

  it('falls back to legacy behavior (no filtering) when catalog not provided', () => {
    const options = buildActionItemProductFilterOptions(
      [
        { productKey: 'elb', productName: '负载均衡' },
      ],
      new Map(),
    )
    expect(options.map((item) => item.value)).toEqual(['elb'])
  })
})

describe('actionItemFilterEditors', () => {
  it('validates and builds statuses draft（数据来源筛选项已删，11-24）', () => {
    expect(isActionItemFilterDraftValid('statuses', ['pending_evaluation'])).toBe(true)
    expect(isActionItemFilterDraftValid('statuses', [])).toBe(false)
    expect(
      buildActionItemFilterPatchFromDraft('statuses', [
        'pending_evaluation',
        'invalid_status',
        'in_progress',
      ]),
    ).toEqual({
      statuses: ['pending_evaluation', 'in_progress'],
    })
  })
})
