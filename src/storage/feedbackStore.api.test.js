import { describe, it, expect, vi } from 'vitest'
import { isApiStorageAdapter, persistFeedbacks } from './feedbackStore.js'

describe('feedbackStore API safety', () => {
  it('detects API adapter by getDataRevision', () => {
    expect(isApiStorageAdapter({ getDataRevision: async () => ({ revision: 1 }) })).toBe(
      true,
    )
    expect(isApiStorageAdapter({})).toBe(false)
  })

  it('persistFeedbacks does not replaceAll on API adapter', async () => {
    const replaceAllRecords = vi.fn()
    const adapter = {
      getDataRevision: async () => ({ revision: 1 }),
      replaceAllRecords,
      putRecords: vi.fn(),
    }
    await persistFeedbacks(adapter, [{ id: 'a', rawText: 'x' }])
    expect(replaceAllRecords).not.toHaveBeenCalled()
  })
})
