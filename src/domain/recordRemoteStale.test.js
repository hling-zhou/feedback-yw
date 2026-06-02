import { describe, expect, it } from 'vitest'
import { shouldShowRemoteRecordStale } from './recordRemoteStale.js'

describe('shouldShowRemoteRecordStale', () => {
  const base = { id: '1', recordRevision: 2 }

  it('returns false when revision unchanged', () => {
    expect(shouldShowRemoteRecordStale(base, 2, {})).toBe(false)
    expect(shouldShowRemoteRecordStale({ ...base, recordRevision: 1 }, 2, {})).toBe(false)
  })

  it('returns false during own bulk retag, import, or reprocessing', () => {
    expect(
      shouldShowRemoteRecordStale({ ...base, recordRevision: 3 }, 2, { retagActive: true }),
    ).toBe(false)
    expect(
      shouldShowRemoteRecordStale({ ...base, recordRevision: 3 }, 2, { importActive: true }),
    ).toBe(false)
    expect(
      shouldShowRemoteRecordStale({ ...base, recordRevision: 3 }, 2, { reprocessingActive: true }),
    ).toBe(false)
  })

  it('returns false when revision bump is from same user', () => {
    expect(
      shouldShowRemoteRecordStale(
        {
          ...base,
          recordRevision: 3,
          updatedBy: { userId: 'u1', username: 'alice' },
        },
        2,
        { userId: 'u1' },
      ),
    ).toBe(false)
  })

  it('returns false when user holds shared background task lock', () => {
    expect(
      shouldShowRemoteRecordStale(
        { ...base, recordRevision: 3 },
        2,
        {
          userId: 'u1',
          sharedBackgroundTask: {
            id: 'lock',
            type: 'retag',
            userId: 'u1',
            username: 'alice',
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      ),
    ).toBe(false)
  })

  it('returns false for action item revision bump by same user', () => {
    expect(
      shouldShowRemoteRecordStale(
        {
          id: 'a1',
          recordRevision: 4,
          updatedBy: { userId: 'u1', username: 'alice' },
        },
        3,
        { userId: 'u1' },
      ),
    ).toBe(false)
  })

  it('returns true for another user revision bump', () => {
    expect(
      shouldShowRemoteRecordStale(
        {
          ...base,
          recordRevision: 3,
          updatedBy: { userId: 'u2', username: 'bob' },
        },
        2,
        { userId: 'u1' },
      ),
    ).toBe(true)
  })
})
