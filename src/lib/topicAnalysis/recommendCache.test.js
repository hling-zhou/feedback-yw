import { describe, expect, it } from 'vitest'
import {
  TOPIC_RECOMMEND_CACHE_VERSION,
} from './constants.js'
import {
  buildRecommendCacheKey,
  loadRecommendCache,
  recommendCacheMatches,
  saveRecommendCache,
} from './recommendCache.js'

describe('recommendCache', () => {
  it('matches only the same rule version, recordsRevision and month', () => {
    const key = buildRecommendCacheKey({ recordsRevision: 4, toMonth: '2026-08' })
    expect(key).toBe(`${TOPIC_RECOMMEND_CACHE_VERSION}:4:2026-08`)
    expect(recommendCacheMatches({ key, cards: [{ id: 'a' }] }, key)).toBe(true)
    expect(recommendCacheMatches({ key, cards: [{ id: 'a' }] }, buildRecommendCacheKey({
      recordsRevision: 5,
      toMonth: '2026-08',
    }))).toBe(false)
    expect(recommendCacheMatches({ key, cards: [] }, key)).toBe(false)
  })

  it('round-trips compact cards and ignores action-only revision changes', async () => {
    /** @type {Record<string, unknown>} */
    const meta = {}
    const adapter = {
      getMeta: async (k) => meta[k] || null,
      putMeta: async (k, v) => { meta[k] = v },
    }
    const key = buildRecommendCacheKey({ recordsRevision: 9, toMonth: '2026-08' })
    await saveRecommendCache(adapter, {
      key,
      recordsRevision: 9,
      toMonth: '2026-08',
      llmPolished: true,
      cards: [{
        id: 'product:弹性公网IP:退订',
        type: 'product_issue',
        title: '弹性公网IP · 退订',
        score: 12,
        records: [{ id: 'secret', rawText: '工单全文' }],
      }],
    })
    const stored = await loadRecommendCache(adapter)
    expect(recommendCacheMatches(stored, key)).toBe(true)
    expect(stored.cards[0].records).toBeUndefined()
    expect(stored.cards[0].recordIds).toEqual(['secret'])
    expect(recommendCacheMatches(stored, buildRecommendCacheKey({
      recordsRevision: 9,
      toMonth: '2026-08',
    }))).toBe(true)
  })
})
