import { isSubstantiveFeedbackReason, matchAllReasonTaxonomy } from './reasonTaxonomy.js'
import { normalizeEvidenceText } from './evidence.js'
import { POST_USE_CRITICAL_LOW_SCORE, POST_USE_SMALL_SAMPLE_N, hasCriticalLowScore } from './metrics.js'
import { POST_USE_ANALYSIS_RULE_VERSION } from './modelVersions.js'
import { isKeyCustomerName } from './callbackRecommendations.js'

export const POST_USE_ORIGINAL_SCENE_EMPTY = '未提供'
export const POST_USE_JOURNEY_EMPTY = '未识别环节'
/** 用后即评一级旅程展示顺序（生命周期，不含未识别）。 */
export const POST_USE_JOURNEY_L1_ORDER = ['开通', '账号', '使用', '变更', '费用', '退订']
const HIGH_FREQUENCY_LOW_SCORE_THRESHOLD = 7

function isOptionScoreRecord(record) {
  const channel = String(record?.channel || '').trim()
  const sourceSubType = String(record?.sourceSubType || '').trim()
  return channel === 'option' || sourceSubType === 'web_option'
}

/** @param {object} record */
function normalizedRecord(record) {
  const rawScore = Number(record.ratingScore ?? record.score)
  return {
    id: String(record.id || record.ratingId || ''),
    month: String(record.importMonth || record.createdAt || '').slice(0, 7),
    productName: String(record.productName || record.product || '').trim(),
    score: isOptionScoreRecord(record) ? NaN : rawScore,
    customerName: String(record.customerName || '').trim() || '匿名客户',
    customerCode: String(record.customerCode || '').trim(),
    originalScene: String(record.originalScene || record.scene || '').trim() || POST_USE_ORIGINAL_SCENE_EMPTY,
    journeyL1: String(record.journeyL1 || '').trim() || POST_USE_JOURNEY_EMPTY,
    journeyL2: String(record.journeyL2 || '').trim(),
    channel: String(record.channel || ''),
    text: normalizeEvidenceText(record.evidence?.sourceText || record.rawText || record.commentText || record.lowScoreReason),
  }
}

/** @param {object} visit */
function normalizedVisit(visit) {
  const customerInfo = [visit.customerName, visit.customerCode].filter(Boolean).join(' / ')
  return {
    id: String(visit.id || ''),
    month: String(visit.importMonth || visit.visitMonth || '').slice(0, 7),
    productName: String(visit.productName || '').trim(),
    userInfo: normalizeEvidenceText(visit.userInfo || customerInfo),
    feedbackSummary: normalizeEvidenceText(visit.feedbackSummary),
    visitResult: normalizeEvidenceText(visit.visitResult || visit.visitFeedbackDetail || visit.feedbackSummary),
    internalConclusion: normalizeEvidenceText(visit.internalConclusion || visit.internalEvaluationDetail),
    remark: normalizeEvidenceText(visit.remark),
    text: normalizeEvidenceText([visit.feedbackSummary, visit.visitResult, visit.internalConclusion].filter(Boolean).join(' ')),
  }
}

/** @param {ReturnType<typeof normalizedVisit>[]} visits */
function visitItemsFrom(visits) {
  return (visits || []).map((visit) => ({
    visitResult: visit.visitResult || '',
    internalConclusion: visit.internalConclusion || '',
    remark: visit.remark || '',
  }))
}

/** @param {object} record */
function pickHighFrequencyLowScoreReason(record) {
  const explicit = Array.isArray(record.feedbackReasonTexts)
    ? record.feedbackReasonTexts
    : []
  const candidates = explicit.length
    ? explicit
    : [
      record.feedbackReasonPrimary,
      record.feedbackReasonSecondary,
      record.feedbackReasonTertiary,
    ]
  const seen = new Set()
  for (const candidate of candidates) {
    const text = normalizeEvidenceText(candidate)
    if (!text || seen.has(text)) continue
    seen.add(text)
    if (isSubstantiveFeedbackReason(text)) return text
  }
  return ''
}

/** @param {object[]} visits @param {string} productName */
function visitsForProduct(visits, productName) {
  return (visits || []).map(normalizedVisit).filter((visit) => visit.productName === productName)
}

/** @param {number[]} values */
const avg = (values) => values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : 0

