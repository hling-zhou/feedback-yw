/**
 * 用后即评趋势（跨月）— 存 meta，双适配器可用
 */
export const META_KEY_POST_USE_TREND = 'post_use_trend_v1'

/**
 * 内置正式历史累计趋势（来自参考「累计统计」低分分析 · 2026统计分布）。
 * 当前按业务要求仅开放 2026-01 ～ 2026-05，满意度存 0–100 百分数。
 */
export const POST_USE_TREND_HISTORICAL_SEED = {
  months: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'],
  /** @type {Record<string, (number | null)[]>} */
  scores: {
    云专线: [9.42, 10, 9.91, 9.65, 9.99],
    虚拟私有云: [10, 10, 10, 9.74, 9.89],
    弹性负载均衡: [10, null, 10, 9.5, 10],
    弹性公网IP: [9.87, 9.83, 9.86, 9.83, 9.89],
    共享带宽: [9.62, 9.65, 9.89, 9.82, 9.77],
    云监控: [9.67, null, 10, null, null],
  },
  /** @type {Record<string, (number | null)[]>} 原始 0–1，写入时 ×100 */
  satisfactionRates: {
    云专线: [0.91, 1, 1, 0.9167, 1],
    虚拟私有云: [1, 1, 1, 0.8462, 0.9167],
    弹性负载均衡: [1, 1, 1, 0.5, 1],
    弹性公网IP: [0.9724, 1, 0.8889, 1, 0.9583],
    共享带宽: [0.85, 1, 1, 1, 1],
  },
}

/**
 * @typedef {Object} PostUseTrendScoreRow
 * @property {string} month YYYY-MM
 * @property {string} productName
 * @property {number} avgScore
 * @property {number} sampleSize
 * @property {'internal_experience' | 'external_mixed'} scope
 */

/**
 * @typedef {Object} PostUseTrendSatisfactionRow
 * @property {string} month
 * @property {string} productName
 * @property {number} rate
 * @property {number} sampleSize
 */

/**
 * @typedef {Object} PostUseTrendReasonRow
 * @property {string} month
 * @property {string} reason
 * @property {number} count
 */

/**
 * @typedef {Object} PostUseTrendSnapshot
 * @property {number} version
 * @property {string} updatedAt
 * @property {PostUseTrendScoreRow[]} scores
 * @property {PostUseTrendSatisfactionRow[]} satisfaction
 * @property {PostUseTrendReasonRow[]} [reasons]
 * @property {boolean} [seededFromHistorical]
 */

/**
 * @returns {PostUseTrendSnapshot}
 */
export function emptyPostUseTrend() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    scores: [],
    satisfaction: [],
    reasons: [],
    seededFromHistorical: false,
  }
}

/**
 * @param {unknown} raw
 * @returns {PostUseTrendSnapshot}
 */
export function normalizePostUseTrend(raw) {
  if (!raw || typeof raw !== 'object') return emptyPostUseTrend()
  const o = /** @type {PostUseTrendSnapshot} */ (raw)
  return {
    version: 1,
    updatedAt: o.updatedAt || new Date().toISOString(),
    scores: Array.isArray(o.scores) ? o.scores : [],
    satisfaction: Array.isArray(o.satisfaction) ? o.satisfaction : [],
    reasons: Array.isArray(o.reasons) ? o.reasons : [],
    seededFromHistorical: Boolean(o.seededFromHistorical),
  }
}

/**
 * @param {PostUseTrendSnapshot} snap
 * @param {string} month
 * @param {PostUseTrendScoreRow[]} scoreRows
 * @param {PostUseTrendSatisfactionRow[]} satRows
 * @param {PostUseTrendReasonRow[]} [reasonRows]
 */
export function upsertPostUseTrendMonth(snap, month, scoreRows, satRows, reasonRows) {
  const next = normalizePostUseTrend(snap)
  next.scores = [
    ...next.scores.filter((r) => r.month !== month),
    ...scoreRows.map((r) => ({ ...r, month })),
  ]
  next.satisfaction = [
    ...next.satisfaction.filter((r) => r.month !== month),
    ...satRows.map((r) => ({ ...r, month })),
  ]
  if (reasonRows) {
    next.reasons = [
      ...(next.reasons || []).filter((r) => r.month !== month),
      ...reasonRows.map((r) => ({ ...r, month })),
    ]
  }
  next.updatedAt = new Date().toISOString()
  return next
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown> }} adapter
 */
export async function loadPostUseTrend(adapter) {
  if (!adapter?.getMeta) return mergeHistoricalTrendSeed(emptyPostUseTrend())
  return mergeHistoricalTrendSeed(
    normalizePostUseTrend(await adapter.getMeta(META_KEY_POST_USE_TREND)),
  )
}

/**
 * 历史累计趋势现已作为正式最小版历史数据展示；保留该函数仅为兼容旧调用。
 *
 * @param {PostUseTrendSnapshot | null | undefined} snapshot
 * @returns {PostUseTrendSnapshot}
 */
export function stripHistoricalSeedRows(snapshot) {
  return normalizePostUseTrend(snapshot)
}

/**
 * 将内置累计表写入空缺月份（不覆盖已有同月同产品数据）
 * @param {PostUseTrendSnapshot} snap
 * @returns {PostUseTrendSnapshot}
 */
