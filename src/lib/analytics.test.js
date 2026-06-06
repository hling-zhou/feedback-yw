import { describe, expect, it } from 'vitest'
import { buildStackedTrendAreas, monthlyTrendByProduct } from './analytics.js'

describe('monthlyTrendByProduct', () => {
  it('builds stacked rows by import month and product', () => {
    const records = [
      { id: '1', importMonth: '2025-05', product: 'VPC' },
      { id: '2', importMonth: '2025-05', product: 'VPC' },
      { id: '3', importMonth: '2025-05', product: 'EIP' },
      { id: '4', importMonth: '2025-06', product: 'EIP' },
    ]

    const { data, products } = monthlyTrendByProduct(records, { limit: 12 })

    expect(products.map((p) => p.name)).toEqual(['VPC', 'EIP'])
    expect(data).toEqual([
      { date: '2025-05', VPC: 2, EIP: 1, count: 3 },
      { date: '2025-06', VPC: 0, EIP: 1, count: 1 },
    ])
    expect(buildStackedTrendAreas(products)).toHaveLength(2)
  })
})
