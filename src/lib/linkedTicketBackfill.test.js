import { describe, expect, it } from 'vitest'
import {
  LINKED_FEEDBACK_SOURCE_TYPES,
  collectMissingTicketIds,
  fetchFeedbackRecordsByTicketIds,
  mergeFeedbackIndexMaps,
  normalizeTicketIds,
} from './linkedTicketBackfill.js'

/** @param {string} ticketId */
function recordOf(ticketId, extra = {}) {
  return /** @type {any} */ ({ ticketId, ...extra })
}

describe('normalizeTicketIds', () => {
  it('trims, dedupes and drops empty entries', () => {
    expect(normalizeTicketIds([' A ', 'A', '', 'B', null, undefined, 'B '])).toEqual(['A', 'B'])
  })

  it('handles null and undefined input', () => {
    expect(normalizeTicketIds(undefined)).toEqual([])
    expect(normalizeTicketIds(null)).toEqual([])
  })
})

describe('collectMissingTicketIds', () => {
  it('returns ids not present in the index', () => {
    const index = new Map([
      ['T-1', recordOf('T-1')],
      ['T-2', recordOf('T-2')],
    ])
    expect(collectMissingTicketIds(index, ['T-1', 'T-3', 'T-4', 'T-3'])).toEqual(['T-3', 'T-4'])
  })

  it('is defensive against missing index or ids', () => {
    expect(collectMissingTicketIds(undefined, ['T-1'])).toEqual(['T-1'])
    expect(collectMissingTicketIds(new Map(), undefined)).toEqual([])
    expect(collectMissingTicketIds(new Map([['T-1', recordOf('T-1')]]), ['T-1'])).toEqual([])
  })
})

describe('fetchFeedbackRecordsByTicketIds', () => {
  it('queries both source types and merges by ticket id', async () => {
    /** @type {string[][]} */
    const calls = []
    const adapter = {
      async listRecordsByTicketIds(dataSourceType, ticketIds) {
        calls.push([dataSourceType, [...ticketIds]])
        if (dataSourceType === 'complaint_ticket') {
          return [recordOf('T-1', { sentiment: 'negative' }), recordOf('T-2')]
        }
        return [recordOf('T-1', { sentiment: 'positive' }), recordOf('T-3')]
      },
    }
    const records = await fetchFeedbackRecordsByTicketIds(['T-1', 'T-2', 'T-3'], adapter)

    expect(calls).toEqual([
      ['complaint_ticket', ['T-1', 'T-2', 'T-3']],
      ['consultation_ticket', ['T-1', 'T-2', 'T-3']],
    ])
    expect(records).toHaveLength(3)
    // 同号两类都返回时先到先得：投诉批在前
    expect(records.find((r) => r.ticketId === 'T-1')?.sentiment).toBe('negative')
    expect(records.find((r) => r.ticketId === 'T-3')).toBeTruthy()
  })

  it('short-circuits on empty ids or missing adapter', async () => {
    const adapter = {
      async listRecordsByTicketIds() {
        throw new Error('should not be called')
      },
    }
    await expect(fetchFeedbackRecordsByTicketIds([], adapter)).resolves.toEqual([])
    await expect(fetchFeedbackRecordsByTicketIds(['  '], adapter)).resolves.toEqual([])
    await expect(fetchFeedbackRecordsByTicketIds(['T-1'], undefined)).resolves.toEqual([])
  })

  it('drops records without a usable ticket id', async () => {
    const adapter = {
      async listRecordsByTicketIds(dataSourceType) {
        return dataSourceType === 'complaint_ticket'
          ? [recordOf('T-1'), recordOf(''), recordOf('  ')]
          : [{ other: 'no ticketId' }]
      },
    }
    const records = await fetchFeedbackRecordsByTicketIds(['T-1'], adapter)
    expect(records).toEqual([recordOf('T-1')])
  })
})

describe('mergeFeedbackIndexMaps', () => {
  it('returns the base map reference when backfill is empty', () => {
    const base = new Map([['T-1', recordOf('T-1')]])
    expect(mergeFeedbackIndexMaps(base, new Map())).toBe(base)
    expect(mergeFeedbackIndexMaps(base, undefined)).toBe(base)
  })

  it('appends only ids missing from the base map', () => {
    const base = new Map([
      ['T-1', recordOf('T-1', { from: 'period' })],
    ])
    const backfill = new Map([
      ['T-1', recordOf('T-1', { from: 'backfill' })], // 基础已有，不覆盖
      ['T-9', recordOf('T-9', { from: 'backfill' })],
    ])
    const merged = mergeFeedbackIndexMaps(base, backfill)
    expect(merged.size).toBe(2)
    expect(merged.get('T-1')?.from).toBe('period')
    expect(merged.get('T-9')?.from).toBe('backfill')
    // 原 Map 不被修改
    expect(base.size).toBe(1)
  })
})

describe('LINKED_FEEDBACK_SOURCE_TYPES', () => {
  it('matches the InsightsContext feedbacks scope', () => {
    expect(LINKED_FEEDBACK_SOURCE_TYPES).toEqual(['complaint_ticket', 'consultation_ticket'])
  })
})
