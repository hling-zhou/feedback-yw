/**
 * 举措 ↔ 问题签名聚合与压降验证（领域逻辑）。
 *
 * 问题签名 = productKey | journeyL1 | journeyL2（旅程为产品专属，区分度高）。
 * 问题类型/请求场景为全产品共用粗分类，作辅助上下文展示，不进签名。
 * painPoint 为自由文本，作描述样本展示，不进签名。
 */

import { monthlyTrend } from '../lib/analytics.js'
import { getDisplayPainPoint } from '../lib/ticketAnalysis/ticketAnalysisSources.js'

/** @typedef {import('./actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

const UNKNOWN_PRODUCT_KEY = '_unknown'
const UNKNOWN_JOURNEY_L1 = '未识别环节'
const UNKNOWN_JOURNEY_L2 = '未识别子环节'

/**
 * 解析举措锚点日期：scheduleAt 优先，空则 firstProposedAt 兜底。
 * @param {ActionItem} action
 * @returns {{ anchorDate: string; anchorMonth: string }}
 */
export function resolveActionAnchor(action) {
  const raw = String(action?.scheduleAt ?? '').trim() || String(action?.firstProposedAt ?? '').trim()
  return { anchorDate: raw, anchorMonth: raw ? raw.slice(0, 7) : '' }
}

/**
 * 通用前后对比（全部可用数据口径，锚点当月计入前段）。
 * @param {{ date: string; count: number }[]} trend
 * @param {string} anchorMonth YYYY-MM；空则返回 null
 * @returns {Reduction | null}
 */
export function computeReduction(trend, anchorMonth) {
  if (!anchorMonth) return null
  const entries = Array.isArray(trend) ? trend : []
  const beforeMonths = entries
    .filter((row) => String(row.date ?? '') <= anchorMonth)
    .map((row) => ({ date: String(row.date), count: Number(row.count) || 0 }))
  const afterMonths = entries
    .filter((row) => String(row.date ?? '') > anchorMonth)
    .map((row) => ({ date: String(row.date), count: Number(row.count) || 0 }))

  const beforeCount = beforeMonths.reduce((s, r) => s + r.count, 0)
  const afterCount = afterMonths.reduce((s, r) => s + r.count, 0)
  const beforeAvg = beforeMonths.length ? beforeCount / beforeMonths.length : 0
  const afterAvg = afterMonths.length ? afterCount / afterMonths.length : 0
  const changePct = beforeAvg > 0 ? Math.round(((afterAvg - beforeAvg) / beforeAvg) * 1000) / 10 : null

  return {
    anchorMonth,
    beforeMonths,
    afterMonths,
    beforeAvg: Math.round(beforeAvg * 100) / 100,
    afterAvg: Math.round(afterAvg * 100) / 100,
    beforeCount,
    afterCount,
    changePct,
    sufficient: beforeMonths.length >= 2 && afterMonths.length >= 1,
  }
}

/** @param {FeedbackRecord} record @param {Map<string, string>} [productNameByKey] */
function resolveRecordProductName(record, productNameByKey) {
  const productKey = String(record?.productKey ?? '').trim()
  if (productKey && productNameByKey?.size) {
    const fromCatalog = productNameByKey.get(productKey)?.trim()
    if (fromCatalog) return fromCatalog
  }
  return String(record?.product ?? record?.productSpec ?? '').trim() || productKey || '未标注产品'
}

/** @param {string[]} values @returns {string} */
function pluralityLabel(values) {
  const counts = new Map()
  for (const value of values) {
    const key = String(value ?? '').trim()
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  if (!counts.size) return ''
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))[0][0]
}

/** @param {FeedbackRecord} record @param {Map<string, string>} [productNameByKey] */
function recordSignature(record, productNameByKey) {
  const productKey = String(record?.productKey ?? '').trim() || UNKNOWN_PRODUCT_KEY
  const journeyL1 = String(record?.journeyL1 ?? '').trim() || UNKNOWN_JOURNEY_L1
  const journeyL2 = String(record?.journeyL2 ?? '').trim() || journeyL1 || UNKNOWN_JOURNEY_L2
  return {
    key: `${productKey}|${journeyL1}|${journeyL2}`,
    productKey,
    productName: resolveRecordProductName(record, productNameByKey),
    journeyL1,
    journeyL2,
  }
}

