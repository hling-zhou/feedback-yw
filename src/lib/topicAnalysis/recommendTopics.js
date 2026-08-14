import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import { recordDataDate } from '../../domain/insightPeriod.js'
import {
  TOPIC_BASELINE_MONTHS,
  TOPIC_RECENT_MONTHS,
  currentYearMonth,
  splitTopicRecommendWindow,
} from './period.js'
import { parseTopicSearchQuery } from './matchQuery.js'
import { isTicketSource } from '../importUtils.js'
import { getUrgencyLevel, isNegativeSentiment } from '../sentiment.js'
import { recordSourceType } from '../../snapshots/recordScope.js'
import {
  MAX_TOPIC_RECOMMEND_CANDIDATES,
  MAX_TOPIC_RECOMMENDATIONS,
  TOPIC_SCENARIO_LABELS,
  TOPIC_TYPE_LABELS,
} from './constants.js'
import {
  customerIdentityKey,
  extractCustomerIdentity,
  normalizeIdentityText,
} from './customerIdentity.js'

const SKIP_PROBLEM_KEYS = new Set(['', '未识别', '未分类', '未识别环节'])
const OPEN_ACTION_STATUSES = new Set(['pending_evaluation', 'in_progress', 'suspended'])

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function recordMonthKey(record) {
  const date = recordDataDate(record)
  return date ? date.slice(0, 7) : ''
}

export function recordProblemKey(record) {
  const key = compactText(
    record?.problemType
    || record?.feedbackReasonPrimary
    || (Array.isArray(record?.feedbackReasonTexts) ? record.feedbackReasonTexts[0] : '')
    || record?.journeyL1
    || '',
  )
  if (SKIP_PROBLEM_KEYS.has(key)) return ''
  return key
}

export function recordProductName(record) {
  return compactText(record?.product || record?.productName || '')
}

export function isNegativeRecord(record) {
  if (isNegativeSentiment(record?.sentiment)) return true
  const score = Number(record?.ratingScore)
  return Number.isFinite(score) && score < 7
}

export function isHighSeverityRecord(record) {
  return record?.sentiment === 'strong_negative' || getUrgencyLevel(record) === 'high'
}

export function isKeyCustomerTier(tier) {
  return /金牌|银牌/.test(String(tier || ''))
}

function isFollowUpUnresolved(record) {
  const follow = record?.followUpSatisfaction
  if (!follow) return false
  if (follow.problemResolved === 'unresolved') return true
  const score = Number(follow.score)
  return Number.isFinite(score) && score < 7
}

function quoteFromRecord(record) {
  const text = compactText(
    record.customerQuote
    || record.painPoint
    || record.problemSummary
    || record.commentText
    || record.lowScoreReason
    || record.rawText
    || record.customerRequest
    || '',
  )
  if (!text) return null
  const ticketId = String(record.ticketId || record.originalTicketId || '').trim()
  return {
    ticketId,
    text: text.slice(0, 120),
    href: ticketId ? `/feedbacks?ticketId=${encodeURIComponent(ticketId)}` : '/feedbacks',
    sourceLabel: DATA_SOURCE_LABELS[recordSourceType(record)] || recordSourceType(record),
  }
}

function collectQuotes(records, limit = 3) {
  const quotes = []
  for (const record of records || []) {
    if (quotes.length >= limit) break
    const quote = quoteFromRecord(record)
    if (quote) quotes.push(quote)
  }
  return quotes
}

function sourceCounts(records) {
  /** @type {Record<string, number>} */
  const counts = {}
  for (const record of records || []) {
    const type = recordSourceType(record)
    counts[type] = (counts[type] || 0) + 1
  }
  return counts
}

function uniqueRecords(records) {
  const seen = new Set()
  const out = []
  for (const record of records || []) {
    const id = String(record?.id || '')
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    out.push(record)
  }
  return out
}

function actionMatchesTopic(item, topic) {
  if (!OPEN_ACTION_STATUSES.has(item?.status)) return false
  const blob = normalizeIdentityText([
    item.content,
    item.detail,
    item.productName,
    item.insightTheme,
    item.problemTypeSnapshot,
  ].join(' '))
  const needles = [topic.problemKey, topic.product, topic.customerName, topic.customerCode]
    .map(normalizeIdentityText)
    .filter(Boolean)
  return needles.some((needle) => blob.includes(needle))
}

/**
 * @param {object[]} rows
 * @param {{ recent: string[], baseline: string[] }} window
 * @param {{ type: string, product?: string, problemKey?: string, customerName?: string, customerCode?: string }} topic
 * @param {object[]} [actionItems]
 */
