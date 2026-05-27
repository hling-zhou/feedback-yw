/** @typedef {import('../storage/adapter.js').StorageAdapter} StorageAdapter */

const STORAGE_KEY = 'feedback-insights:recommendation-feedback'
export const META_KEY_RECOMMENDATION_FEEDBACK = 'recommendation_feedback_v1'

/** @typedef {'inaccurate' | 'not_actionable' | 'duplicate' | 'other'} RecommendationFeedbackType */

/**
 * @typedef {Object} RecommendationFeedbackEntry
 * @property {string} recommendationId
 * @property {string} insightPeriodId
 * @property {RecommendationFeedbackType} type
 * @property {string} [comment]
 * @property {string} createdAt
 */

/** @type {RecommendationFeedbackEntry[]} */
let memoryCache = []

/**
 * @returns {RecommendationFeedbackEntry[]}
 */
function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * @param {RecommendationFeedbackEntry[]} entries
 */
function writeLocal(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-500)))
}

/**
 * @param {unknown} raw
 * @returns {RecommendationFeedbackEntry[]}
 */
function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (e) =>
      e &&
      typeof e === 'object' &&
      typeof e.recommendationId === 'string' &&
      typeof e.insightPeriodId === 'string' &&
      typeof e.createdAt === 'string',
  )
}

/**
 * @param {RecommendationFeedbackEntry[]} a
 * @param {RecommendationFeedbackEntry[]} b
 */
function mergeEntries(a, b) {
  const key = (e) => `${e.insightPeriodId}\0${e.recommendationId}\0${e.createdAt}\0${e.type}`
  const map = new Map()
  for (const e of [...a, ...b]) map.set(key(e), e)
  return [...map.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt))
}

function syncMemory(entries) {
  memoryCache = entries.slice(-500)
  writeLocal(memoryCache)
}

/**
 * 登录共享库后：合并服务端与本机 localStorage，并回写服务端。
 * @param {StorageAdapter} adapter
 */
export async function hydrateRecommendationFeedbackFromServer(adapter) {
  if (!adapter?.getMeta) {
    syncMemory(readLocal())
    return
  }
  const raw = await adapter.getMeta(META_KEY_RECOMMENDATION_FEEDBACK)
  const fromServer = normalizeEntries(raw)
  const fromLocal = readLocal()
  const merged = mergeEntries(fromServer, fromLocal).slice(-500)
  syncMemory(merged)
  if (typeof adapter.putMeta === 'function' && merged.length > fromServer.length) {
    await adapter.putMeta(META_KEY_RECOMMENDATION_FEEDBACK, merged)
  }
}

/**
 * @param {string} insightPeriodId
 * @param {string} recommendationId
 */
export function getRecommendationFeedbackCount(insightPeriodId, recommendationId) {
  const list = memoryCache.length ? memoryCache : readLocal()
  return list.filter(
    (e) => e.insightPeriodId === insightPeriodId && e.recommendationId === recommendationId,
  ).length
}

/**
 * @param {{
 *   insightPeriodId: string
 *   recommendationId: string
 *   type: RecommendationFeedbackType
 *   comment?: string
 * }} params
 * @param {StorageAdapter | null} [adapter]
 */
export async function saveRecommendationFeedback(params, adapter = null) {
  const entry = {
    insightPeriodId: params.insightPeriodId,
    recommendationId: params.recommendationId,
    type: params.type,
    comment: params.comment?.trim() || undefined,
    createdAt: new Date().toISOString(),
  }
  const merged = mergeEntries(memoryCache.length ? memoryCache : readLocal(), [entry]).slice(-500)
  syncMemory(merged)
  if (adapter?.putMeta) {
    await adapter.putMeta(META_KEY_RECOMMENDATION_FEEDBACK, merged)
  }
  return entry
}

export const FEEDBACK_TYPE_LABELS = {
  inaccurate: '不准确',
  not_actionable: '难落地',
  duplicate: '重复',
  other: '其他',
}
