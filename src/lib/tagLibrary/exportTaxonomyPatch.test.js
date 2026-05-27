import { describe, it, expect } from 'vitest'
import {
  toAdoptId,
  overridesToExcelRows,
  overridesToJsonPatch,
  buildTaxonomyPatchPackage,
  buildSingleCandidatePatchPackage,
} from './exportTaxonomyPatch.js'

describe('exportTaxonomyPatch', () => {
  it('toAdoptId is stable and ascii-safe', () => {
    const id = toAdoptId('绑定与网络配置', 'l2')
    expect(id).toMatch(/^l2-adopt-[a-z0-9-]+$/)
    expect(toAdoptId('绑定与网络配置', 'l2')).toBe(id)
  })

  it('overridesToExcelRows maps journey patches', () => {
    const rows = overridesToExcelRows({
      tagLibraryVersion: 'v1',
      journeyPatches: [
        {
          taxonomyKey: 'eip',
          journeyL1: '日常运维',
          journeyL2: '新子环节',
          keywords: ['绑定'],
        },
      ],
      problemTypes: [{ label: '新类型', keywords: ['k1'] }],
      updatedAt: '2026-01-01',
    })
    expect(rows.journeyRows).toHaveLength(1)
    expect(rows.journeyRows[0]['产品Key']).toBe('eip')
    expect(rows.journeyRows[0]['一级名称']).toBe('日常运维')
    expect(rows.problemTypeRows[0]['问题类型名称']).toBe('新类型')
  })

  it('overridesToJsonPatch groups by product', () => {
    const patch = overridesToJsonPatch({
      tagLibraryVersion: 'v1',
      journeyPatches: [
        { taxonomyKey: 'eip', journeyL1: 'A', journeyL2: 'B' },
      ],
      problemTypes: [],
      updatedAt: '2026-01-01',
    })
    expect(patch.products.eip.journeysAppend).toHaveLength(1)
    expect(patch.products.eip.journeysAppend[0].l2.label).toBe('B')
  })

  it('buildSingleCandidatePatchPackage from journey candidate', () => {
    const pkg = buildSingleCandidatePatchPackage({
      id: 'c1',
      tagType: 'journey_l2',
      proposedLabel: '一级 > 二级',
      journeyL1: '一级',
      journeyL2: '二级',
      taxonomyKey: 'generic',
      origin: 'llm',
      status: 'approved',
      createdAt: '2026-01-01',
    })
    expect(pkg.excel.journeyRows).toHaveLength(1)
    expect(pkg.mergeGuide.excel).toContain('用户旅程')
  })
})
