/**
 * 选项类 / 低分原因聚合（月报图3/图4 用）
 */
import { matchReasonTaxonomy, REASON_TAXONOMY_EXCLUDE } from './reasonTaxonomy.js'

const DEFAULT_EXCLUDE = new Set([...REASON_TAXONOMY_EXCLUDE, '', '—', '-'])

/**
 * @param {Array<{ rawComment?: string; lowScoreReason?: string; productName?: string; channel?: string }>} rows
 * @param {{ exclude?: string[]; productNames?: string[] }} [opts]
 * @returns {{ channel: string; reason: string; count: number; productNames: string[] }[]}
 */
export function aggregateOptionReasons(rows, opts = {}) {
  const exclude = new Set(
    (opts.exclude || [...DEFAULT_EXCLUDE]).map((s) => String(s).trim()),
  )
  const productFilter = opts.productNames?.length ? new Set(opts.productNames) : null
  /** @type {Map<string, { channel: string; reason: string; count: number; products: Set<string> }>} */
  const map = new Map()

  for (const row of rows || []) {
    if (productFilter && row.productName && !productFilter.has(row.productName)) continue
    const text = String(row.rawComment || row.lowScoreReason || '')
      .trim()
      .replace(/\s+/g, ' ')
    if (!text || exclude.has(text)) continue

    const channel = String(row.channel ?? '').trim()
    const matched = matchReasonTaxonomy(text, channel || 'console')
    const reason = matched?.label || text
    if (!reason || exclude.has(reason)) continue

    const key = `${channel}\0${reason}`
    let g = map.get(key)
    if (!g) {
      g = { channel, reason, count: 0, products: new Set() }
      map.set(key, g)
    }
    g.count += 1
    if (row.productName) g.products.add(row.productName)
  }

  return [...map.values()]
    .map((g) => ({
      channel: g.channel,
      reason: g.reason,
      count: g.count,
      productNames: [...g.products].sort(),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.channel.localeCompare(b.channel, 'zh') ||
        a.reason.localeCompare(b.reason, 'zh'),
    )
}

/**
 * @param {{ reason: string; count: number; channel?: string }[]} aggregated
 * @param {string} month
 */
export function toTrendReasonRows(aggregated, month) {
  return (aggregated || []).map((r) => ({
    month,
    reason: r.reason,
    count: r.count,
    ...(r.channel != null && r.channel !== '' ? { channel: r.channel } : {}),
  }))
}
