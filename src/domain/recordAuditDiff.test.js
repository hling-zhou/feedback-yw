import { describe, expect, it } from 'vitest'
import { listChangedObjectKeys, listChangedRecordFields } from './recordAuditDiff.js'

describe('recordAuditDiff', () => {
  it('lists changed top-level record fields and ignores revision metadata', () => {
    const previous = {
      id: 'r1',
      ticketId: 'T-1',
      requestScene: '报障',
      recordRevision: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: { userId: 'u1', username: 'alice' },
    }
    const next = {
      ...previous,
      requestScene: '咨询',
      recordRevision: 2,
      updatedAt: '2026-08-15T00:00:00.000Z',
      updatedBy: { userId: 'u2', username: 'bob' },
    }
    expect(listChangedRecordFields(previous, next)).toEqual(['requestScene'])
  })

  it('lists changed object keys and ignores updatedAt', () => {
    expect(
      listChangedObjectKeys(
        { useRegex: true, ticketLlmMode: 'off', updatedAt: 'a' },
        { useRegex: false, ticketLlmMode: 'off', updatedAt: 'b' },
      ),
    ).toEqual(['useRegex'])
  })
})
