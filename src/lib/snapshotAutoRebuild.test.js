import { describe, expect, it } from 'vitest'
import { snapshotsHavePeriodData } from './snapshotAutoRebuild.js'

describe('snapshotsHavePeriodData', () => {
  it('returns true when a source has records', () => {
    expect(
      snapshotsHavePeriodData({
        sourceSnapshots: {
          complaint_ticket: { summary: { recordCount: 3 } },
        },
      }),
    ).toBe(true)
  })

  it('returns false when all sources empty', () => {
    expect(
      snapshotsHavePeriodData({
        sourceSnapshots: {
          complaint_ticket: { summary: { recordCount: 0 } },
        },
      }),
    ).toBe(false)
  })
})
