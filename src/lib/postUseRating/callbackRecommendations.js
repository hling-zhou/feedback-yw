import {
  isPostUseRatingLibraryRecord,
  isPostUseRatingRecord,
} from '../../domain/postUseRatingImport.js'
import { getEffectiveRootCauseReview } from '../../domain/rootCauseReview.js'
import { POST_USE_RATING_PRODUCT_NAMES } from '../productCatalog/postUseRatingProducts.js'
import { normalizeTicketId } from '../desensitize.js'
import { buildTicketRecordIndex } from '../followUpSatisfactionImport.js'
import { normalizePostUseKeyCustomers } from '../storage.js'
import { getDisplayCustomerRequest } from '../ticketAnalysis/ticketAnalysisSources.js'

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

function normalizeChannel(record) {
  const raw = normalizeText(record.channel || record.sourceSubType)
  if (raw === 'console' || raw === 'web_survey') return 'console'
  if (raw === 'option' || raw === 'web_option') return 'option'
  if (raw === 'callback' || raw === 'satisfaction_callback') return 'callback'
  if (raw === 'sms' || raw === 'sms_survey') return 'sms'
  return raw
}

const CHANNEL_DISPLAY_NAMES = {
  console: '官网评分类',
  option: '选项类',
  sms: '短信渠道',
  callback: '投诉回访',
}

const CHANNEL_DISPLAY_ORDER = ['官网评分类', '选项类', '短信渠道', '投诉回访']

function channelDisplayName(record) {
  return CHANNEL_DISPLAY_NAMES[normalizeChannel(record)] || ''
}

