import { describe, expect, it } from 'vitest'
import { buildImportUrl } from './importRoute.js'

describe('buildImportUrl', () => {
  it('returns bare /import when source is missing or invalid', () => {
    expect(buildImportUrl()).toBe('/import')
    expect(buildImportUrl({})).toBe('/import')
    expect(buildImportUrl({ source: 'overview' })).toBe('/import')
    expect(buildImportUrl({ source: '' })).toBe('/import')
  })

  it('carries a valid data source', () => {
    expect(buildImportUrl({ source: 'consultation_ticket' })).toBe(
      '/import?source=consultation_ticket',
    )
    expect(buildImportUrl({ source: 'complaint_ticket' })).toBe('/import?source=complaint_ticket')
  })

  it('defaults post_use_rating to channel_bundle and accepts explicit subType', () => {
    expect(buildImportUrl({ source: 'post_use_rating' })).toBe(
      '/import?source=post_use_rating&subType=channel_bundle',
    )
    expect(buildImportUrl({ source: 'post_use_rating', subType: 'customer_visit' })).toBe(
      '/import?source=post_use_rating&subType=customer_visit',
    )
  })
})