export function analyzeTopicGroup(rows, window, topic, actionItems = []) {
  /** @type {Record<string, number>} */
  const monthCounts = {}
  const products = new Set()
  const sourceTypes = new Set()
  const negativeMonths = new Set()
  let negative = 0
  let highSeverity = 0
  let unresolvedFollowup = 0
  let keyCustomer = false

  for (const record of rows || []) {
    const month = recordMonthKey(record)
    if (month) monthCounts[month] = (monthCounts[month] || 0) + 1
    const product = recordProductName(record)
    if (product) products.add(product)
    sourceTypes.add(recordSourceType(record))
    if (isNegativeRecord(record)) {
      negative += 1
      if (month) negativeMonths.add(month)
    }
    if (isHighSeverityRecord(record)) highSeverity += 1
    if (isFollowUpUnresolved(record)) unresolvedFollowup += 1
    if (isKeyCustomerTier(extractCustomerIdentity(record).customerTier)) keyCustomer = true
  }

  const recentCount = (window.recent || []).reduce((sum, month) => sum + (monthCounts[month] || 0), 0)
  const baselineCount = (window.baseline || []).reduce((sum, month) => sum + (monthCounts[month] || 0), 0)
  const recentLen = Math.max((window.recent || []).length, 1)
  const baselineLen = Math.max((window.baseline || []).length, 1)
  const recentAvg = recentCount / recentLen
  const baselineAvg = baselineCount / baselineLen
  const worseningRatio = baselineAvg > 0 ? recentAvg / baselineAvg : 0
  const monthCount = Object.keys(monthCounts).length
  const hasTicket = [...sourceTypes].some((type) => isTicketSource(type))
  const hasPostUse = [...sourceTypes].some((type) => type === 'post_use_rating')
  const unresolvedAction = (actionItems || []).some((item) => actionMatchesTopic(item, topic))

  /** @type {string[]} */
  const scenarios = []
  if (monthCount >= 3 && recentCount > 0) scenarios.push('chronic')
  if (recentCount >= 3 && baselineAvg > 0 && recentAvg >= baselineAvg * 1.5) scenarios.push('worsening')
  if (baselineCount <= 1 && recentCount >= 3) scenarios.push('emerging')
  if (products.size >= 2 && rows.length >= 3) scenarios.push('cross_product')
  if (topic.type === 'customer' && (negative >= 3 || negativeMonths.size >= 2)) scenarios.push('customer_persistent')
  if (keyCustomer) scenarios.push('key_customer')
  if (hasTicket && hasPostUse) scenarios.push('cross_source')
  if (highSeverity >= 2) scenarios.push('high_severity')
  if (unresolvedFollowup > 0 || unresolvedAction) scenarios.push('unresolved')

  const worseningBoost = scenarios.includes('worsening') ? Math.max(0, worseningRatio - 1) : 0
  const score = (
    rows.length
    + negative * 2
    + monthCount * 3
    + worseningBoost * 8
    + Math.max(0, products.size - 1) * 4
    + (scenarios.includes('cross_source') ? 5 : 0)
    + (scenarios.includes('key_customer') ? 4 : 0)
    + (scenarios.includes('unresolved') ? 3 : 0)
    + (scenarios.includes('high_severity') ? 2 : 0)
  )

  return {
    monthCounts,
    monthCount,
    recentCount,
    baselineCount,
    recentAvg,
    baselineAvg,
    worseningRatio,
    products: [...products],
    sourceTypes: [...sourceTypes],
    negative,
    highSeverity,
    unresolvedFollowup,
    unresolvedAction,
    keyCustomer,
    scenarios,
    score,
  }
}

function sourceCoverageReason(records) {
  const labels = [...new Set((records || []).map(recordSourceType))]
    .map((type) => DATA_SOURCE_LABELS[type] || type)
  if (labels.length >= 2) return `跨 ${labels.join('、')}`
  if (labels.length === 1) return `来源为${labels[0]}`
  return ''
}

function ruleWhyNow(analysis, records) {
  const bits = []
  if (analysis.scenarios.includes('chronic')) bits.push(`覆盖 ${analysis.monthCount} 个月且近期仍在发生`)
  if (analysis.scenarios.includes('worsening')) {
    bits.push(`近期月均约为基线的 ${analysis.worseningRatio.toFixed(1)} 倍`)
  }
  if (analysis.scenarios.includes('emerging')) bits.push('基线几乎未见，近期集中出现')
  if (analysis.scenarios.includes('customer_persistent')) {
    bits.push(`${analysis.negative} 条负向/低分`)
  } else if (analysis.negative) {
    bits.push(`负向/低分 ${analysis.negative} 条`)
  }
  if (analysis.scenarios.includes('cross_product')) bits.push(`跨 ${analysis.products.length} 个产品`)
  const coverage = sourceCoverageReason(records)
  if (coverage) bits.push(coverage)
  if (analysis.scenarios.includes('unresolved')) bits.push('系统内仍有未闭环信号')
  if (!bits.length) bits.push(`${records.length} 条相关记录`)
  return `${bits.join('，')}。`
}