/** @param {object[]} records */
export function buildProductExperienceOverview(records, visits = []) {
  const groups = new Map()
  for (const raw of records || []) {
    const r = normalizedRecord(raw)
    if (!r.productName || !Number.isFinite(r.score)) continue
    const g = groups.get(r.productName) || { productName: r.productName, rows: [] }
    g.rows.push(r)
    groups.set(r.productName, g)
  }
  return [...groups.values()].map((g) => {
    const score = avg(g.rows.map((r) => r.score))
    const nonTenCount = g.rows.filter((r) => r.score < 10).length
    const sampleSize = g.rows.length
    const minScore = g.rows.length ? Math.min(...g.rows.map((r) => r.score)) : null
    const criticalLowScore = hasCriticalLowScore(g.rows.map((r) => r.score))
    let state = '良好'
    let stateCode = 'healthy'
    if (sampleSize < POST_USE_SMALL_SAMPLE_N && !criticalLowScore) {
      state = '样本不足'
      stateCode = 'small_sample'
    } else if (criticalLowScore || score < 9 || nonTenCount / sampleSize >= 0.3) {
      state = '重点改善'
      stateCode = 'critical'
    } else if (score < 9.5 || nonTenCount > 0) {
      state = '持续观察'
      stateCode = 'watch'
    }
    const productVisits = visitsForProduct(visits, g.productName)
    return {
      productName: g.productName,
      sampleSize,
      avgScore: score,
      nonTenCount,
      nonTenRate: Math.round((nonTenCount / sampleSize) * 10000) / 100,
      minScore,
      hasCriticalLowScore: criticalLowScore,
      state,
      stateCode,
      explanation: sampleSize < POST_USE_SMALL_SAMPLE_N && !criticalLowScore
        ? `n=${sampleSize}，低于小样本阈值 ${POST_USE_SMALL_SAMPLE_N}`
        : criticalLowScore
          ? `样本量 ${sampleSize}，但出现 ${POST_USE_CRITICAL_LOW_SCORE} 分及以下极低分（最低 ${minScore} 分）`
        : `均分 ${score}，非10分 ${nonTenCount}/${sampleSize}`,
      ruleVersion: POST_USE_ANALYSIS_RULE_VERSION,
      evidenceIds: g.rows.filter((r) => r.score < 10).map((r) => r.id).filter(Boolean),
      visitEvidenceCount: productVisits.length,
      visitEvidenceIds: productVisits.map((visit) => visit.id).filter(Boolean),
      visitConclusions: productVisits.map((visit) => visit.internalConclusion || visit.visitResult).filter(Boolean),
    }
  }).sort((a, b) => {
    const order = { critical: 0, watch: 1, small_sample: 2, healthy: 3 }
    return order[a.stateCode] - order[b.stateCode] || a.avgScore - b.avgScore
  })
}

/**
 * 均分纵轴起点：最低分减 1 再取整，不从 0 起；下限 0，上限默认 10。
 * @param {number[]} scores
 * @param {{ max?: number }} [opts]
 */
export function scoreAxisDomain(scores, opts = {}) {
  const max = Number.isFinite(Number(opts.max)) ? Number(opts.max) : 10
  const nums = (scores || [])
    .filter((value) => value != null && value !== '')
    .map(Number)
    .filter((value) => Number.isFinite(value))
  if (!nums.length) return [0, max]
  const start = Math.max(0, Math.floor(Math.min(...nums) - 1))
  return [Math.min(start, max), max]
}

/**
 * 投诉回访满意度纵轴：最低值减 10 再向下取到 0/10/…/90，不从 0 起；上限 100。
 * @param {number[]} rates
 * @param {{ max?: number }} [opts]
 */
export function satisfactionAxisDomain(rates, opts = {}) {
  const max = Number.isFinite(Number(opts.max)) ? Number(opts.max) : 100
  const nums = (rates || [])
    .filter((value) => value != null && value !== '')
    .map(Number)
    .filter((value) => Number.isFinite(value))
  if (!nums.length) return [0, max]
  const start = Math.max(0, Math.min(90, Math.floor((Math.min(...nums) - 10) / 10) * 10))
  return [Math.min(start, max), max]
}

export function chartSeriesValues(data, dataKeys) {
  const keys = Array.isArray(dataKeys) ? dataKeys : [dataKeys]
  const values = []
  for (const row of data || []) {
    for (const key of keys) {
      if (!key) continue
      const raw = row?.[key]
      if (raw == null || raw === '') continue
      const num = Number(raw)
      if (Number.isFinite(num)) values.push(num)
    }
  }
  return values
}

