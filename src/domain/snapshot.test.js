import { describe, expect, it } from 'vitest'
import { formatSnapshotGeneratedAt, overviewSnapshotId, sourceSnapshotId } from './snapshot.js'

describe('snapshot ids', () => {
  it('builds source and overview ids', () => {
    expect(sourceSnapshotId('complaint_ticket', '2026-08')).toBe(
      'snapshot:2026-08:complaint_ticket',
    )
    expect(overviewSnapshotId('2026-08')).toBe('overview:2026-08')
  })
})

describe('formatSnapshotGeneratedAt', () => {
  it('returns empty for missing value', () => {
    expect(formatSnapshotGeneratedAt('')).toBe('')
    expect(formatSnapshotGeneratedAt(undefined)).toBe('')
  })

  it('formats ISO timestamps in local time instead of slicing UTC', () => {
    const iso = '2026-09-05T20:10:00.000Z'
    const formatted = formatSnapshotGeneratedAt(iso)
    expect(formatted).not.toContain('T')
    expect(formatted).not.toBe('2026-09-05 20:10')
    expect(formatted).toBe(
      new Date(iso).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    )
  })
})