function decorateCard(card, rows, analysis, periodLabel) {
  const quotes = collectQuotes(rows)
  const countsBySource = sourceCounts(rows)
  const count = rows.length
  return {
    ...card,
    typeLabel: TOPIC_TYPE_LABELS[card.type] || card.type,
    intro: card.intro,
    whyNow: ruleWhyNow(analysis, rows),
    sourceHint: periodLabel || '近9个月系统数据',
    sampleSize: count,
    sourceTypes: analysis.sourceTypes,
    sourceTypeLabels: analysis.sourceTypes.map((type) => DATA_SOURCE_LABELS[type] || type),
    countsBySource,
    evidenceQuotes: quotes,
    periodLabel: periodLabel || '近9个月',
    scenarios: analysis.scenarios,
    scenarioLabels: analysis.scenarios.map((key) => TOPIC_SCENARIO_LABELS[key] || key),
    score: analysis.score,
    monthCounts: analysis.monthCounts,
    recentCount: analysis.recentCount,
    baselineCount: analysis.baselineCount,
    negative: analysis.negative,
    products: analysis.products,
    records: rows,
    priority: analysis.score >= 20 || analysis.scenarios.includes('worsening') || analysis.scenarios.includes('chronic')
      ? 'high'
      : 'medium',
  }
}

function customerGroups(records) {
  /** @type {Map<string, { identity: ReturnType<typeof extractCustomerIdentity>, rows: object[] }>} */
  const grouped = new Map()
  for (const record of records || []) {
    const identity = extractCustomerIdentity(record)
    const key = customerIdentityKey(identity)
    if (!key) continue
    const current = grouped.get(key) || { identity, rows: [] }
    current.rows.push(record)
    grouped.set(key, current)
  }
  return [...grouped.values()]
}

function productIssueGroups(records) {
  /** @type {Map<string, { product: string, problem: string, rows: object[] }>} */
  const grouped = new Map()
  for (const record of records || []) {
    const product = recordProductName(record)
    const problem = recordProblemKey(record)
    if (!product || !problem) continue
    const key = `${product}::${problem}`
    const current = grouped.get(key) || { product, problem, rows: [] }
    current.rows.push(record)
    grouped.set(key, current)
  }
  return [...grouped.values()]
}

function commonIssueGroups(records) {
  /** @type {Map<string, { problem: string, rows: object[] }>} */
  const grouped = new Map()
  for (const record of records || []) {
    const problem = recordProblemKey(record)
    if (!problem) continue
    const current = grouped.get(problem) || { problem, rows: [] }
    current.rows.push(record)
    grouped.set(problem, current)
  }
  return [...grouped.values()]
}

function buildCustomerCard(group, window, periodLabel, actionItems) {
  const name = group.identity.customerName || group.identity.customerCode || '未命名客户'
  const topic = {
    id: `customer:${customerIdentityKey(group.identity)}`,
    type: 'customer',
    title: `客户 · ${name}`,
    customerCode: group.identity.customerCode,
    customerName: group.identity.customerName,
    query: name,
  }
  const analysis = analyzeTopicGroup(group.rows, window, topic, actionItems)
  const products = analysis.products.slice(0, 3).join('、')
  const count = group.rows.length
  const keyCustomer = analysis.keyCustomer
  if (!(count >= 2 || (analysis.negative >= 1 && keyCustomer))) return null
  return decorateCard({
    ...topic,
    intro: `${periodLabel || '近9个月'}该客户相关反馈 ${count} 条${products ? `，涉及 ${products}` : ''}。`,
  }, group.rows, analysis, periodLabel)
}

function buildProductIssueCard(group, window, periodLabel, actionItems) {
  if (group.rows.length < 2) return null
  const topic = {
    id: `product:${group.product}:${group.problem}`,
    type: 'product_issue',
    title: `${group.product} · ${group.problem}`,
    product: group.product,
    problemKey: group.problem,
    query: group.problem,
  }
  const analysis = analyzeTopicGroup(group.rows, window, topic, actionItems)
  return decorateCard({
    ...topic,
    intro: `${periodLabel || '近9个月'}「${group.product}」上「${group.problem}」出现 ${group.rows.length} 条。`,
  }, group.rows, analysis, periodLabel)
}

