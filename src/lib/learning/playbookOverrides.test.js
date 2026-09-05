import { describe, expect, it } from 'vitest'
import { mergePlaybookCandidateIntoOverlay, mergePlaybookConfigs } from './playbookOverrides.js'
import { listPlaybookPromotionCandidates, playbookCandidateKey } from './playbookPromotion.js'

describe('playbookOverrides', () => {
  it('merges a candidate under product key and name', () => {
    const overlay = mergePlaybookCandidateIntoOverlay(null, {
      product: '弹性公网IP',
      productKey: 'eip',
      journeyL2: '配额申请',
      problemType: '配额与权限申请',
      text: '在购买页展示当前配额余量并提供一键提额入口',
    })
    expect(overlay.products.eip.journeys['配额申请'][0]).toMatch(/一键提额/)
    expect(overlay.products['弹性公网IP'].problemTypes['配额与权限申请'][0]).toMatch(/一键提额/)
  })

  it('mergePlaybookConfigs keeps unique lines', () => {
    const merged = mergePlaybookConfigs(
      { version: 1, journeys: { a: ['旧'] }, problemTypes: {}, products: {} },
      { version: 2, journeys: { a: ['旧', '新'] }, problemTypes: {}, products: {} },
    )
    expect(merged.journeys.a).toEqual(['旧', '新'])
    expect(merged.version).toBe(2)
  })
})

describe('playbookPromotion', () => {
  it('filters rejected candidates', () => {
    const records = [1, 2, 3].flatMap((month) =>
      [1, 2, 3].map((n) => ({
        id: `${month}-${n}`,
        product: '弹性公网IP',
        productKey: 'eip',
        journeyL2: '配额申请',
        problemType: '配额与权限申请',
        establishedAction: '在购买页展示当前配额余量并提供一键提额入口',
        createdAt: `2026-0${month}-0${n}`,
      })),
    )
    const all = listPlaybookPromotionCandidates(records)
    expect(all.length).toBeGreaterThan(0)
    const key = playbookCandidateKey(all[0])
    const filtered = listPlaybookPromotionCandidates(records, { rejectedKeys: [key] })
    expect(filtered.find((r) => playbookCandidateKey(r) === key)).toBeUndefined()
  })
})
