import { describe, expect, it } from 'vitest'
import {
  applyRecordWriteMetadata,
  getRecordRevision,
  isRecordConflictError,
  RecordConflictError,
  RECORD_CONFLICT_CODE,
  toRecordConflictError,
} from './recordRevision.js'

describe('recordRevision', () => {
  it('getRecordRevision defaults missing to 0', () => {
    expect(getRecordRevision(null)).toBe(0)
    expect(getRecordRevision({})).toBe(0)
    expect(getRecordRevision({ recordRevision: 3 })).toBe(3)
  })

  it('applyRecordWriteMetadata increments revision and sets updatedAt', () => {
    const next = applyRecordWriteMetadata(
      { id: '1', recordRevision: 2 },
      { previousRevision: 2, actor: { userId: 'u1', username: 'alice' } },
    )
    expect(next.recordRevision).toBe(3)
    expect(next.updatedAt).toMatch(/^\d{4}-/)
    expect(next.updatedBy).toEqual({ userId: 'u1', username: 'alice' })
  })

  it('RecordConflictError and parsers', () => {
    const err = new RecordConflictError('冲突', { current: { id: '1' }, currentRevision: 5 })
    expect(isRecordConflictError(err)).toBe(true)
    expect(toRecordConflictError({ code: RECORD_CONFLICT_CODE, current: { id: '1' }, currentRevision: 5 }))
      .toBeInstanceOf(RecordConflictError)
  })
})