/**
 * 给趋势图 areas 填上纵轴 domain。kind=combined 时左轴体验分、右轴满意度。
 * @param {{ data?: object[], areas?: object[] } | null | undefined} chart
 * @param {{ kind?: 'score' | 'rate' | 'combined' }} [opts]
 */
export function withPostUseTrendDomains(chart, opts = {}) {
  if (!chart?.data?.length || !chart.areas?.length) return chart
  const kind = opts.kind
    || (chart.areas.some((area) => area.yAxisId === 'rate') && chart.areas.some((area) => area.yAxisId && area.yAxisId !== 'rate')
      ? 'combined'
      : chart.areas.some((area) => area.yAxisId === 'rate' || /满意度|Rate/i.test(`${area.name || ''}${area.dataKey || ''}`))
        ? 'rate'
        : 'score')
  if (kind === 'combined') {
    const scoreKeys = chart.areas.filter((area) => area.yAxisId !== 'rate').map((area) => area.dataKey)
    const rateKeys = chart.areas.filter((area) => area.yAxisId === 'rate').map((area) => area.dataKey)
    const scoreDomain = scoreAxisDomain(chartSeriesValues(chart.data, scoreKeys))
    const rateDomain = satisfactionAxisDomain(chartSeriesValues(chart.data, rateKeys))
    return {
      ...chart,
      areas: chart.areas.map((area) => ({
        ...area,
        domain: area.yAxisId === 'rate' ? rateDomain : scoreDomain,
      })),
    }
  }
  const values = chartSeriesValues(chart.data, chart.areas.map((area) => area.dataKey))
  const domain = kind === 'rate' ? satisfactionAxisDomain(values) : scoreAxisDomain(values)
  return {
    ...chart,
    domain,
    areas: chart.areas.map((area) => ({ ...area, domain })),
  }
}

function journeySortIndex(journey) {
  if (journey === POST_USE_JOURNEY_EMPTY) return 1000
  const index = POST_USE_JOURNEY_L1_ORDER.indexOf(journey)
  return index >= 0 ? index : 500
}

/**
 * 产品 × 一级用户旅程分布（不含评价触发场景）。
 * @param {object[]} records
 */
export function buildJourneyDistribution(records) {
  const groups = new Map()
  for (const raw of records || []) {
    const r = normalizedRecord(raw)
    if (!r.productName || !Number.isFinite(r.score)) continue
    const key = `${r.productName}\u0000${r.journeyL1}`
    const g = groups.get(key) || {
      productName: r.productName,
      journey: r.journeyL1,
      rows: [],
    }
    g.rows.push(r)
    groups.set(key, g)
  }
  return [...groups.values()]
    .map((g) => ({
      productName: g.productName,
      journey: g.journey,
      sampleSize: g.rows.length,
      avgScore: avg(g.rows.map((r) => r.score)),
      nonTenCount: g.rows.filter((r) => r.score < 10).length,
    }))
    .sort(
      (a, b) =>
        a.productName.localeCompare(b.productName, 'zh')
        || journeySortIndex(a.journey) - journeySortIndex(b.journey),
    )
}

/**
 * 把分布行收成一张旅程图的数据：柱=样本量，线=均分。空环节均分为 null，折线断开。
 * @param {ReturnType<typeof buildJourneyDistribution>} rows
 * @param {{ productName?: string }} [opts]
 */
export function toJourneyChartRows(rows, opts = {}) {
  const productName = String(opts.productName || '').trim()
  const scoped = productName
    ? (rows || []).filter((row) => row.productName === productName)
    : (rows || [])
  const byJourney = new Map()
  for (const row of scoped) {
    const journey = String(row.journey || POST_USE_JOURNEY_EMPTY)
    const current = byJourney.get(journey) || {
      journey,
      sampleSize: 0,
      scoreSum: 0,
      nonTenCount: 0,
    }
    const sample = Number(row.sampleSize) || 0
    current.sampleSize += sample
    current.scoreSum += (Number(row.avgScore) || 0) * sample
    current.nonTenCount += Number(row.nonTenCount) || 0
    byJourney.set(journey, current)
  }
  const extra = [...byJourney.keys()].filter(
    (journey) => !POST_USE_JOURNEY_L1_ORDER.includes(journey) && journey !== POST_USE_JOURNEY_EMPTY,
  )
  extra.sort((a, b) => a.localeCompare(b, 'zh'))
  const includeUnknown = (byJourney.get(POST_USE_JOURNEY_EMPTY)?.sampleSize || 0) > 0
  const order = [
    ...POST_USE_JOURNEY_L1_ORDER,
    ...extra,
    ...(includeUnknown ? [POST_USE_JOURNEY_EMPTY] : []),
  ]
  return order.map((journey) => {
    const row = byJourney.get(journey)
    const sampleSize = row?.sampleSize || 0
    return {
      journey,
      date: journey,
      sampleSize,
      avgScore: sampleSize ? Math.round((row.scoreSum / sampleSize) * 100) / 100 : null,
      nonTenCount: row?.nonTenCount || 0,
    }
  })
}