function sortChannelLabels(labels) {
  const set = labels instanceof Set ? labels : new Set(labels || [])
  return CHANNEL_DISPLAY_ORDER.filter((name) => set.has(name)).concat(
    [...set].filter((name) => !CHANNEL_DISPLAY_ORDER.includes(name)),
  )
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

function getSurveyName(record) {
  return (
    normalizeText(record.surveyName) ||
    normalizeText(record.sourceColumns?.['问卷名'])
  )
}

function getTouchpointPageName(record) {
  return (
    normalizeText(record.touchpointPageName) ||
    normalizeText(record.sourceColumns?.['触点页面名称'])
  )
}

function relatedGroupKey(record) {
  const productName = normalizeText(record.productName || record.product)
  return `${normalizeCustomerKey(record)}\u0000${productName}`
}

function pickLatestSurveyRecord(records) {
  let latest = null
  for (const record of records || []) {
    const channel = normalizeChannel(record)
    if (channel !== 'console' && channel !== 'option') continue
    if (!latest || feedbackTime(record) >= feedbackTime(latest)) latest = record
  }
  return latest
}

function getFeedbackReasonValues(record) {
  const explicit = Array.isArray(record.feedbackReasonTexts)
    ? record.feedbackReasonTexts
    : []
  const fallback = explicit.length
    ? explicit
    : [
      record.feedbackReasonPrimary,
      record.feedbackReasonSecondary,
      record.feedbackReasonTertiary,
    ]
  const seen = new Set()
  const values = []
  for (const candidate of fallback) {
    const text = normalizeText(candidate)
    if (!text || seen.has(text)) continue
    seen.add(text)
    values.push(text)
  }
  if (!values.length) {
    const comment = normalizeText(record.commentText)
    if (comment) values.push(comment)
  }
  return values
}

export function isKeyCustomerName(customerName, keyCustomers = []) {
  const name = normalizeText(customerName)
  if (!name) return false
  return normalizePostUseKeyCustomers(keyCustomers).some((keyword) => keyword.includes(name) || name.includes(keyword))
}

export const EMPTY_SURVEY_NAME_LABEL = '未填写问卷名'

function surveyNameForBreakdown(record) {
  return getSurveyName(record) || EMPTY_SURVEY_NAME_LABEL
}

function scoreBreakdownKey(record, score) {
  return `${surveyNameForBreakdown(record)}\u0000${score}`
}

function buildScoreBreakdownText(map) {
  return [...map.entries()]
    .map(([key, count]) => {
      const sep = key.lastIndexOf('\u0000')
      const surveyName = sep >= 0 ? key.slice(0, sep) : EMPTY_SURVEY_NAME_LABEL
      const score = sep >= 0 ? Number(key.slice(sep + 1)) : Number(key)
      return { surveyName, score, count }
    })
    .sort(
      (a, b) =>
        a.surveyName.localeCompare(b.surveyName, 'zh') || Number(b.score) - Number(a.score),
    )
    .map((item) => `${item.surveyName}*${item.score}分*${item.count}次`)
    .join('；')
}

export function questionnaireCallbackItemKey(item) {
  const code = normalizeText(item?.customerCode)
  const name = normalizeText(item?.customerName) || '匿名客户'
  const product = normalizeText(item?.productName)
  return `q:${code || name}:${product}`
}

export function callbackNonTenItemKey(item) {
  const ticketId = normalizeText(item?.originalTicketId) || normalizeText(item?.id)
  return `c:${ticketId}`
}

function compareDesc(a, b) {
  return String(b || '').localeCompare(String(a || ''))
}

function summarizeRepeatedValues(values) {
  const counts = new Map()
  const order = []
  for (const value of values || []) {
    const text = normalizeText(value)
    if (!text) continue
    if (!counts.has(text)) order.push(text)
    counts.set(text, (counts.get(text) || 0) + 1)
  }
  return order.map((text) => `${text}（${counts.get(text) || 0}）`).join('；')
}

function resolveProductNames(productNames) {
  const names = Array.isArray(productNames) && productNames.length
    ? productNames
    : [...POST_USE_RATING_PRODUCT_NAMES]
  return new Set(names.map((name) => normalizeText(name)).filter(Boolean))
}

function buildTriggerType(isKeyCustomer, isHighFrequency) {
  const tags = []
  if (isKeyCustomer) tags.push('重点客户')
  if (isHighFrequency) tags.push('高频低分客户')
  return tags.join('；')
}

function buildRecommendedReason(group, lowScoreLt7Count, scoreBreakdown) {
  const reasons = []
  if (group.isKeyCustomer) reasons.push('命中重点客户名单')
  if (group.isHighFrequency) reasons.push('同一客户低分记录达到2次及以上')
  const suffix = reasons.length ? `，${reasons.join('，')}` : ''
  return `${group.customerName} 在${group.productName}下有 ${lowScoreLt7Count} 次7分以下反馈${scoreBreakdown ? `（${scoreBreakdown}）` : ''}${suffix}，建议客服部回访。`
}

function isCallbackTriggerChannel(record) {
  const channel = normalizeChannel(record)
  return channel === 'console' || channel === 'option'
}

/**
 * 建议回访：官网评分类或选项类 + 云网产品 + 低于7分 + 重点客户或同一客户低分至少2次。
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {string[]} keyCustomers
 * @param {{ productNames?: string[] }} [opts]
 */
export function buildPostUseCallbackRecommendations(records, keyCustomers = [], opts = {}) {
  const keywords = normalizePostUseKeyCustomers(keyCustomers)
  const productNames = resolveProductNames(opts.productNames)
  const scoped = (records || [])
    .filter((record) => isPostUseRatingLibraryRecord(record))
    .filter((record) => isCallbackTriggerChannel(record))
    .filter((record) => productNames.has(normalizeText(record.productName || record.product)))
    .filter((record) => {
      const score = Number(record.ratingScore)
      return Number.isFinite(score) && score < 7
    })

  /** @type {Map<string, number>} */
  const customerLowScoreCounts = new Map()
  for (const record of scoped) {
    const customerKey = normalizeText(record.customerName) || normalizeText(record.customerCode)
    if (!customerKey) continue
    customerLowScoreCounts.set(customerKey, (customerLowScoreCounts.get(customerKey) || 0) + 1)
  }

  const groups = new Map()
  for (const record of scoped) {
    const customerName = normalizeText(record.customerName) || '匿名客户'
    const customerCode = normalizeText(record.customerCode)
    const productName = normalizeText(record.productName || record.product)
    if (!productName) continue
    const customerCountKey = customerName !== '匿名客户' ? customerName : customerCode
    const isKeyCustomer = keywords.length ? isKeyCustomerName(record.customerName, keywords) : false
    const isHighFrequency = Number(customerLowScoreCounts.get(customerCountKey) || 0) >= 2
    if (!isKeyCustomer && !isHighFrequency) continue

    const key = `${normalizeCustomerKey(record)}\u0000${productName}`
    const group = groups.get(key) || {
      key,
      customerName,
      customerCode,
      productName,
      importMonths: new Set(),
      evidenceRecordIds: [],
      triggerRecords: [],
      scoreBreakdown: new Map(),
      latestFeedbackAt: '',
      isKeyCustomer: false,
      isHighFrequency: false,
    }
    const score = Number(record.ratingScore)
    group.importMonths.add(normalizeText(record.importMonth))
    group.evidenceRecordIds.push(String(record.id))
    group.triggerRecords.push(record)
    const breakdownKey = scoreBreakdownKey(record, score)
    group.scoreBreakdown.set(breakdownKey, (group.scoreBreakdown.get(breakdownKey) || 0) + 1)
    group.isKeyCustomer = group.isKeyCustomer || isKeyCustomer
    group.isHighFrequency = group.isHighFrequency || isHighFrequency
    if (feedbackTime(record) >= group.latestFeedbackAt) {
      group.latestFeedbackAt = feedbackTime(record)
    }
    groups.set(key, group)
  }

  /** @type {Map<string, import('../types.js').FeedbackRecord[]>} */
  const relatedByKey = new Map()
  for (const record of records || []) {
    if (!isPostUseRatingRecord(record)) continue
    const productName = normalizeText(record.productName || record.product)
    if (!productName || !productNames.has(productName)) continue
    const key = relatedGroupKey(record)
    const list = relatedByKey.get(key) || []
    list.push(record)
    relatedByKey.set(key, list)
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
      const feedbackReasons = orderedRecords.flatMap((record) => getFeedbackReasonValues(record))
      const related = relatedByKey.get(group.key) || group.triggerRecords
      const latestSurveyRecord = pickLatestSurveyRecord(related)
      const channelLabels = new Set()
      for (const record of related) {
        const label = channelDisplayName(record)
        if (label) channelLabels.add(label)
      }
      if (!channelLabels.size) channelLabels.add('官网评分类')
      return {
        itemKey: questionnaireCallbackItemKey(group),
        sourceType: 'questionnaire',
        customerName: group.customerName,
        customerCode: group.customerCode,
        productName: group.productName,
        importMonths: [...group.importMonths].filter(Boolean).sort(),
        triggerType: buildTriggerType(group.isKeyCustomer, group.isHighFrequency),
        lowScoreLt7Count,
        scoreBreakdown,
        quoteCount: quotes.length,
        reasonCount: reasons.length,
        quotes,
        reasons,
        feedbackReasons,
        quoteSummary: summarizeRepeatedValues(quotes),
        reasonSummary: summarizeRepeatedValues(reasons),
        feedbackReasonSummary: summarizeRepeatedValues(feedbackReasons),
        latestFeedbackAt: group.latestFeedbackAt,
        latestSurveyName: latestSurveyRecord ? getSurveyName(latestSurveyRecord) : '',
        latestTouchpointPageName: latestSurveyRecord ? getTouchpointPageName(latestSurveyRecord) : '',
        channels: sortChannelLabels(channelLabels),
        recommendedReason: buildRecommendedReason(group, lowScoreLt7Count, scoreBreakdown),
        evidenceRecordIds: [...group.evidenceRecordIds],
        completed: Boolean(group.triggerRecords.some((record) => record.customerVisit)),
        isKeyCustomer: group.isKeyCustomer,
        isHighFrequency: group.isHighFrequency,
      }
    })
    .sort(
      (a, b) =>
        Number(b.lowScoreLt7Count) - Number(a.lowScoreLt7Count) ||
        Number(Boolean(b.isKeyCustomer)) - Number(Boolean(a.isKeyCustomer)) ||
        Number(Boolean(b.isHighFrequency)) - Number(Boolean(a.isHighFrequency)) ||
        compareDesc(a.latestFeedbackAt, b.latestFeedbackAt) ||
        a.customerName.localeCompare(b.customerName, 'zh') ||
        a.productName.localeCompare(b.productName, 'zh'),
    )
}

