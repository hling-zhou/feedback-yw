import { describe, expect, it } from 'vitest'
import { buildProductStatusChartData } from './ActionItemProductStatusChart.jsx'

describe('ActionItemProductStatusChart', () => {
  it('builds stacked counts and rate for dual-axis chart', () => {
    const data = buildProductStatusChartData(
      [
        {
          productName: 'VPC',
          counts: { open: 2, converted_to_action: 1, processed_without_action: 1 },
          rate: 25,
        },
      ],
      ['open', 'converted_to_action', 'processed_without_action'],
    )
    expect(data[0]).toMatchObject({
      productName: 'VPC',
      open: 2,
      converted_to_action: 1,
      processed_without_action: 1,
      rate: 25,
      total: 4,
    })
  })
})
