import { normalizeWhatsNewFeed } from '../domain/whatsNewFeed.js'

/**
 * 加载更新动态静态 feed。
 * @returns {Promise<import('../domain/whatsNewFeed.js').WhatsNewFeed>}
 */
export async function fetchWhatsNewFeed() {
  const res = await fetch('/config/whats-new.json', { cache: 'no-cache' })
  if (!res.ok) {
    throw new Error(`加载更新动态失败（${res.status}）`)
  }
  const raw = await res.json()
  return normalizeWhatsNewFeed(raw)
}