function buildCommonIssueCard(group, window, periodLabel, actionItems) {
  const products = new Set(group.rows.map(recordProductName).filter(Boolean))
  if (products.size < 2 || group.rows.length < 3) return null
  const topic = {
    id: `common:${group.problem}`,
    type: 'common_issue',
    title: `共性问题 · ${group.problem}`,
    problemKey: group.problem,
    query: group.problem,
  }
  const analysis = analyzeTopicGroup(group.rows, window, topic, actionItems)
  return decorateCard({
    ...topic,
    intro: `${periodLabel || '近9个月'}「${group.problem}」跨 ${products.size} 个产品出现 ${group.rows.length} 条。`,
  }, group.rows, analysis, periodLabel)
}

/**
 * 合并相似专题：并集记录并重算统计，保留主卡标题/类型。模型不能改数字。
 * @param {object[]} cards
 */
export function mergeRecommendCards(cards) {
  const list = (cards || []).filter(Boolean)
  if (!list.length) return null
  const primary = list[0]
  const rows = uniqueRecords(list.flatMap((card) => card.records || []))
  const toMonth = currentYearMonth()
  const window = splitTopicRecommendWindow(
    primary.periodToMonth || toMonth,
    { recentMonths: TOPIC_RECENT_MONTHS, baselineMonths: TOPIC_BASELINE_MONTHS },
  )
  const analysis = analyzeTopicGroup(rows, window, primary, [])
  analysis.scenarios = [...new Set(list.flatMap((card) => card.scenarios || []).concat(analysis.scenarios))]
  const mergedId = primary.id
  return decorateCard({
    ...primary,
    id: mergedId,
    mergeIds: list.slice(1).map((card) => card.id),
    intro: primary.intro,
  }, rows, analysis, primary.periodLabel)
}

/**
 * @param {{
 *   records?: object[],
 *   periodLabel?: string,
 *   toMonth?: string,
 *   actionItems?: object[],
 *   candidateLimit?: number,
 *   limit?: number,
 * }} [input]
 */
export function recommendTopics(input = {}) {
  const records = Array.isArray(input.records) ? input.records : []
  const periodLabel = input.periodLabel || '近9个月'
  const toMonth = input.toMonth || currentYearMonth()
  const actionItems = Array.isArray(input.actionItems) ? input.actionItems : []
  const candidateLimit = input.candidateLimit ?? MAX_TOPIC_RECOMMEND_CANDIDATES
  const window = splitTopicRecommendWindow(toMonth)

  const cards = [
    ...customerGroups(records).map((group) => buildCustomerCard(group, window, periodLabel, actionItems)),
    ...productIssueGroups(records).map((group) => buildProductIssueCard(group, window, periodLabel, actionItems)),
    ...commonIssueGroups(records).map((group) => buildCommonIssueCard(group, window, periodLabel, actionItems)),
  ].filter(Boolean)

  const seen = new Set()
  const deduped = []
  for (const card of cards.sort((a, b) => (b.score - a.score) || (b.sampleSize - a.sampleSize))) {
    const key = `${card.type}:${card.title}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push({ ...card, periodToMonth: toMonth })
    if (deduped.length >= candidateLimit) break
  }
  if (input.limit != null) return deduped.slice(0, input.limit)
  return deduped
}

export function topRecommendCards(cards, limit = MAX_TOPIC_RECOMMENDATIONS) {
  return (cards || []).slice(0, limit)
}

/**
 * @param {string} query
 * @param {{ type?: string }} [options]
 */
export function topicFromUserQuery(query, options = {}) {
  const text = String(query || '').trim()
  if (!text) return null
  const type = options.type || 'common_issue'
  const parsed = type === 'customer' ? null : parseTopicSearchQuery(text)
  return {
    id: `custom:${type}:${text}`,
    type,
    title: text,
    query: text,
    customerName: type === 'customer' ? text : undefined,
    product: type === 'customer' ? undefined : (parsed?.productName || undefined),
    problemKey: type === 'customer' ? undefined : (parsed?.tokens.filter((token) => !parsed.productTokens.includes(token)).join('') || text),
    whyNow: '用户指定专题',
    sourceHint: '用户新建',
    sampleSize: 0,
    sourceTypes: [],
    priority: 'medium',
    typeLabel: TOPIC_TYPE_LABELS[type] || type,
    scenarios: [],
    scenarioLabels: [],
  }
}
