import { describe, expect, it } from 'vitest'
import {
  applyActionItemWriteMetadata,
  getActionItemRevision,
  toActionItemConflictError,
  ACTION_ITEM_CONFLICT_CODE,
} from './actionItemRevision.js'

describe('actionItemRevision', () => {
  it('getActionItemRevision defaults to 0', () => {
    expect(getActionItemRevision(null)).toBe(0)
    expect(getActionItemRevision({ id: 'a', content: 'x', status: 'in_progress', createdAt: '', updatedAt: '' })).toBe(0)
  })

  it('applyActionItemWriteMetadata increments revision', () => {
    const next = applyActionItemWriteMetadata(
      { id: 'a', content: 'x', status: 'in_progress', createdAt: 't', updatedAt: 't', recordRevision: 2 },
      { previousRevision: 2, actor: { userId: 'u', username: 'bob' } },
    )
    expect(next.recordRevision).toBe(3)
    expect(next.updatedBy?.username).toBe('bob')
  })

  it('toActionItemConflictError parses api error', () => {
    const err = toActionItemConflictError({
      code: ACTION_ITEM_CONFLICT_CODE,
      data: { code: ACTION_ITEM_CONFLICT_CODE, current: { id: 'a' }, currentRevision: 4 },
    })
    expect(err?.currentRevision).toBe(4)
  })
})
