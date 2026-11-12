import { describe, expect, it } from 'vitest'
import { filterCustomerVisitRecords, filterVisitsByMonths } from './visitRecords.js'
import { POST_USE_RATING_CATALOG_SEED_PRODUCTS, scopePostUseRatingRecords } from '../productCatalog/postUseRatingProducts.js'

describe('customer visit library drill-down', () => {
  it('matches the dashboard period and product count before applying customer filters', () => {
    const visits = [
      { id: 'visit-eip-april', importMonth: '2026-04', productName: '弹性公网IP', customerName: '客户甲' },
      { id: 'visit-eip-june', importMonth: '2026-06', productName: '弹性公网IP', customerName: '客户乙' },
      { id: 'visit-ecs-june', importMonth: '2026-06', productName: '云主机', customerName: '客户丙' },
      { id: 'visit-eip-july', importMonth: '2026-07', productName: '弹性公网IP', customerName: '客户丁' },
    ]
    const inQuarter = filterVisitsByMonths(visits, ['2026-04', '2026-05', '2026-06'])
    expect(filterCustomerVisitRecords(inQuarter, { product: '弹性公网IP' }).map((row) => row.id))
      .toEqual(['visit-eip-april', 'visit-eip-june'])
    expect(filterCustomerVisitRecords(inQuarter, { product: '弹性公网IP', customerNames: ['乙'] }).map((row) => row.id))
      .toEqual(['visit-eip-june'])
  })

  it('matches the parent product when a visit stores a specification name', () => {
    const visits = [
      { id: 'visit-ssl', importMonth: '2026-06', productName: 'SSL VPN', customerName: '客户甲' },
      { id: 'visit-vpn', importMonth: '2026-06', productName: '融合VPN', customerName: '客户乙' },
    ]
    const catalog = POST_USE_RATING_CATALOG_SEED_PRODUCTS
    const dashboardCount = scopePostUseRatingRecords(visits, catalog)
      .filter((record) => record.productName === '融合VPN').length
    const libraryRows = filterCustomerVisitRecords(visits, { product: '融合VPN', catalog })
    expect(dashboardCount).toBe(2)
    expect(libraryRows.map((row) => row.id)).toEqual(['visit-ssl', 'visit-vpn'])
  })
})
