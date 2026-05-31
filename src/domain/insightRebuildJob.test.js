import { describe, expect, it } from 'vitest'
import {
  buildInsightRebuildIdempotencyKey,
  createInsightRebuildJob,
  isActiveInsightRebuildStatus,
} from './insightRebuildJob.js'

describe('insightRebuildJob domain', () => {
  it('buildInsightRebuildIdempotencyKey is stable per period', () => {
    expect(buildInsightRebuildIdempotencyKey('period:month:2026-01')).toBe(
      'insight-rebuild:period:month:2026-01',
    )
  })

  it('createInsightRebuildJob defaults to queued', () => {
    const job = createInsightRebuildJob({
      insightPeriodId: 'period:month:2026-01',
      triggeredBy: 'tester',
    })
    expect(job.status).toBe('queued')
    expect(job.insightPeriodId).toBe('period:month:2026-01')
    expect(job.progress.total).toBe(6)
    expect(isActiveInsightRebuildStatus(job.status)).toBe(true)
  })

  it('isActiveInsightRebuildStatus excludes terminal states', () => {
    expect(isActiveInsightRebuildStatus('succeeded')).toBe(false)
    expect(isActiveInsightRebuildStatus('failed')).toBe(false)
  })
})