/** PUR-08: product x original evaluation scene x existing user journey. */
export function buildSceneJourneyAnalysis(records) {
  const groups = new Map()
  for (const raw of records || []) {
    const r = normalizedRecord(raw)
    if (!r.productName || !Number.isFinite(r.score)) continue
    const key = [r.productName, r.originalScene, r.journeyL1].join('\u0000')
    const g = groups.get(key) || { productName: r.productName, originalScene: r.originalScene, journey: r.journeyL1, rows: [] }
    g.rows.push(r)
    groups.set(key, g)
  }
  return [...groups.values()].map((g) => ({
    productName: g.productName,
    originalScene: g.originalScene,
    journey: g.journey,
    sampleSize: g.rows.length,
    avgScore: avg(g.rows.map((r) => r.score)),
    nonTenCount: g.rows.filter((r) => r.score < 10).length,
    evidenceIds: g.rows.filter((r) => r.score < 10).map((r) => r.id).filter(Boolean),
  })).sort((a, b) => b.nonTenCount - a.nonTenCount || a.avgScore - b.avgScore)
}

/** @param {object[]} records */
export function buildNeedInsights(records, visits = []) {
  const groups = new Map()
  for (const raw of records || []) {
    const r = normalizedRecord(raw)
    if (!r.productName || !r.text || !Number.isFinite(r.score) || r.score >= 10) continue
    const matches = matchAllReasonTaxonomy(r.text, r.channel)
    const labels = matches.map((m) => m.label)
    for (const label of labels) {
      const key = `${r.productName}\u0000${label}`
      const g = groups.get(key) || { productName: r.productName, need: label, rows: [], customers: new Set() }
      g.rows.push(r)
      g.customers.add(r.customerCode || r.customerName)
      groups.set(key, g)
    }
  }
  return [...groups.values()].map((g) => {
    const count = g.rows.length
    const customerCount = g.customers.size
    const severity = avg(g.rows.map((r) => 10 - r.score))
    const priorityScore = Math.round((count * 4 + customerCount * 3 + severity * 2) * 100) / 100
    const relatedVisits = visitsForProduct(visits, g.productName).filter((visit) => visit.text.includes(g.need))
    return {
      productName: g.productName,
      need: g.need,
      count,
      customerCount,
      avgScore: avg(g.rows.map((r) => r.score)),
      priorityScore,
      priority: priorityScore >= 20 ? 'P0' : priorityScore >= 10 ? 'P1' : 'P2',
      explanation: `频次 ${count}×4 + 客户 ${customerCount}×3 + 严重度 ${severity}×2`,
      evidenceIds: g.rows.map((r) => r.id).filter(Boolean),
      quotes: g.rows.map((r) => r.text).filter(Boolean).slice(0, 3),
      visitEvidenceCount: relatedVisits.length,
      visitEvidenceIds: relatedVisits.map((visit) => visit.id).filter(Boolean),
      visitConclusions: relatedVisits.map((visit) => visit.internalConclusion || visit.visitResult).filter(Boolean),
    }
  }).sort((a, b) => b.priorityScore - a.priorityScore)
}

/** Records that need taxonomy enrichment; excluded from insights and prioritization. */
export function buildUnclassifiedNeedEvidence(records) {
  return (records || [])
    .map(normalizedRecord)
    .filter((r) => r.productName && r.text && Number.isFinite(r.score) && r.score < 10)
    .filter((r) => matchAllReasonTaxonomy(r.text, r.channel).length === 0)
    .map((r) => ({
      id: r.id,
      productName: r.productName,
      channel: r.channel,
      score: r.score,
      text: r.text,
    }))
}

