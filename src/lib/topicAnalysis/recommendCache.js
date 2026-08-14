import {
  META_KEY_TOPIC_ANALYSIS_RECOMMEND_CACHE,
  TOPIC_RECOMMEND_CACHE_VERSION,
} from './constants.js'
import { compactRecommendCardsForCache } from './recommendTopics.js'

/**
 * @param {{ recordsRevision?: number, toMonth?: string, version?: number }} input
 */
export function buildRecommendCacheKey(input = {}) {
  const version = input.version ?? TOPIC_RECOMMEND_CACHE_VERSION
  const recordsRevision = Number(input.recordsRevision) || 0
  const toMonth = String(input.toMonth || '')
  return `${version}:${recordsRevision}:${toMonth}`
}

/**
 * @param {{ key?: string, cards?: object[] } | null | undefined} stored
 * @param {string} key
 */
export function recommendCacheMatches(stored, key) {
  return Boolean(
    stored
    && stored.key === key
    && Array.isArray(stored.cards)
    && stored.cards.length > 0,
  )
}

/**
 * @param {{ getMeta?: (k: string) => Promise<unknown> }} adapter
 */
export async function loadRecommendCache(adapter) {
  if (typeof adapter?.getMeta !== 'function') return null
  const raw = await adapter.getMeta(META_KEY_TOPIC_ANALYSIS_RECOMMEND_CACHE)
  if (raw && typeof raw === 'object' && Array.isArray(raw.cards)) return raw
  return null
}

/**
 * @param {{ putMeta?: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {{
 *   key: string,
 *   recordsRevision?: number,
 *   toMonth?: string,
 *   llmPolished?: boolean,
 *   cards: object[],
 * }} payload
 */
export async function saveRecommendCache(adapter, payload) {
  if (typeof adapter?.putMeta !== 'function') return
  await adapter.putMeta(META_KEY_TOPIC_ANALYSIS_RECOMMEND_CACHE, {
    version: TOPIC_RECOMMEND_CACHE_VERSION,
    key: payload.key,
    recordsRevision: Number(payload.recordsRevision) || 0,
    toMonth: payload.toMonth || '',
    llmPolished: Boolean(payload.llmPolished),
    cards: compactRecommendCardsForCache(payload.cards || []),
    savedAt: new Date().toISOString(),
  })
}