/** @param {FeedbackRecord[]} records @returns {string} */
function pickPainPointSample(records) {
  for (const record of records || []) {
    const text = getDisplayPainPoint(record).trim()
    if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text
  }
  return ''
}

/**
 * 以举措为中心：聚合该举措所有关联工单的问题签名 + 每签名月度趋势 + 前后对比。
 * @param {ActionItem} action
 * @param {Map<string, FeedbackRecord>} feedbackByTicketId
 * @param {Map<string, string>} [productNameByKey]
 */
export function buildActionProblemScope(action, feedbackByTicketId, productNameByKey) {
  const { anchorDate, anchorMonth } = resolveActionAnchor(action)
  const linkedIds = (action?.linkedTicketIds || []).map((id) => String(id).trim()).filter(Boolean)

  if (!linkedIds.length) {
    const productKey = String(action?.productKey ?? '').trim() || UNKNOWN_PRODUCT_KEY
    const journeyL1 = String(action?.journeyL1Snapshot ?? '').trim() || UNKNOWN_JOURNEY_L1
    const journeyL2 = String(action?.journeyL2Snapshot ?? '').trim() || journeyL1 || UNKNOWN_JOURNEY_L2
    return {
      problems: [{
        key: `${productKey}|${journeyL1}|${journeyL2}`,
        productKey,
        productName: String(action?.productName ?? '').trim() || productKey,
        journeyL1, journeyL2,
        problemTypeLabel: String(action?.problemTypeSnapshot ?? '').trim(),
        requestSceneLabel: '',
        painPointSample: String(action?.painPointSnapshot ?? '').trim(),
        ticketCount: 0, ticketIds: [], firstMonth: '', lastMonth: '',
        monthlyTrend: [], reduction: null,
      }],
      anchorDate, anchorMonth,
    }
  }

  /** @type {Map<string, { signature: ReturnType<typeof recordSignature>; records: FeedbackRecord[] }>} */
  const groups = new Map()
  for (const ticketId of linkedIds) {
    const record = feedbackByTicketId?.get(ticketId)
    if (!record) continue
    const signature = recordSignature(record, productNameByKey)
    let group = groups.get(signature.key)
    if (!group) { group = { signature, records: [] }; groups.set(signature.key, group) }
    group.records.push(record)
  }

  /** @type {any[]} */
  const problems = []
  for (const group of groups.values()) {
    const records = group.records
    const trend = monthlyTrend(records, { basis: 'importMonth' })
    const dates = trend.map((row) => String(row.date)).sort()
    problems.push({
      key: group.signature.key,
      productKey: group.signature.productKey,
      productName: group.signature.productName,
      journeyL1: group.signature.journeyL1,
      journeyL2: group.signature.journeyL2,
      problemTypeLabel: pluralityLabel(records.map((r) => r.problemType)),
      requestSceneLabel: pluralityLabel(records.map((r) => r.requestScene)),
      painPointSample: pickPainPointSample(records),
      ticketCount: records.length,
      ticketIds: records.map((r) => String(r.ticketId ?? '').trim()).filter(Boolean),
      firstMonth: dates[0] || '',
      lastMonth: dates[dates.length - 1] || '',
      monthlyTrend: trend.map((row) => ({ date: String(row.date), count: Number(row.count) || 0, negative: Number(row.negative) || 0 })),
      reduction: computeReduction(trend, anchorMonth),
    })
  }
  problems.sort((a, b) => b.ticketCount - a.ticketCount || a.key.localeCompare(b.key, 'zh-CN'))
  return { problems, anchorDate, anchorMonth }
}
/**
 * 以问题为中心：聚合全部工单的问题签名（仅含有举措的），叠加各举措的前后对比。
 * @param {ActionItem[]} actions
 * @param {FeedbackRecord[]} feedbacks
 * @param {Map<string, string>} [productNameByKey]
 * @returns {{ problems: any[] }}
 */
