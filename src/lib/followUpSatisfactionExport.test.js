import { describe, expect, it } from 'vitest'
import {
  buildScoreDistributionExportRows,
  buildTenPointRateTrendExportRows,
} from './followUpSatisfactionExport.js'
import { computeScoreDistributionByProduct } from './followUpSatisfactionAnalytics.js'

function ticket(overrides = {}) {
  return {
    id: 't1',
    dataSourceType: 'complaint_ticket',
    importMonth: '2026-05',
    product: '云主机',
    followUpSatisfaction: {
      followUpTicketId: 'FH-1',
      followUpSuccessful: true,
      score: 10,
      importMonth: '2026-05',
    },
    ...overrides,
  }
}

describe('followUpSatisfactionExport', () => {
  const records = [
    ticket(),
    ticket({
      id: 't2',
      followUpSatisfaction: {
        followUpTicketId: 'FH-2',
        followUpSuccessful: true,
        score: 8,
        importMonth: '2026-05',
      },
    }),
    ticket({
      id: 't3',
      product: 'VPC',
      followUpSatisfaction: {
        followUpTicketId: 'FH-3',
        followUpSuccessful: true,
        score: 10,
        importMonth: '2026-04',
      },
    }),
  ]

  it('buildTenPointRateTrendExportRows exports long-format monthly rates by product', () => {
    const rows = buildTenPointRateTrendExportRows(records)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          月份: '2026-04',
          产品: 'VPC',
          '10分条数': 1,
          有效回访: 1,
          '10分满意率(%)': 100,
        }),
        expect.objectContaining({
          月份: '2026-05',
          产品: '云主机',
          '10分条数': 1,
          有效回访: 2,
          '10分满意率(%)': 50,
        }),
      ]),
    )
  })

  it('buildTenPointRateTrendExportRows filters by productKey', () => {
    const rows = buildTenPointRateTrendExportRows(records, 'VPC')
    expect(rows).toHaveLength(1)
    expect(rows[0].产品).toBe('VPC')
  })

  it('buildScoreDistributionExportRows includes score columns 1-9', () => {
    const distribution = computeScoreDistributionByProduct([
      ...records,
      ticket({
        id: 't4',
        followUpSatisfaction: {
          followUpTicketId: 'FH-4',
          followUpSuccessful: true,
          score: 4,
          importMonth: '2026-05',
        },
      }),
    ])
    const rows = buildScoreDistributionExportRows(distribution)
    const host = rows.find((row) => row.产品 === '云主机')
    expect(host).toEqual(
      expect.objectContaining({
        非10分: 2,
        '≤5分': 1,
        '4分': 1,
        '8分': 1,
      }),
    )
    expect(host?.['1分']).toBe(0)
  })
})
