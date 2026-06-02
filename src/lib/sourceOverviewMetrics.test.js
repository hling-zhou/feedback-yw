import { describe, expect, it } from 'vitest'
import { randomId } from './randomId.js'
import {
  computeMaxMomGrowthProduct,
  computeMaxMomGrowthProductForSource,
} from './sourceOverviewMetrics.js'
import { createInsightPeriod } from '../domain/insightPeriod.js'

function makeRecord(overrides = {}) {
  return {
    id: randomId(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    dataSourceType: 'complaint_ticket',
    product: '云主机',
    importMonth: '2025-06',
    createdAt: '2025-06-15T10:00:00Z',
    ...overrides,
  }
}

describe('sourceOverviewMetrics', () => {
  it('returns product with highest positive mom growth when previous baseline exists', () => {
    const current = [
      makeRecord({ product: '云主机' }),
      makeRecord({ product: '云主机' }),
      makeRecord({ product: '云主机' }),
      makeRecord({ product: '弹性公网 IP' }),
    ]
    const previous = [
      makeRecord({ product: '云主机', importMonth: '2025-05', createdAt: '2025-05-10T10:00:00Z' }),
      makeRecord({ product: '弹性公网 IP', importMonth: '2025-05', createdAt: '2025-05-10T10:00:00Z' }),
      makeRecord({ product: '弹性公网 IP', importMonth: '2025-05', createdAt: '2025-05-11T10:00:00Z' }),
    ]
    expect(computeMaxMomGrowthProduct(current, previous)).toBe('云主机')
  })

  it('returns null when previous period has no records', () => {
    expect(
      computeMaxMomGrowthProduct([makeRecord()], []),
    ).toBeNull()
  })

  it('returns null when no product increased vs previous period', () => {
    const current = [makeRecord({ product: '云主机' })]
    const previous = [
      makeRecord({ product: '云主机', importMonth: '2025-05', createdAt: '2025-05-10T10:00:00Z' }),
      makeRecord({ product: '云主机', importMonth: '2025-05', createdAt: '2025-05-11T10:00:00Z' }),
    ]
    expect(computeMaxMomGrowthProduct(current, previous)).toBeNull()
  })

  it('returns null for source when previous insight period is unavailable', () => {
    const period = createInsightPeriod({
      label: '2025-06',
      granularity: 'month',
      anchorYear: 2025,
      anchorMonth: 6,
    })
    expect(
      computeMaxMomGrowthProductForSource([makeRecord()], period, null, 'complaint_ticket'),
    ).toBeNull()
  })
})
