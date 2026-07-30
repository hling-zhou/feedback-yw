import { describe, expect, it } from 'vitest'
import { fetchAllRecordPages, DEFAULT_RECORD_PAGE_SIZE } from './recordLoader.js'

/**
 * @param {number} total
 * @param {{ delayMs?: number; onCall?: (offset: number) => void }} [options]
 */
function makeMockAdapter(total, options = {}) {
  const state = { inFlight: 0, maxInFlight: 0, offsets: [] }
  const adapter = {
    async init() {},
    /** @param {{ limit: number; offset: number }} query */
    async listRecords(query) {
      state.inFlight += 1
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      state.offsets.push(query.offset)
      options.onCall?.(query.offset)
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      }
      const start = Math.min(query.offset, total)
      const size = Math.min(query.limit, total - start)
      const records = Array.from({ length: Math.max(size, 0) }, (_, i) => ({
        id: `rec-${start + i}`,
        importMonth: '2026-05',
      }))
      state.inFlight -= 1
      return { records, total, limit: query.limit, offset: query.offset }
    },
  }
  return { adapter, state }
}

describe('fetchAllRecordPages', () => {
  it('单页即取完时只请求一次', async () => {
    const { adapter, state } = makeMockAdapter(500)
    const { records, total } = await fetchAllRecordPages(adapter)
    expect(total).toBe(500)
    expect(records).toHaveLength(500)
    expect(state.offsets).toEqual([0])
  })

  it('空表直接返回', async () => {
    const { adapter, state } = makeMockAdapter(0)
    const { records, total } = await fetchAllRecordPages(adapter)
    expect(total).toBe(0)
    expect(records).toEqual([])
    expect(state.offsets).toEqual([0])
  })

  it('多页并行拉取且按页序归并', async () => {
    const total = DEFAULT_RECORD_PAGE_SIZE * 5 + 300
    const { adapter, state } = makeMockAdapter(total, { delayMs: 5 })
    const { records, total: gotTotal } = await fetchAllRecordPages(adapter)
    expect(gotTotal).toBe(total)
    expect(records).toHaveLength(total)
    // 顺序与 offset 顺序一致
    expect(records[0].id).toBe('rec-0')
    expect(records[total - 1].id).toBe(`rec-${total - 1}`)
    for (let i = 0; i < total; i += 1) {
      expect(records[i].id).toBe(`rec-${i}`)
    }
    // 全部页面都被请求
    expect(new Set(state.offsets)).toEqual(
      new Set([0, 1000, 2000, 3000, 4000, 5000].filter((o) => o < total)),
    )
    // 并行发生但未超过并发上限
    expect(state.maxInFlight).toBeGreaterThan(1)
    expect(state.maxInFlight).toBeLessThanOrEqual(4)
  })

  it('遵循自定义 limit 计算分页', async () => {
    const { adapter, state } = makeMockAdapter(250)
    const { records } = await fetchAllRecordPages(adapter, { limit: 100 })
    expect(records).toHaveLength(250)
    expect(new Set(state.offsets)).toEqual(new Set([0, 100, 200]))
  })

  it('透传过滤查询参数到每一页', async () => {
    const seen = []
    const { adapter } = makeMockAdapter(50, { onCall: (offset) => seen.push(offset) })
    /** 包装以捕获完整 query */
    const base = adapter.listRecords.bind(adapter)
    const queries = []
    adapter.listRecords = async (q) => {
      queries.push(q)
      return base(q)
    }
    await fetchAllRecordPages(adapter, { insightPeriodId: 'period:month:2026-05', limit: 20 })
    for (const q of queries) {
      expect(q.insightPeriodId).toBe('period:month:2026-05')
      expect(q.limit).toBe(20)
    }
    expect(queries).toHaveLength(3)
  })
})
