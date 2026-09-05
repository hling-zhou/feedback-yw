import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import {
  MAX_TOPIC_QUOTES,
  MAX_TOPIC_SOURCES,
} from './constants.js'
import {
  customerMatchNote,
  extractCustomerIdentity,
  identityMatchesCustomerTopic,
  matchCustomerIdentity,
  normalizeIdentityText,
  recordMatchesCustomerTopic,
} from './customerIdentity.js'
import { recordSourceType } from '../../snapshots/recordScope.js'
import { blobMatchesTopicQuery, parseTopicMatchInput, formatTopicMatchLayers } from './matchQuery.js'
import { buildFeedbacksTicketFilterHref } from '../feedbackFilters.js'
import {
  analyzeTopicGroup,
  isHighSeverityRecord,
  isNegativeRecord,
  recordJourneyL2Key,
  recordMonthKey,
  recordProblemKey,
  recordProductName,
} from './recommendTopics.js'
import { shiftYearMonth } from '../../domain/insightPeriod.js'

/**
 * @param {string} value
 */
function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

const OPEN_ACTION_STATUSES = new Set(['pending_evaluation', 'in_progress', 'suspended'])
const TERMINAL_ACTION_STATUSES = new Set(['completed', 'not_implemented', 'abnormal_terminated'])
const EXPECTATION_RE = /我以为|应该|不是说|承诺|宣传/

function monthRange(fromMonth, toMonth) {
  if (!/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth) || fromMonth > toMonth) {
    return []
  }
  const out = []
  let month = fromMonth
  while (month <= toMonth && out.length < 24) {
    out.push(month)
    month = shiftYearMonth(month, 1) || ''
  }
  return out
}

function decisionWindow(period, matched) {
  const recordMonths = matched.map(recordMonthKey).filter(Boolean).sort()
  const all = monthRange(period?.fromMonth || recordMonths[0], period?.toMonth || recordMonths.at(-1))
  if (all.length >= 6) return { recent: all.slice(-4), baseline: all.slice(0, -4), all }
  if (all.length >= 3) {
    const split = Math.floor(all.length / 2)
    return { recent: all.slice(split), baseline: all.slice(0, split), all }
  }
  return { recent: [], baseline: [], all }
}