/**
 * 投诉回访非10分登记。
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {{ productNames?: string[]; ticketRecords?: import('../types.js').FeedbackRecord[] }} [opts]
 */
export function buildPostUseCallbackNonTenRecords(records, opts = {}) {
  const productNames = resolveProductNames(opts.productNames)
  const { byTicketId } = buildTicketRecordIndex(opts.ticketRecords || [])
  return (records || [])
    .filter((record) => isPostUseRatingRecord(record))
    .filter((record) => normalizeChannel(record) === 'callback')
    .filter((record) => productNames.has(normalizeText(record.productName || record.product)))
    .map((record) => {
      const score = Number(record.ratingScore)
      const originalTicketId = normalizeText(record.originalTicketId)
      const ticket = originalTicketId
        ? byTicketId.get(normalizeTicketId(originalTicketId) || originalTicketId)
        : null
      const mapped = {
        id: String(record.id || record.originalTicketId || `${record.customerName || ''}-${record.productName || record.product || ''}`),
        productName: normalizeText(record.productName || record.product),
        originalTicketId,
        score,
        customerName: normalizeText(record.customerName),
        customerCode: normalizeText(record.customerCode),
        dissatisfactionReason: normalizeText(record.lowScoreReason),
        importMonth: normalizeText(record.importMonth),
        customerRequest: ticket ? getDisplayCustomerRequest(ticket) : '',
        problemCause: ticket ? getEffectiveRootCauseReview(ticket) : '',
      }
      return {
        ...mapped,
        itemKey: callbackNonTenItemKey(mapped),
        sourceType: 'callback_non_ten',
      }
    })
    .filter((record) => Number.isFinite(record.score) && record.score !== 10)
    .sort((a, b) =>
      Number(a.score) - Number(b.score)
      || a.productName.localeCompare(b.productName, 'zh')
      || a.customerName.localeCompare(b.customerName, 'zh'))
}
