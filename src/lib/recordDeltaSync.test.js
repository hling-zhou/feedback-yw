import { describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
vi.mock('./apiClient.js', () => ({ apiFetch: (...args) => apiFetch(...args) }))

import { resolveInsightPeriod } from '../domain/insightPeriod.js'
import {
  changeTouchesLoadedCache,
  fetchRecordDelta,
  mergeRecordDelta,
  shouldCacheChangedRecord,
} from './recordDeltaSync.js'

describe('record delta sync', () => {
  it('deduplicates repeated batch writes and applies the final record and deletion once', async () => {
    apiFetch.mockReset()
    apiFetch.mockImplementation(async (url) => {
      if (url.startsWith('/api/storage/records/changes')) {
        return {
          changes: [
            { id: 'a', seq: 1 },
            { id: 'b', seq: 2 },
            { id: 'a', seq: 3 },
          ],
          cursor: 3,
          hasMore: false,
        }
      }
      if (url === '/api/storage/records/by-ids') {
        return { records: [{ id: 'a', sentiment: 'negative' }] }
      }
      throw new Error(`unexpected request: ${url}`)
    })

    const delta = await fetchRecordDelta({ after: 0, through: 3, includeChange: () => true })
    expect(delta.ids).toEqual(['a', 'b'])
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(apiFetch.mock.calls[1][1].body).ids).toEqual(['a', 'b'])

    const merged = mergeRecordDelta(
      [{ id: 'a', sentiment: 'neutral' }, { id: 'untouched' }, { id: 'b', sentiment: 'neutral' }],
      delta.ids,
      delta.records,
      () => true,
    )
    expect(merged).toEqual([{ id: 'a', sentiment: 'negative' }, { id: 'untouched' }])
  })

  it('handles records entering, leaving, or changing source in the loaded month', () => {
    const november = resolveInsightPeriod('period:month:2026-11', null)
    const tickets = [november]
    const cachedIds = new Set(['cached'])
    expect(changeTouchesLoadedCache({
      id: 'new-ticket', newSourceType: 'complaint_ticket', newImportMonth: '2026-11',
    }, cachedIds, tickets, [])).toBe(true)
    expect(changeTouchesLoadedCache({
      id: 'moved-out', oldSourceType: 'consultation_ticket', oldImportMonth: '2026-11',
      newSourceType: 'consultation_ticket', newImportMonth: '2026-12',
    }, cachedIds, tickets, [])).toBe(true)
    expect(changeTouchesLoadedCache({
      id: 'unloaded-rating', newSourceType: 'post_use_rating', newImportMonth: '2026-11',
    }, cachedIds, tickets, [])).toBe(false)
    expect(changeTouchesLoadedCache({ id: 'cached' }, cachedIds, tickets, [])).toBe(true)

    const merged = mergeRecordDelta(
      [{ id: 'cached', dataSourceType: 'complaint_ticket', importMonth: '2026-11' }],
      ['cached'],
      [{ id: 'cached', dataSourceType: 'other', importMonth: '2026-11' }],
      (record) => shouldCacheChangedRecord(record, tickets, []),
    )
    expect(merged).toEqual([])
  })
})