function distribution(records, keyOf) {
  const counts = new Map()
  for (const record of records) {
    const key = compactText(keyOf(record))
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
}

function concentration(rows) {
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  const top = rows[0] || { name: '', count: 0 }
  const second = rows[1] || { name: '', count: 0 }
  const headShare = total ? top.count / total : 0
  const secondShare = total ? second.count / total : 0
  return {
    total,
    rows,
    top,
    second,
    headShare,
    secondShare,
    concentrated: total >= 5 && headShare >= 0.4 && top.count - second.count >= 2,
  }
}

function quoteText(record) {
  return compactText(
    record.customerQuote || record.painPoint || record.problemSummary || record.commentText
    || record.lowScoreReason || record.rawText || record.customerRequest,
  )
}

function quoteClusters(records) {
  const groups = new Map()
  for (const record of records) {
    const text = quoteText(record)
    if (!text) continue
    const action = text.match(/(申请|配置|创建|购买|使用|开通|删除|修改|访问|登录|查询|操作|提交|升级|续费|绑定|切换).{0,8}/)?.[0]
      || recordProblemKey(record)
      || recordJourneyL2Key(record)
    if (!action) continue
    const key = action.replace(/\s+/g, '').slice(0, 12)
    const current = groups.get(key) || { key, count: 0, recordIds: [] }
    current.count += 1
    if (record.id) current.recordIds.push(String(record.id))
    groups.set(key, current)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-CN'))
}

function buildSignalPack({ matched, topic, actionItems, period }) {
  const window = decisionWindow(period, matched)
  const analysis = analyzeTopicGroup(matched, window, topic, actionItems)
  const savedScenarios = Array.isArray(topic.scenarios) ? topic.scenarios : []
  const scenarios = [...new Set([...savedScenarios, ...analysis.scenarios])]
  const dimensions = {
    problem: concentration(distribution(matched, recordProblemKey)),
    journeyL1: concentration(distribution(matched, (record) => record.journeyL1)),
    journeyL2: concentration(distribution(matched, recordJourneyL2Key)),
    requestScene: concentration(distribution(matched, (record) => record.requestScene)),
    resourcePool: concentration(distribution(matched, (record) => record.resourcePool)),
    productSpec: concentration(distribution(matched, (record) => record.productSpec)),
    source: concentration(distribution(matched, recordSourceType)),
    product: concentration(distribution(matched, recordProductName)),
  }
  const actionStatus = (actionItems || []).reduce((out, item) => {
    const status = String(item.status || '')
    if (OPEN_ACTION_STATUSES.has(status)) out.open.push(item)
    else if (TERMINAL_ACTION_STATUSES.has(status)) out.terminal.push(item)
    return out
  }, { open: [], terminal: [] })
  const quoteRows = matched.map(quoteText).filter(Boolean)
  const expectationCount = quoteRows.filter((text) => EXPECTATION_RE.test(text)).length
  const problem = dimensions.problem
  const splitSuggested = matched.length >= 5 && (
    (topic.type === 'common_issue' && (
      dimensions.product.rows.length < 2
      || dimensions.product.rows.slice(0, 2).some((product) => {
        const productRows = matched.filter((record) => recordProductName(record) === product.name)
        return concentration(distribution(productRows, recordProblemKey)).top.name !== problem.top.name
      })
    ))
    || (problem.rows.length >= 2 && problem.rows[0].count / problem.total < 0.5
      && problem.rows[0].count / problem.total >= 0.25
      && problem.rows[1].count / problem.total >= 0.25)
  )
  return {
    window,
    analysis: { ...analysis, scenarios },
    dimensions,
    inventory: {
      openCount: actionStatus.open.length,
      doneCount: actionStatus.terminal.filter((item) => item.status === 'completed').length,
      stoppedCount: actionStatus.terminal.filter((item) => item.status !== 'completed').length,
      open: actionStatus.open.slice(0, 3).map((item) => ({ id: item.id, title: item.content || item.detail || '未命名举措', status: item.status })),
    },
    sample: {
      total: matched.length,
      negative: matched.filter(isNegativeRecord).length,
      productCount: dimensions.product.rows.length,
      expectationRate: quoteRows.length ? expectationCount / quoteRows.length : 0,
      expectationCount,
      quoteCount: quoteRows.length,
    },
    quoteClusters: quoteClusters(matched).slice(0, 5),
    splitSuggested,
    painFragments: painFragments(matched),
    rootCauses: rootCauseRows(matched),
    highSeverity: matched.filter(isHighSeverityRecord).length,
    crossTabs: {
      problemByJourney: crossTab(matched, recordProblemKey, recordJourneyL2Key),
      problemByPool: crossTab(matched, recordProblemKey, (record) => compactText(record.resourcePool)),
      problemBySpec: crossTab(matched, recordProblemKey, (record) => compactText(record.productSpec)),
    },
  }
}

const SKIP_CAUSE_RE = /待分析|未识别|无法识别|^无$|^—$|^-$/

function painFragments(records) {
  const counts = new Map()
  for (const record of records) {
    const text = compactText(record.painPoint || record.problemSummary)
    if (!text || text.length < 4 || SKIP_CAUSE_RE.test(text)) continue
    const short = text.slice(0, 24)
    counts.set(short, (counts.get(short) || 0) + 1)
    for (const token of text.match(/[\u4e00-\u9fff]{4,8}/g) || []) {
      counts.set(token, (counts.get(token) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .filter((row) => row.count >= 2 || row.name.length >= 8)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 6)
}

function rootCauseRows(records) {
  const counts = new Map()
  for (const record of records) {
    for (const raw of [record.rootCauseReview, record.rootCause]) {
      const text = compactText(raw).slice(0, 40)
      if (!text || SKIP_CAUSE_RE.test(text)) continue
      counts.set(text, (counts.get(text) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 5)
}

function crossTab(records, keyA, keyB) {
  const counts = new Map()
  for (const record of records) {
    const a = compactText(keyA(record))
    const b = compactText(keyB(record))
    if (!a || !b || SKIP_CAUSE_RE.test(a) || SKIP_CAUSE_RE.test(b)) continue
    const key = `${a}\0${b}`
    const prev = counts.get(key)
    if (prev) prev.count += 1
    else counts.set(key, { a, b, count: 1 })
  }
  return [...counts.values()]
    .sort((x, y) => y.count - x.count || x.a.localeCompare(y.a, 'zh-CN'))
    .slice(0, 8)
}

/**
 * @param {object} record
 */
function recordSearchText(record) {
  return [
    record.product,
    record.productName,
    record.problemType,
    record.journeyL1,
    record.journeyL2,
    record.requestScene,
    record.painPoint,
    record.problemSummary,
    record.customerRequest,
    record.rawText,
    record.commentText,
    record.lowScoreReason,
    record.ticketId,
    ...(Array.isArray(record.feedbackReasonTexts) ? record.feedbackReasonTexts : []),
  ]
    .map(compactText)
    .filter(Boolean)
    .join(' ')
}

/**
 * @param {object} record
 * @param {object} topic
 */
export function recordMatchesTopic(record, topic) {
  if (!record || !topic) return false
  const type = topic.type
  if (type === 'customer') return recordMatchesCustomerTopic(record, topic)

  const parsed = parseTopicMatchInput(topic)
  const productHint = normalizeIdentityText(topic.product || parsed.productName)
  const product = normalizeIdentityText(record.product || record.productName)
  if (type === 'product_issue' && productHint && product) {
    const productOk = (
      product.includes(productHint)
      || productHint.includes(product)
      || parsed.productTokens.some((token) => product.includes(token) || token.includes(product))
    )
    if (!productOk) return false
  }

  const needle = parsed.needle
  if (!needle && !parsed.layers?.length) return type === 'product_issue' ? Boolean(productHint && product) : false
  return blobMatchesTopicQuery(recordSearchText(record), parsed)
}

/**
 * @param {object} record
 */
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
  const identity = extractCustomerIdentity(record)
  const sourceType = recordSourceType(record)
  const ticketId = String(record.ticketId || record.originalTicketId || '').trim()
  return {
    id: String(record.id || ticketId || text.slice(0, 12)),
    recordId: String(record.id || ''),
    ticketId,
    sourceType,
    sourceLabel: DATA_SOURCE_LABELS[sourceType] || sourceType,
    product: String(record.product || record.productName || ''),
    customerName: identity.customerName,
    customerCode: identity.customerCode,
    text: text.slice(0, 280),
    href: buildFeedbacksTicketFilterHref(ticketId),
  }
}

/**
 * @param {object[]} visits
 * @param {object} topic
 */
function matchingVisits(visits, topic) {
  const parsed = parseTopicMatchInput(topic)
  return (visits || []).filter((visit) => {
    if (topic.type === 'customer') {
      return identityMatchesCustomerTopic(visit, topic)
    }
    const blob = [
      visit.productName,
      visit.customerName,
      visit.feedbackSummary,
      visit.visitResult,
      visit.internalConclusion,
    ].join(' ')
    if (topic.product && !normalizeIdentityText(blob).includes(normalizeIdentityText(topic.product))) return false
    if (!parsed.needle && !parsed.layers?.length) return true
    return blobMatchesTopicQuery(blob, parsed)
  })
}

/**
 * @param {{ topic: object, records?: object[], visits?: object[], actionItems?: object[], periodLabel?: string, period?: object }} input
 */
export function collectTopicEvidence(input) {
  const topic = input.topic
  const periodLabel = input.periodLabel || '当前周期'
  const matched = (input.records || []).filter((record) => recordMatchesTopic(record, topic))

  const countsBySource = {}
  const products = new Map()
  const problemTypes = new Map()
  const quotes = []
  const sources = []
  let matchMode = topic.type === 'customer' ? 'exact' : 'keyword'

  for (const record of matched) {
    const sourceType = recordSourceType(record)
    countsBySource[sourceType] = (countsBySource[sourceType] || 0) + 1
    const product = String(record.product || record.productName || '').trim()
    if (product) products.set(product, (products.get(product) || 0) + 1)
    const problem = String(record.problemType || '').trim()
    if (problem) problemTypes.set(problem, (problemTypes.get(problem) || 0) + 1)
    if (topic.type === 'customer') {
      const identity = extractCustomerIdentity(record)
      const mode = matchCustomerIdentity(identity, topic)
      if (mode === 'code') matchMode = 'code'
      else if (mode === 'name' && matchMode !== 'code') matchMode = 'name'
    }
    if (quotes.length < MAX_TOPIC_QUOTES) {
      const quote = quoteFromRecord(record)
      if (quote) quotes.push(quote)
    }
    if (sources.length < MAX_TOPIC_SOURCES) {
      const quote = quoteFromRecord(record)
      sources.push({
        id: String(record.id || ''),
        ticketId: String(record.ticketId || record.originalTicketId || ''),
        sourceType,
        sourceLabel: DATA_SOURCE_LABELS[sourceType] || sourceType,
        product,
        customerName: extractCustomerIdentity(record).customerName,
        customerCode: extractCustomerIdentity(record).customerCode,
        summary: quote?.text || compactText(record.painPoint || record.rawText).slice(0, 160),
        href: buildFeedbacksTicketFilterHref(record.ticketId || record.originalTicketId),
      })
    }
  }

  const parsedMatch = topic.type === 'customer' ? null : parseTopicMatchInput(topic)
  const visits = matchingVisits(input.visits || [], topic).slice(0, 12)
  const actionItems = (input.actionItems || []).filter((item) => {
    const blob = [
      item.content,
      item.detail,
      item.productName,
      item.insightTheme,
      item.problemTypeSnapshot,
      ...(Array.isArray(item.linkedTicketIds) ? item.linkedTicketIds : []),
    ].join(' ')
    if (topic.type === 'customer') return true
    if (!parsedMatch?.needle && !parsedMatch?.layers?.length) return true
    return blobMatchesTopicQuery(blob, parsedMatch)
  }).slice(0, 12)
  const signalPack = buildSignalPack({
    matched,
    topic,
    actionItems,
    period: input.period,
  })

  const gaps = []
  if (matched.length === 0) gaps.push('当前周期系统数据中未匹配到相关记录')
  const identified = matched.filter((record) => extractCustomerIdentity(record).customerName || extractCustomerIdentity(record).customerCode).length
  if (topic.type === 'customer' && matched.length && identified / matched.length < 0.3) {
    gaps.push('大量记录缺少客户名称/编码（疑似上游脱敏）')
  }
  if (visits.length === 0) gaps.push('系统内未见匹配的客服拜访/回访材料')
  if (actionItems.length === 0) gaps.push('系统内未见确立举措')

  return {
    topic,
    periodLabel,
    matchMode,
    matchNote: topic.type === 'customer' ? customerMatchNote(matchMode) : (
      formatTopicMatchLayers(parsedMatch?.layers)
        ? `分层匹配（层内或、层间且）：${formatTopicMatchLayers(parsedMatch.layers)}`
        : '按产品/问题关键词匹配（层内为或，层与层为且；允许拆开、中间夹字）'
    ),
    total: matched.length,
    countsBySource,
    products: [...products.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    problemTypes: [...problemTypes.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    quotes,
    sources,
    visits: visits.map((visit) => ({
      id: visit.id,
      customerName: visit.customerName || '',
      customerCode: visit.customerCode || '',
      productName: visit.productName || '',
      text: compactText(visit.feedbackSummary || visit.visitResult || visit.internalConclusion).slice(0, 280),
    })),
    actionItems: actionItems.map((item) => ({
      id: item.id,
      title: item.content || item.detail || '未命名举措',
      status: item.status || '',
      productName: item.productName || '',
    })),
    signalPack,
    gaps,
    evidenceIds: sources.map((row) => row.id).filter(Boolean),
  }
}