export function buildProblemCentricView(actions, feedbacks, productNameByKey) {
  // 1. 全量工单按签名分桶，并建 ticketId → sigKey 反查
  /** @type {Map<string, { signature: ReturnType<typeof recordSignature>; records: FeedbackRecord[] }>} */
  const buckets = new Map()
  /** @type {Map<string, string>} ticketId → sigKey */
  const ticketToSig = new Map()
  for (const record of feedbacks || []) {
    const ticketId = String(record?.ticketId ?? '').trim()
    if (!ticketId) continue
    const signature = recordSignature(record, productNameByKey)
    if (!ticketToSig.has(ticketId)) ticketToSig.set(ticketId, signature.key)
    let bucket = buckets.get(signature.key)
    if (!bucket) { bucket = { signature, records: [] }; buckets.set(signature.key, bucket) }
    bucket.records.push(record)
  }

  // 2. 举措 → 其关联工单的签名集合
  const actionList = Array.isArray(actions) ? actions : []
  /** @type {Map<string, number[]>} sigKey → 举措 index 列表 */
  const sigToActionIdxs = new Map()
  actionList.forEach((action, index) => {
    const linkedIds = (action?.linkedTicketIds || []).map((id) => String(id).trim()).filter(Boolean)
    const seenSigs = new Set()
    for (const ticketId of linkedIds) {
      const sigKey = ticketToSig.get(ticketId)
      if (sigKey) seenSigs.add(sigKey)
    }
    for (const sigKey of seenSigs) {
      let list = sigToActionIdxs.get(sigKey)
      if (!list) { list = []; sigToActionIdxs.set(sigKey, list) }
      list.push(index)
    }
  })

  // 3. 仅保留有举措的签名，组装行
  /** @type {any[]} */
  const problems = []
  for (const [sigKey, bucket] of buckets) {
    const actionIdxs = sigToActionIdxs.get(sigKey)
    if (!actionIdxs || !actionIdxs.length) continue
    const records = bucket.records
    const trend = monthlyTrend(records, { basis: 'importMonth' })
    const dates = trend.map((row) => String(row.date)).sort()

    /** @type {any[]} */
    const actionRows = []
    for (const idx of actionIdxs) {
      const action = actionList[idx]
      if (!action) continue
      const { anchorMonth } = resolveActionAnchor(action)
      actionRows.push({
        actionId: String(action.id ?? ''),
        content: String(action.content ?? ''),
        scheduleAt: String(action.scheduleAt ?? ''),
        status: String(action.status ?? ''),
        anchorMonth,
        reduction: computeReduction(trend, anchorMonth),
      })
    }
    actionRows.sort((a, b) => (a.anchorMonth || '').localeCompare(b.anchorMonth || ''))

    const firstCount = trend.length ? Number(trend[0].count) || 0 : 0
    const lastCount = trend.length ? Number(trend[trend.length - 1].count) || 0 : 0
    let overallTrend = 'unknown'
    if (trend.length >= 2) {
      if (lastCount < firstCount) overallTrend = 'down'
      else if (lastCount > firstCount) overallTrend = 'up'
      else overallTrend = 'flat'
    }

    problems.push({
      key: sigKey,
      productKey: bucket.signature.productKey,
      productName: bucket.signature.productName,
      journeyL1: bucket.signature.journeyL1,
      journeyL2: bucket.signature.journeyL2,
      problemTypeLabel: pluralityLabel(records.map((r) => r.problemType)),
      requestSceneLabel: pluralityLabel(records.map((r) => r.requestScene)),
      painPointSample: pickPainPointSample(records),
      totalTicketCount: records.length,
      firstMonth: dates[0] || '',
      lastMonth: dates[dates.length - 1] || '',
      monthlyTrend: trend.map((row) => ({ date: String(row.date), count: Number(row.count) || 0, negative: Number(row.negative) || 0 })),
      actions: actionRows,
      overallTrend,
    })
  }
  problems.sort((a, b) => b.totalTicketCount - a.totalTicketCount || a.key.localeCompare(b.key, 'zh-CN'))
  return { problems }
}

