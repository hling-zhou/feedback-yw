import { describe, expect, it } from 'vitest'
import { shouldShowRemoteRecordStale } from './recordRemoteStale.js'

describe('shouldShowRemoteRecordStale', () => {
  const base = { id: '1', recordRevision: 2 }

  it('returns false when revision unchanged', () => {
    expect(shouldShowRemoteRecordStale(base, 2, {})).toBe(false)
    expect(shouldShowRemoteRecordStale({ ...base, recordRevision: 1 }, 2, {})).toBe(false)
  })

  it('grades own bulk retag, import, or reprocessing as own_task', () => {
    expect(
      shouldShowRemoteRecordStale({ ...base, recordRevision: 3 }, 2, { retagActive: true }),
    ).toBe('own_task')
    expect(
      shouldShowRemoteRecordStale({ ...base, recordRevision: 3 }, 2, { importActive: true }),
    ).toBe('own_task')
    expect(
      shouldShowRemoteRecordStale({ ...base, recordRevision: 3 }, 2, { reprocessingActive: true }),
    ).toBe('own_task')
  })

  it('returns false when revision bump is from same user (no task running)', () => {
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

  it('grades revision bump by own shared background task lock as own_task', () => {
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
    ).toBe('own_task')
  })

  it('returns false for action item revision bump by same user without tasks', () => {
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

  it('grades another user revision bump as other (warning)', () => {
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
    ).toBe('other')
  })

  it('grades another user holding the task lock as other, own hold as own_task', () => {
    const lockOf = (userId) => ({
      id: 'lock',
      type: 'retag',
      userId,
      username: userId,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    expect(
      shouldShowRemoteRecordStale({ ...base, recordRevision: 3 }, 2, {
        userId: 'u1',
        sharedBackgroundTask: lockOf('u2'),
      }),
    ).toBe('other')
    expect(
      shouldShowRemoteRecordStale({ ...base, recordRevision: 3 }, 2, {
        userId: 'u1',
        sharedBackgroundTask: lockOf('u1'),
      }),
    ).toBe('own_task')
  })

  it('own task activity wins over same-user updatedBy silence', () => {
    // 自己发起的批量任务回写（updatedBy 也是自己）仍应提示 own_task（列表已同步为较新版本）
    expect(
      shouldShowRemoteRecordStale(
        {
          ...base,
          recordRevision: 3,
          updatedBy: { userId: 'u1', username: 'alice' },
        },
        2,
        { userId: 'u1', retagActive: true },
      ),
    ).toBe('own_task')
  })
})
