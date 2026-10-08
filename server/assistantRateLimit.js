/**
 * AI 助手限流与同线程并发锁。
 *
 * 限流：每用户 10 分钟 20 次（内存计数，多实例部署各自计算）。
 * 并发锁：同一 threadId 已有请求在处理时，后到的返回 409（按进程内存标记）。
 */

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX = 20

/** @type {Map<string, number[]>} userId -> timestamps */
const userHits = new Map()
/** @type {Set<string>} 正在处理的 threadId */
const activeThreads = new Set()

/**
 * @param {string} userId
 * @returns {{ ok: boolean; retryAfterMs?: number }}
 */
export function checkRateLimit(userId) {
  const uid = String(userId || '').trim()
  if (!uid) return { ok: false }
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const hits = (userHits.get(uid) || []).filter((t) => t > cutoff)
  if (hits.length >= RATE_LIMIT_MAX) {
    const retryAfterMs = hits[0] + RATE_LIMIT_WINDOW_MS - now
    return { ok: false, retryAfterMs: Math.max(retryAfterMs, 1000) }
  }
  hits.push(now)
  userHits.set(uid, hits)
  return { ok: true }
}

/**
 * 尝试占用线程；已占用返回 false。
 * @param {string} threadId
 * @returns {boolean}
 */
export function acquireThread(threadId) {
  const tid = String(threadId || '').trim()
  if (!tid) return false
  if (activeThreads.has(tid)) return false
  activeThreads.add(tid)
  return true
}

/**
 * 释放线程占用。
 * @param {string} threadId
 */
export function releaseThread(threadId) {
  const tid = String(threadId || '').trim()
  if (tid) activeThreads.delete(tid)
}