export function mergeHistoricalTrendSeed(snap) {
  const next = normalizePostUseTrend(snap)
  const { months, scores, satisfactionRates } = POST_USE_TREND_HISTORICAL_SEED
  const existingScoreKeys = new Set(
    next.scores.map((r) => `${r.month}\u0001${r.productName}\u0001${r.scope}`),
  )
  const existingSatKeys = new Set(next.satisfaction.map((r) => `${r.month}\u0001${r.productName}`))

  for (const [productName, series] of Object.entries(scores)) {
    series.forEach((avgScore, i) => {
      if (avgScore == null || !Number.isFinite(avgScore)) return
      const month = months[i]
      const key = `${month}\u0001${productName}\u0001internal_experience`
      if (existingScoreKeys.has(key)) return
      next.scores.push({
        month,
        productName,
        avgScore,
        sampleSize: 0,
        scope: 'internal_experience',
      })
      existingScoreKeys.add(key)
    })
  }

  for (const [productName, series] of Object.entries(satisfactionRates)) {
    series.forEach((rate01, i) => {
      if (rate01 == null || !Number.isFinite(rate01)) return
      const month = months[i]
      const key = `${month}\u0001${productName}`
      if (existingSatKeys.has(key)) return
      next.satisfaction.push({
        month,
        productName,
        rate: Math.round(rate01 * 10000) / 100,
        sampleSize: 0,
      })
      existingSatKeys.add(key)
    })
  }

  next.seededFromHistorical = true
  next.updatedAt = new Date().toISOString()
  return next
}

/**
 * 若尚未灌入历史种子则写入 meta（幂等）
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function ensureHistoricalTrendSeed(adapter) {
  const prev = await loadPostUseTrend(adapter)
  if (prev.seededFromHistorical && prev.scores.length > 0) return prev
  const next = mergeHistoricalTrendSeed(prev)
  await adapter.putMeta(META_KEY_POST_USE_TREND, next)
  return next
}

/**
 * @param {PostUseTrendSnapshot} snap
 * @param {string[]} focusNames
 * @param {'internal_experience' | 'external_mixed'} [scope]
 * @returns {{ data: Record<string, unknown>[]; areas: { dataKey: string; name: string; stroke: string }[] }}
 */
export function buildFocusScoreTrendChartModel(
  snap,
  focusNames,
  scope = 'internal_experience',
) {
  const names = focusNames.filter(Boolean)
  const months = [
    ...new Set(
      (snap.scores || [])
        .filter((r) => r.scope === scope && names.includes(r.productName))
        .map((r) => r.month),
    ),
  ].sort()
  const palette = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2']
  const areas = names.map((name, i) => ({
    dataKey: name,
    name,
    stroke: palette[i % palette.length],
  }))
  const data = months.map((month) => {
    /** @type {Record<string, unknown>} */
    const row = { date: month }
    for (const name of names) {
      const hit = (snap.scores || []).find(
        (r) => r.month === month && r.productName === name && r.scope === scope,
      )
      row[name] = hit ? hit.avgScore : null
    }
    return row
  })
  return { data, areas }
}

/**
 * @param {PostUseTrendSnapshot} snap
 * @param {string[]} focusNames
 */
export function buildFocusSatisfactionTrendChartModel(snap, focusNames) {
  const names = focusNames.filter(Boolean)
  const months = [
    ...new Set(
      (snap.satisfaction || [])
        .filter((r) => names.includes(r.productName))
        .map((r) => r.month),
    ),
  ].sort()
  const palette = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2']
  const areas = names.map((name, i) => ({
    dataKey: name,
    name,
    stroke: palette[i % palette.length],
  }))
  const data = months.map((month) => {
    /** @type {Record<string, unknown>} */
    const row = { date: month }
    for (const name of names) {
      const hit = (snap.satisfaction || []).find(
        (r) => r.month === month && r.productName === name,
      )
      row[name] = hit ? hit.rate : null
    }
    return row
  })
  return { data, areas }
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {string} month
 * @param {{
 *   internalExp: { byProduct: Array<{ productName: string; avgScore: number; sampleSize: number }> }
 *   external: { yunwang: { byProduct: Array<{ productName: string; avgScore: number; sampleSize: number }> } }
 *   internalSat: { byProduct: Array<{ productName: string; rate: number; sampleSize: number }> }
 * }} metrics
 * @param {PostUseTrendReasonRow[]} [reasonRows]
 */
export async function persistPostUseTrendForMonth(adapter, month, metrics, reasonRows) {
  const prev = normalizePostUseTrend(await adapter.getMeta(META_KEY_POST_USE_TREND))
  const scoreRows = [
    ...metrics.internalExp.byProduct.map((p) => ({
      month,
      productName: p.productName,
      avgScore: p.avgScore,
      sampleSize: p.sampleSize,
      scope: /** @type {const} */ ('internal_experience'),
    })),
    ...metrics.external.yunwang.byProduct.map((p) => ({
      month,
      productName: p.productName,
      avgScore: p.avgScore,
      sampleSize: p.sampleSize,
      scope: /** @type {const} */ ('external_mixed'),
    })),
  ]
  const satRows = metrics.internalSat.byProduct.map((p) => ({
    month,
    productName: p.productName,
    rate: p.rate,
    sampleSize: p.sampleSize,
  }))
  const next = upsertPostUseTrendMonth(prev, month, scoreRows, satRows, reasonRows)
  await adapter.putMeta(META_KEY_POST_USE_TREND, next)
  return next
}
