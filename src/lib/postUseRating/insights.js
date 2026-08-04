import { matchAllReasonTaxonomy } from './reasonTaxonomy.js'
import { normalizeEvidenceText } from './evidence.js'
import { POST_USE_CRITICAL_LOW_SCORE, POST_USE_SMALL_SAMPLE_N, hasCriticalLowScore } from './metrics.js'
import { POST_USE_ANALYSIS_RULE_VERSION } from './modelVersions.js'
import { isKeyCustomerName } from './callbackRecommendations.js'

export const POST_USE_ORIGINAL_SCENE_EMPTY = '未提供'
export const POST_USE_JOURNEY_EMPTY = '未识别环节'
const HIGH_FREQUENCY_LOW_SCORE_THRESHOLD = 7
const HIGH_FREQUENCY_REASON_INVALID_WORDS = new Set(['无', '无/不涉及', '业务使用完毕', '其他'])

/** @param {object} record */
function normalizedRecord(record) {
  return {
    id: String(record.id || record.ratingId || ''),
    month: String(record.importMonth || record.createdAt || '').slice(0, 7),
    productName: String(record.productName || record.product || '').trim(),
    score: Number(record.ratingScore ?? record.score),
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
    visitResult: normalizeEvidenceText(visit.visitResult),
    internalConclusion: normalizeEvidenceText(visit.internalConclusion),
    text: normalizeEvidenceText([visit.feedbackSummary, visit.visitResult, visit.internalConclusion].filter(Boolean).join(' ')),
  }
}

/** @param {unknown} value */
function isValidHighFrequencyReasonCandidate(value) {
  const text = normalizeEvidenceText(value)
  if (!text) return false
  if (HIGH_FREQUENCY_REASON_INVALID_WORDS.has(text)) return false
  if (text.toLowerCase() === 'nan') return false
  if (/^\d+$/.test(text)) return false
  return true
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
    if (isValidHighFrequencyReasonCandidate(text)) return text
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
    visitConclusion: g.visits.map((visit) => visit.internalConclusion || visit.visitResult).filter(Boolean).at(-1) || '',
  })).sort((a, b) => b.nonTenCount - a.nonTenCount || a.avgScore - b.avgScore)
}

/**
 * 3.8 高频低分原因登记：官网评分类、云网产品、得分<7，取首个有效反馈；
 * 保留 Top5 高频原因或重点客户记录。
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
        customerName: String(record.customerName || '').trim(),
        customerCode: String(record.customerCode || '').trim(),
        reason: pickHighFrequencyLowScoreReason(record),
        isKeyCustomer: isKeyCustomerName(record.customerName, keyCustomers),
      }
    })
    .filter((record) => Number.isFinite(record.score) && record.score < HIGH_FREQUENCY_LOW_SCORE_THRESHOLD)
    .filter((record) => record.reason)

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

  return scoped
    .filter((record) => topFiveReasons.has(record.reason) || record.isKeyCustomer)
    .map((record) => ({
      id: record.id || [record.productName, record.customerCode || record.customerName, record.reason, record.score].join('\u0000'),
      lowScoreFeedback: record.reason,
      productName: record.productName,
      score: record.score,
      feedbackCount: reasonCount.get(record.reason) || 0,
      customerName: record.customerName || '匿名客户',
      customerCode: record.customerCode,
      customerTag: record.isKeyCustomer ? '重点' : '',
    }))
    .sort((a, b) =>
      Number(b.feedbackCount) - Number(a.feedbackCount)
      || Number(Boolean(b.customerTag)) - Number(Boolean(a.customerTag))
      || Number(a.score) - Number(b.score)
      || a.productName.localeCompare(b.productName, 'zh')
      || a.customerName.localeCompare(b.customerName, 'zh'))
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
    needs: buildNeedInsights(records, visits),
    unclassifiedNeeds: buildUnclassifiedNeedEvidence(records),
    customers: buildCustomerInsights(records, visits),
    highFrequencyLowScoreReasons: buildHighFrequencyLowScoreReasonRows(records, { keyCustomers, productNames }),
    issueChanges: buildIssueChanges(records),
  }
}
