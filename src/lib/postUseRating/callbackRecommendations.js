import { isPostUseRatingLibraryRecord } from '../../domain/postUseRatingImport.js'
import { normalizePostUseKeyCustomers } from '../storage.js'

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeCustomerKey(record) {
  const code = normalizeText(record.customerCode)
  if (code) return `code:${code}`
  return `name:${normalizeText(record.customerName) || '匿名客户'}`
}

function feedbackTime(record) {
  return String(record.createdAt || record.importedAt || '')
}

function getEffectiveQuote(record) {
  return (
    normalizeText(record.commentText) ||
    normalizeText(record.customerQuote) ||
    (normalizeText(record.rawText) !== normalizeText(record.lowScoreReason)
      ? normalizeText(record.rawText)
      : '')
  )
}

function getEffectiveReason(record) {
  return normalizeText(record.lowScoreReason)
}

export function isKeyCustomerName(customerName, keyCustomers = []) {
  const name = normalizeText(customerName)
  if (!name) return false
  return normalizePostUseKeyCustomers(keyCustomers).some((keyword) => keyword.includes(name) || name.includes(keyword))
}

function buildScoreBreakdownText(map) {
  return [...map.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([score, count]) => `${score}分${count}次`)
    .join('；')
}

function compareDesc(a, b) {
  return String(b || '').localeCompare(String(a || ''))
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {string[]} keyCustomers
 */
export function buildPostUseCallbackRecommendations(records, keyCustomers = []) {
  const keywords = normalizePostUseKeyCustomers(keyCustomers)
  if (!keywords.length) return []

  const groups = new Map()
  for (const record of records || []) {
    if (!isPostUseRatingLibraryRecord(record)) continue
    const score = Number(record.ratingScore)
    if (!Number.isFinite(score) || score >= 7) continue
    if (!isKeyCustomerName(record.customerName, keywords)) continue
    const customerName = normalizeText(record.customerName) || '匿名客户'
    const productName = normalizeText(record.productName || record.product)
    if (!productName) continue
    const key = `${normalizeCustomerKey(record)}\u0000${productName}`
    const group =
      groups.get(key) ||
      {
        customerName,
        customerCode: normalizeText(record.customerCode),
        productName,
        importMonths: new Set(),
        channels: new Set(),
        evidenceRecordIds: [],
        triggerRecords: [],
        scoreBreakdown: new Map(),
        latestFeedbackAt: '',
        completed: false,
      }
    group.importMonths.add(normalizeText(record.importMonth))
    group.channels.add(normalizeText(record.channel || record.sourceSubType))
    group.evidenceRecordIds.push(String(record.id))
    group.triggerRecords.push(record)
    group.scoreBreakdown.set(score, (group.scoreBreakdown.get(score) || 0) + 1)
    if (feedbackTime(record) >= group.latestFeedbackAt) {
      group.latestFeedbackAt = feedbackTime(record)
    }
    if (record.customerVisit) group.completed = true
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => {
      const lowScoreLt7Count = group.triggerRecords.length
      const scoreBreakdown = buildScoreBreakdownText(group.scoreBreakdown)
      const orderedRecords = [...group.triggerRecords].sort((a, b) =>
        compareDesc(feedbackTime(a), feedbackTime(b)),
      )
      const quotes = orderedRecords.map(getEffectiveQuote).filter(Boolean)
      const reasons = orderedRecords.map(getEffectiveReason).filter(Boolean)
      return {
        customerName: group.customerName,
        customerCode: group.customerCode,
        productName: group.productName,
        importMonths: [...group.importMonths].filter(Boolean).sort(),
        triggerType: '7分以下重点客户',
        lowScoreLt7Count,
        scoreBreakdown,
        quoteCount: quotes.length,
        reasonCount: reasons.length,
        quotes,
        reasons,
        latestFeedbackAt: group.latestFeedbackAt,
        channels: [...group.channels].filter(Boolean),
        recommendedReason: `${group.customerName} 在${group.productName}下有 ${lowScoreLt7Count} 次7分以下反馈${scoreBreakdown ? `（${scoreBreakdown}）` : ''}，且命中重点客户名单，建议客服部回访。`,
        evidenceRecordIds: [...group.evidenceRecordIds],
        completed: group.completed,
        isKeyCustomer: true,
      }
    })
    .sort(
      (a, b) =>
        Number(b.lowScoreLt7Count) - Number(a.lowScoreLt7Count) ||
        compareDesc(a.latestFeedbackAt, b.latestFeedbackAt) ||
        a.customerName.localeCompare(b.customerName, 'zh') ||
        a.productName.localeCompare(b.productName, 'zh'),
    )
}
