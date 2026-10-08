import { normalizeWhatsNewFeed } from '../domain/whatsNewFeed.js'

/** @type {import('../domain/whatsNewFeed.js').WhatsNewFeed | null} */
let cachedFeed = null
/** @type {Promise<import('../domain/whatsNewFeed.js').WhatsNewFeed> | null} */
let inflight = null

/** 已成功加载过的更新动态，抽屉打开时先用它，避免一直停在「加载中」。 */
export function peekWhatsNewFeed() {
  return cachedFeed
}

/**
 * 加载更新动态静态 feed。
 * @returns {Promise<import('../domain/whatsNewFeed.js').WhatsNewFeed>}
 */
const FEED_TIMEOUT_MS = 8000

export function fetchWhatsNewFeed() {
  if (!inflight) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
    inflight = fetch('/config/whats-new.json', { cache: 'no-cache', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`加载更新动态失败（${res.status}）`)
        const raw = await res.json()
        const feed = normalizeWhatsNewFeed(raw)
        cachedFeed = feed
        return feed
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new Error('加载更新动态超时')
        }
        throw err
      })
      .finally(() => {
        clearTimeout(timer)
        inflight = null
      })
  }
  return inflight
}
