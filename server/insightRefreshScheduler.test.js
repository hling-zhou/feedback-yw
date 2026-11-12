import { describe, expect, it } from 'vitest'
import { nextBeijingFive } from './insightRefreshScheduler.js'

describe('insight refresh schedule', () => {
  it('runs at 05:00 Beijing time when the time has not arrived', () => {
    expect(nextBeijingFive(new Date('2026-11-11T20:59:59.000Z')).toISOString())
      .toBe('2026-11-11T21:00:00.000Z')
  })

  it('moves to the following Beijing day at exactly 05:00', () => {
    expect(nextBeijingFive(new Date('2026-11-11T21:00:00.000Z')).toISOString())
      .toBe('2026-11-12T21:00:00.000Z')
  })
})
