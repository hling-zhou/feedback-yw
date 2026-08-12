/**
 * 用后即评 → 举措推荐（方案默认规则，可配置）
 */

import {
  POST_USE_SATISFACTION_BASELINE,
  POST_USE_SCORE_BASELINE,
  POST_USE_SMALL_SAMPLE_N,
} from './metrics.js'

/**
 * @typedef {Object} ActionSignal
 * @property {'satisfaction_below' | 'experience_below' | 'callback_non_ten'} type
 * @property {string} productName
 * @property {string} title
 * @property {string} detail
 * @property {'P0' | 'P1'} priority
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @param {{
 *   internalSat?: { byProduct: Array<{ productName: string; rate: number; sampleSize: number; smallSample?: boolean; belowBaseline?: boolean }> }
 *   internalExp?: { byProduct: Array<{ productName: string; avgScore: number; sampleSize: number; smallSample?: boolean; belowNine?: boolean }> }
 *   callbackNonTen?: Array<{ productName: string; score: number; customerName?: string; lowScoreReason?: string; originalTicketId?: string }>
 *   smallSampleN?: number
 * }} input
 * @returns {ActionSignal[]}
 */
export function buildPostUseActionSignals(input) {
  const smallN = input.smallSampleN ?? POST_USE_SMALL_SAMPLE_N
  /** @type {ActionSignal[]} */
  const signals = []

  for (const p of input.internalSat?.byProduct || []) {
    if (p.sampleSize < smallN) continue
    if (p.rate / 100 >= POST_USE_SATISFACTION_BASELINE) continue
    signals.push({
      type: 'satisfaction_below',
      productName: p.productName,
      priority: 'P0',
      title: `${p.productName} 投诉回访满意度未达标`,
      detail: `10分率 ${p.rate}%（n=${p.sampleSize}，达标线 ${POST_USE_SATISFACTION_BASELINE * 100}%）`,
      meta: { rate: p.rate, sampleSize: p.sampleSize },
    })
  }

  for (const p of input.internalExp?.byProduct || []) {
    if (p.sampleSize < smallN) continue
    if (p.avgScore >= POST_USE_SCORE_BASELINE) continue
    signals.push({
      type: 'experience_below',
      productName: p.productName,
      priority: 'P1',
      title: `${p.productName} 体验均分低于 ${POST_USE_SCORE_BASELINE}`,
      detail: `对内体验均分 ${p.avgScore}（n=${p.sampleSize}，仅短信+控制台）`,
      meta: { avgScore: p.avgScore, sampleSize: p.sampleSize },
    })
  }

  for (const row of input.callbackNonTen || []) {
    if (!row.lowScoreReason || /^(无|无\/不涉及|\/)?$/.test(String(row.lowScoreReason).trim())) {
      continue
    }
    signals.push({
      type: 'callback_non_ten',
      productName: row.productName,
      priority: 'P0',
      title: `${row.productName} 客诉回访非10分`,
      detail: `${row.score}分 · ${row.customerName || ''} · ${row.lowScoreReason}`,
      meta: {
        score: row.score,
        originalTicketId: row.originalTicketId,
        customerName: row.customerName,
      },
    })
  }

  const order = { P0: 0, P1: 1 }
  return signals.sort((a, b) => order[a.priority] - order[b.priority] || a.productName.localeCompare(b.productName, 'zh'))
}

/**
 * 月报举措筛选（建议默认）
 * @param {import('../../domain/actionItem.js').ActionItem[]} items
 * @param {{
 *   reportMonth: string
 *   productNames: string[]
 *   mode: 'this_month_proposed' | 'closed_in_month'
 * }} opts
 */
export function filterActionsForMonthlyReport(items, opts) {
  const productSet = new Set(opts.productNames)
  const [y, m] = opts.reportMonth.split('-').map(Number)
  const monthStart = `${opts.reportMonth}-01`
  const nextMonth =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`

  return (items || []).filter((item) => {
    const linked = item.linkedDataSources || []
    if (!linked.includes('post_use_rating')) return false
    const pname = item.productName || ''
    if (productSet.size && !productSet.has(pname)) return false
    if (opts.mode === 'this_month_proposed') {
      const t = item.firstProposedAt || item.createdAt || ''
      return t >= monthStart && t < nextMonth
    }
    if (opts.mode === 'closed_in_month') {
      const terminal = ['completed', 'not_implemented', 'abnormal_terminated']
      if (!terminal.includes(item.status)) return false
      const t = item.updatedAt || ''
      return t >= monthStart && t < nextMonth
    }
    return false
  })
}