export function buildCustomerInsights(records, visits = []) {
  const groups = new Map()
  for (const raw of records || []) {
    const r = normalizedRecord(raw)
    if (!Number.isFinite(r.score) || r.score >= 10) continue
    const key = r.customerCode || r.customerName
    const g = groups.get(key) || { customerName: r.customerName, customerCode: r.customerCode, rows: [], products: new Set(), visits: [] }
    g.rows.push(r)
    g.products.add(r.productName)
    groups.set(key, g)
  }
  for (const rawVisit of visits || []) {
    const visit = normalizedVisit(rawVisit)
    let matchedKey = ''
    for (const [key, group] of groups) {
      if ((group.customerCode && visit.userInfo.includes(group.customerCode)) || (group.customerName && group.customerName !== '匿名客户' && visit.userInfo.includes(group.customerName))) {
        matchedKey = key
        break
      }
    }
    const key = matchedKey || `visit:${visit.id || visit.userInfo}`
    const g = groups.get(key) || { customerName: visit.userInfo || '回访客户', customerCode: '', rows: [], products: new Set(), visits: [] }
    g.visits.push(visit)
    if (visit.productName) g.products.add(visit.productName)
    groups.set(key, g)
  }
  return [...groups.values()].map((g) => ({
    customerName: g.customerName,
    customerCode: g.customerCode,
    nonTenCount: g.rows.length,
    avgScore: g.rows.length ? avg(g.rows.map((r) => r.score)) : null,
    products: [...g.products],
    highFrequency: g.rows.length >= 2,
    evidenceIds: g.rows.map((r) => r.id).filter(Boolean),
    latestQuote: g.rows.find((r) => r.text)?.text || '',
    visitEvidenceCount: g.visits.length,
    visitEvidenceIds: g.visits.map((visit) => visit.id).filter(Boolean),
    visitItems: visitItemsFrom(g.visits),
    visitConclusion: g.visits.map((visit) => visit.internalConclusion || visit.visitResult).filter(Boolean).at(-1) || '',
  })).sort((a, b) => b.nonTenCount - a.nonTenCount || a.avgScore - b.avgScore)
}

/**
 * 3.8 高频低分原因登记：官网评分类、云网产品、得分<7，取首个有效反馈；
 * 保留 Top5 高频原因或重点客户记录。
 *
 * 输出按「原因 → 产品」两级聚合：每行 = 一个 (原因, 产品) 组合，同一原因的多行在
 * UI 层用 rowSpan 合并「低分反馈」「均分」两列。
 * - `score` = 该 (原因,产品) 下所有 <7 分低分记录的均分（每行独立）。
 * - `reasonAvgScore` = 该原因下所有低分记录的整体均分（按原因合并单元格）。
 * - `feedbackCount` = 该 (原因,产品) 下去重客户数。
 * - `customerNameText` = 该 (原因,产品) 下客户名分号拼接（去重，按首次出现顺序）。
 * - `customerTag` = 该 (原因,产品) 下任一客户命中重点名单则标「重点」，否则空。
 * @param {object[]} records
 * @param {{ keyCustomers?: string[]; productNames?: string[] }} [options]
 */
