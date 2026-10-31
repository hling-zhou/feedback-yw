import { describe, expect, it } from 'vitest'
import {
  resolveObservationScanTargets,
  isSubstantiveNegativeRating,
} from './scanTargets.js'

const catalogProducts = [
  { key: 'eip', name: '弹性公网IP', enabled: true, analysisPostUseRating: true, taxonomyKey: 'eip', acceptParentName: true, specs: [] },
  { key: 'vpc', name: '虚拟私有云', enabled: true, analysisPostUseRating: true, taxonomyKey: 'vpc', acceptParentName: true, specs: [] },
]

describe('isSubstantiveNegativeRating', () => {
  it('substantive reason text counts regardless of score', () => {
    expect(isSubstantiveNegativeRating({ lowScoreReason: '页面打开慢', ratingScore: 5 })).toBe(true)
    expect(isSubstantiveNegativeRating({ lowScoreReason: '想退退不了', ratingScore: 9 })).toBe(true)
  })

  it('placeholders and positive words excluded', () => {
    expect(isSubstantiveNegativeRating({ lowScoreReason: '无' })).toBe(false)
    expect(isSubstantiveNegativeRating({ lowScoreReason: '满意' })).toBe(false)
    expect(isSubstantiveNegativeRating({ lowScoreReason: '业务使用完毕' })).toBe(false)
    expect(isSubstantiveNegativeRating({ lowScoreReason: '退订' })).toBe(false)
  })

  it('negated positive counts as negative', () => {
    expect(isSubstantiveNegativeRating({ lowScoreReason: '不太满意' })).toBe(true)
  })

  it('multi-piece reason: any substantive piece counts', () => {
    expect(isSubstantiveNegativeRating({ lowScoreReason: '满意;加载很慢' })).toBe(true)
    expect(isSubstantiveNegativeRating({ lowScoreReason: '满意;业务使用完毕' })).toBe(false)
  })

  it('empty reason excluded even with low score', () => {
    expect(isSubstantiveNegativeRating({ lowScoreReason: '', ratingScore: 1 })).toBe(false)
    expect(isSubstantiveNegativeRating({ ratingScore: 1 })).toBe(false)
  })
})

describe('resolveObservationScanTargets', () => {
  it('tickets pass in full; ratings only substantive + in catalog', () => {
    const targets = resolveObservationScanTargets({
      catalogProducts,
      records: [
        { id: 't1', dataSourceType: 'complaint_ticket', productKey: 'eip', product: '弹性公网IP', ticketId: 'T1' },
        { id: 't2', dataSourceType: 'consultation_ticket', productKey: 'vpc', product: '虚拟私有云', ticketId: 'T2' },
        { id: 'r1', dataSourceType: 'post_use_rating', productName: '弹性公网IP', lowScoreReason: '页面打开慢', ratingScore: 9, originalTicketId: 'T9' },
        { id: 'r2', dataSourceType: 'post_use_rating', productName: '弹性公网IP', lowScoreReason: '无', ratingScore: 1 },
        { id: 'r3', dataSourceType: 'post_use_rating', productName: '目录外产品', lowScoreReason: '页面打开慢' },
      ],
    })
    expect(targets.map((t) => t.recordId)).toEqual(['t1', 't2', 'r1'])
    const rating = targets.find((t) => t.recordId === 'r1')
    expect(rating?.productKey).toBe('eip')
    expect(rating?.originalTicketId).toBe('T9')
  })

  it('non-ticket non-rating records skipped', () => {
    const targets = resolveObservationScanTargets({
      catalogProducts,
      records: [{ id: 'x', dataSourceType: 'other_source', productKey: 'eip' }],
    })
    expect(targets).toHaveLength(0)
  })

  it('records without id skipped', () => {
    const targets = resolveObservationScanTargets({
      catalogProducts,
      records: [{ dataSourceType: 'complaint_ticket', productKey: 'eip' }],
    })
    expect(targets).toHaveLength(0)
  })
})
