import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import {
  MAX_EVIDENCE_SCAN,
  MAX_TOPIC_QUOTES,
  MAX_TOPIC_SOURCES,
} from './constants.js'
import {
  customerMatchNote,
  extractCustomerIdentity,
  matchCustomerIdentity,
  normalizeIdentityText,
  recordMatchesCustomerTopic,
} from './customerIdentity.js'
import { recordSourceType } from '../../snapshots/recordScope.js'
import { blobMatchesTopicQuery, parseTopicSearchQuery } from './matchQuery.js'

/**
 * @param {string} value
 */
function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
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

  const parsed = parseTopicSearchQuery(topic.matchQuery || topic.problemKey || topic.query || '')
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
  if (!needle) return type === 'product_issue' ? Boolean(productHint && product) : false
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
    href: ticketId ? `/feedbacks?ticketId=${encodeURIComponent(ticketId)}` : '/feedbacks',
  }
}

/**
 * @param {object[]} visits
 * @param {object} topic
 */
function matchingVisits(visits, topic) {
  const needle = normalizeIdentityText(topic.matchQuery || topic.query || topic.problemKey || topic.customerName || topic.customerCode || '')
  return (visits || []).filter((visit) => {
    if (topic.type === 'customer') {
      return Boolean(matchCustomerIdentity(visit, topic) || (
        needle && (
          normalizeIdentityText(visit.customerName).includes(needle)
          || normalizeIdentityText(visit.customerCode).includes(needle)
        )
      ))
    }
    const blob = normalizeIdentityText([
      visit.productName,
      visit.customerName,
      visit.feedbackSummary,
      visit.visitResult,
      visit.internalConclusion,
    ].join(' '))
    if (topic.product && !blob.includes(normalizeIdentityText(topic.product))) return false
    return !needle || blobMatchesTopicQuery(blob, needle)
  })
}

/**
 * @param {{ topic: object, records?: object[], visits?: object[], actionItems?: object[], periodLabel?: string }} input
 */
export function collectTopicEvidence(input) {
  const topic = input.topic
  const periodLabel = input.periodLabel || '当前周期'
  const matched = []
  let scanned = 0
  for (const record of input.records || []) {
    scanned += 1
    if (scanned > MAX_EVIDENCE_SCAN) break
    if (recordMatchesTopic(record, topic)) matched.push(record)
  }

  const countsBySource = {}
  const products = new Map()
  const problemTypes = new Map()
  const quotes = []
  const sources = []
  let matchMode = topic.type === 'customer' ? 'name_approx' : 'keyword'

  for (const record of matched) {
    const sourceType = recordSourceType(record)
    countsBySource[sourceType] = (countsBySource[sourceType] || 0) + 1
    const product = String(record.product || record.productName || '').trim()
    if (product) products.set(product, (products.get(product) || 0) + 1)
    const problem = String(record.problemType || '').trim()
    if (problem) problemTypes.set(problem, (problemTypes.get(problem) || 0) + 1)
    if (topic.type === 'customer') {
      const identity = extractCustomerIdentity(record)
      if (matchCustomerIdentity(identity, topic) === 'code') matchMode = 'code'
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
        href: record.ticketId ? `/feedbacks?ticketId=${encodeURIComponent(record.ticketId)}` : '/feedbacks',
      })
    }
  }

  const visits = matchingVisits(input.visits || [], topic).slice(0, 12)
  const actionItems = (input.actionItems || []).filter((item) => {
    const blob = normalizeIdentityText([
      item.content,
      item.detail,
      item.productName,
      item.insightTheme,
      item.problemTypeSnapshot,
      ...(Array.isArray(item.linkedTicketIds) ? item.linkedTicketIds : []),
    ].join(' '))
    const needle = topic.matchQuery || topic.problemKey || topic.query || topic.product || topic.customerName || ''
    return !normalizeIdentityText(needle) || blobMatchesTopicQuery(blob, needle)
  }).slice(0, 12)

  const gaps = []
  if (matched.length === 0) gaps.push('当前周期系统数据中未匹配到相关记录')
  if (topic.type === 'customer' && matchMode !== 'code') {
    gaps.push('客户身份未能按编码精确对齐，可能把同名或脱敏客户算在一起')
  }
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
    matchNote: topic.type === 'customer' ? customerMatchNote(matchMode) : '按产品/问题关键词匹配（允许拆开、中间夹字，不必原文连写）',
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
    gaps,
    evidenceIds: sources.map((row) => row.id).filter(Boolean),
  }
}