export function buildHighFrequencyLowScoreReasonRows(records, options = {}) {
  const keyCustomers = options.keyCustomers || []
  const productNames = options.productNames || []
  const productSet = productNames.length ? new Set(productNames) : null
  const scoped = (records || [])
    .filter((record) => String(record.channel || record.sourceSubType || '') === 'console')
    .filter((record) => {
      const productName = String(record.productName || record.product || '').trim()
      return productName && (!productSet || productSet.has(productName))
    })
    .map((record) => {
      const score = Number(record.ratingScore)
      return {
        id: String(record.id || ''),
        productName: String(record.productName || record.product || '').trim(),
        score,
        customerName: String(record.customerName || '').trim() || '匿名客户',
        reason: pickHighFrequencyLowScoreReason(record),
        isKeyCustomer: isKeyCustomerName(record.customerName, keyCustomers),
      }
    })
    .filter((record) => Number.isFinite(record.score) && record.score < HIGH_FREQUENCY_LOW_SCORE_THRESHOLD)
    .filter((record) => record.reason)

  // 原因频次（按记录数），用于取 Top5 原因
  const reasonCount = new Map()
  for (const record of scoped) {
    reasonCount.set(record.reason, (reasonCount.get(record.reason) || 0) + 1)
  }
  const topFiveReasons = new Set(
    [...reasonCount.entries()]
      .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0], 'zh'))
      .slice(0, 5)
      .map(([reason]) => reason),
  )

  const kept = scoped.filter((record) => topFiveReasons.has(record.reason) || record.isKeyCustomer)

  // 原因级均分（该原因下所有低分记录的整体均分）
  const reasonScores = new Map()
  for (const record of kept) {
    const arr = reasonScores.get(record.reason) || []
    arr.push(record.score)
    reasonScores.set(record.reason, arr)
  }
  const reasonAvgScore = new Map()
  for (const [reason, scores] of reasonScores) {
    reasonAvgScore.set(reason, avg(scores))
  }

  // 按 (原因, 产品) 分桶，客户去重
  const groups = new Map() // key: `${reason}\u0000${productName}`
  for (const record of kept) {
    const key = `${record.reason}\u0000${record.productName}`
    const g = groups.get(key) || {
      reason: record.reason,
      productName: record.productName,
      customerNames: [],
      customerSet: new Set(),
      scores: [],
      isAnyKeyCustomer: false,
    }
    if (!g.customerSet.has(record.customerName)) {
      g.customerSet.add(record.customerName)
      g.customerNames.push(record.customerName)
    }
    g.scores.push(record.score)
    g.isAnyKeyCustomer = g.isAnyKeyCustomer || record.isKeyCustomer
    groups.set(key, g)
  }

  return [...groups.values()].map((g) => ({
    id: `${g.reason}\u0000${g.productName}`,
    lowScoreFeedback: g.reason,
    reasonAvgScore: reasonAvgScore.get(g.reason),
    productName: g.productName,
    score: avg(g.scores),
    feedbackCount: g.customerSet.size,
    customerNameText: g.customerNames.join('；'),
    customerTag: g.isAnyKeyCustomer ? '重点' : '',
  })).sort((a, b) =>
    a.lowScoreFeedback.localeCompare(b.lowScoreFeedback, 'zh')
    || Number(b.feedbackCount) - Number(a.feedbackCount)
    || Number(Boolean(b.customerTag)) - Number(Boolean(a.customerTag))
    || Number(a.score) - Number(b.score)
    || a.productName.localeCompare(b.productName, 'zh'))
}

/** @param {object[]} records */
export function buildIssueChanges(records) {
  const rows = (records || []).map(normalizedRecord).filter((r) => r.month && r.score < 10 && r.text)
  const months = [...new Set(rows.map((r) => r.month))].sort()
  if (!months.length) return []
  const current = months.at(-1)
  const previous = months.at(-2) || ''
  const bucket = (month) => {
    const map = new Map()
    for (const r of rows.filter((x) => x.month === month)) {
      const labels = matchAllReasonTaxonomy(r.text, r.channel).map((m) => m.label)
      for (const label of labels) {
        const key = `${r.productName}\u0000${label}`
        const g = map.get(key) || { productName: r.productName, issue: label, count: 0, evidenceIds: [] }
        g.count += 1
        if (r.id) g.evidenceIds.push(r.id)
        map.set(key, g)
      }
    }
    return map
  }
  const now = bucket(current)
  const prev = bucket(previous)
  const keys = new Set([...now.keys(), ...prev.keys()])
  return [...keys].map((key) => {
    const a = now.get(key)
    const b = prev.get(key)
    const currentCount = a?.count || 0
    const previousCount = b?.count || 0
    let change = '持续'
    if (!previousCount && currentCount) change = '新增'
    else if (previousCount && !currentCount) change = '消失'
    else if (currentCount > previousCount) change = '增长'
    else if (currentCount < previousCount) change = '缓解'
    return {
      productName: (a || b).productName,
      issue: (a || b).issue,
      currentMonth: current,
      previousMonth: previous,
      currentCount,
      previousCount,
      change,
      evidenceIds: [...(a?.evidenceIds || []), ...(b?.evidenceIds || [])],
    }
  }).sort((a, b) => {
    const order = { 新增: 0, 增长: 1, 持续: 2, 缓解: 3, 消失: 4 }
    return order[a.change] - order[b.change]
  })
}

export function buildPostUseInsightBundle(records, { visits = [], keyCustomers = [], productNames = [] } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    ruleVersion: POST_USE_ANALYSIS_RULE_VERSION,
    visitEvidenceCount: visits.length,
    products: buildProductExperienceOverview(records, visits),
    sceneJourneys: buildSceneJourneyAnalysis(records),
    journeyDistribution: buildJourneyDistribution(records),
    needs: buildNeedInsights(records, visits),
    unclassifiedNeeds: buildUnclassifiedNeedEvidence(records),
    customers: buildCustomerInsights(records, visits),
    highFrequencyLowScoreReasons: buildHighFrequencyLowScoreReasonRows(records, { keyCustomers, productNames }),
    issueChanges: buildIssueChanges(records),
  }
}
