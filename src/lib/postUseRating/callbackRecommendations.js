import {
  isPostUseRatingLibraryRecord,
  isPostUseRatingRecord,
} from '../../domain/postUseRatingImport.js'
import { getEffectiveRootCauseReview } from '../../domain/rootCauseReview.js'
import { POST_USE_RATING_PRODUCT_NAMES } from '../productCatalog/postUseRatingProducts.js'
import { isSubstantiveFeedbackReason, splitFeedbackReasonPieces } from './reasonTaxonomy.js'
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

export function getFeedbackReasonValues(record) {
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

/**
 * 2026-11-04 修复：先按分号拆片再逐片判定。
 * 背景：导入解析的三个「客户回答」列原样保留分号多选（如 `其他;业务使用完毕无后续使用需求`），
 * 整串不在占位词集合里 → 逃过精确匹配 → sentiment 兜底把「后续」误判为待跟进 ≠ positive → 整串
 * 被当成实质负面。拆片后每片独立判定：纯占位组合不再判负，混有真负面片的串仍判负（不误伤）。
 * 先例：观察模块 scanTargets.js 已用「拆片 + 逐片判定」的正确姿势，本修复对齐之。
 */
export function recordHasNegativeFeedback(record) {
  return getFeedbackReasonValues(record).some((text) =>
    splitFeedbackReasonPieces(text).some((piece) => isSubstantiveFeedbackReason(piece)))
}

function isLowScoreRecord(record) {
  const score = Number(record.ratingScore)
  return Number.isFinite(score) && score < 7
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

/**
 * 2026-11-06 方案B（用户拍板）：问卷类清单条目键加月份段——「已纳入/勾选/归档」按月独立，
 * 修复跨月串扰（8 月归档的产品部回溯不再让 9 月同客户同产品行自动显示已纳入）。
 * 月份段 = 组内达标月份集合排序后用 | join（兼容 6a 不拆行拍板：多月并集仍一行，键含全部达标月）。
 * 投诉回访 callbackNonTenItemKey 用工单号天然唯一，不加月份。
 * @param {object} item 建议条目（group；字段动态，局部放宽访问）
 */
export function questionnaireCallbackItemKey(item) {
  /** @type {{ customerCode?: unknown; customerName?: unknown; productName?: unknown; importMonths?: unknown }} */
  const typed = item
  const code = normalizeText(typed?.customerCode)
  const name = normalizeText(typed?.customerName) || '匿名客户'
  const product = normalizeText(typed?.productName)
  const months = (Array.isArray(typed?.importMonths) ? typed.importMonths : [])
    .map((month) => normalizeText(month).slice(0, 7))
    .filter(Boolean)
    .sort()
  const monthPart = months.length ? `:${months.join('|')}` : ''
  return `q:${code || name}:${product}${monthPart}`
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

function buildTriggerType(isKeyCustomer, isHighFrequency, isNegativeFeedback) {
  const tags = []
  if (isKeyCustomer) tags.push('重点客户')
  if (isHighFrequency) tags.push('高频低分客户')
  if (isNegativeFeedback) tags.push('负面反馈')
  return tags.join('；')
}

function buildRecommendedReason(group, lowScoreLt7Count, scoreBreakdown, feedbackReasonSummary) {
  const parts = []
  if (lowScoreLt7Count) {
    parts.push(
      `${group.customerName} 在${group.productName}下有 ${lowScoreLt7Count} 次7分以下反馈${scoreBreakdown ? `（${scoreBreakdown}）` : ''}`,
    )
  }
  if (group.isNegativeFeedback) {
    const negativeBit = feedbackReasonSummary
      ? `反馈原因含负面表述（${feedbackReasonSummary}）`
      : '反馈原因含负面表述'
    if (parts.length) parts.push(negativeBit)
    else parts.push(`${group.customerName} 在${group.productName}下有${negativeBit}`)
  }
  const reasons = []
  if (group.isKeyCustomer) reasons.push('命中重点客户名单')
  if (group.isHighFrequency) reasons.push('同一客户单月低分记录达到2次及以上')
  const suffix = reasons.length ? `，${reasons.join('，')}` : ''
  const head = parts.length
    ? parts.join('，')
    : `${group.customerName} 在${group.productName}下建议客服部回访`
  return `${head}${suffix}，建议客服部回访。`
}

function isCallbackTriggerChannel(record) {
  const channel = normalizeChannel(record)
  return channel === 'console' || channel === 'option'
}

/**
 * 建议回访：官网评分类或选项类 + 云网产品，且满足任一路径：
 * - 低于7分 + 重点客户 或 同一客户单月低分至少2次（2026-11-04 口径修正：按客户×自然月
 *   跨产品累计，未达标月份不入选；重点客户/负面反馈路径不看频次）
 * - 反馈原因含实质负面表述（不看分数，不要重点/高频）
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {string[]} keyCustomers
 * @param {{ productNames?: string[] }} [opts]
 */
export function buildPostUseCallbackRecommendations(records, keyCustomers = [], opts = {}) {
  const keywords = normalizePostUseKeyCustomers(keyCustomers)
  const productNames = resolveProductNames(opts.productNames)
  const channelScoped = (records || [])
    .filter((record) => isPostUseRatingLibraryRecord(record))
    .filter((record) => isCallbackTriggerChannel(record))
    .filter((record) => productNames.has(normalizeText(record.productName || record.product)))
  const scoped = channelScoped.filter(
    (record) => isLowScoreRecord(record) || recordHasNegativeFeedback(record),
  )

  /**
   * 2026-11-04 需求6（口径修正，用户拍板）：低分计数按「客户 × 自然月」分别累计，跨产品合并
   * （key = customerCountKey\u0000importMonth）；记录入选仅看其所在月份的计数是否达阈值，
   * 未达标月份的低分记录不再因「范围内累计达标」被全量带入。
   * importMonth 为导入管线注入的动态字段（FeedbackRecord 类型未声明，运行时恒存在），
   * 此处局部放宽类型避免 TS2339 新增。
   */
  /** @type {Map<string, number>} */
  const customerLowScoreCounts = new Map()
  for (const record of /** @type {typeof channelScoped & { importMonth?: string }[]} */ (channelScoped)) {
    if (!isLowScoreRecord(record)) continue
    const customerKey = normalizeText(record.customerName) || normalizeText(record.customerCode)
    if (!customerKey) continue
    const month = normalizeText(record.importMonth)
    const countKey = `${customerKey}\u0000${month}`
    customerLowScoreCounts.set(countKey, (customerLowScoreCounts.get(countKey) || 0) + 1)
  }

  const groups = new Map()
  for (const record of /** @type {typeof scoped & { importMonth?: string }[]} */ (scoped)) {
    const customerName = normalizeText(record.customerName) || '匿名客户'
    const customerCode = normalizeText(record.customerCode)
    const productName = normalizeText(record.productName || record.product)
    if (!productName) continue
    const customerCountKey = customerName !== '匿名客户' ? customerName : customerCode
    const isKeyCustomer = keywords.length ? isKeyCustomerName(record.customerName, keywords) : false
    // 逐记录按「其所在月」的计数判定高频（跨产品合并到客户月计数）；阈值沿用 ≥2
    const monthCountKey = `${customerCountKey}\u0000${normalizeText(record.importMonth)}`
    const isHighFrequency = Number(customerLowScoreCounts.get(monthCountKey) || 0) >= 2
    const hasNegative = recordHasNegativeFeedback(record)
    const isLowScore = isLowScoreRecord(record)
    // 重点客户 / 负面反馈路径无月计数门槛（2026-11-04 6c 拍板：保持不看频次的既有语义）
    if (!hasNegative && !(isLowScore && (isKeyCustomer || isHighFrequency))) continue

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
      isNegativeFeedback: false,
    }
    const score = Number(record.ratingScore)
    group.importMonths.add(normalizeText(record.importMonth))
    group.evidenceRecordIds.push(String(record.id))
    group.triggerRecords.push(record)
    if (isLowScore) {
      const breakdownKey = scoreBreakdownKey(record, score)
      group.scoreBreakdown.set(breakdownKey, (group.scoreBreakdown.get(breakdownKey) || 0) + 1)
    }
    group.isKeyCustomer = group.isKeyCustomer || isKeyCustomer
    group.isHighFrequency = group.isHighFrequency || isHighFrequency
    group.isNegativeFeedback = group.isNegativeFeedback || hasNegative
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
      const lowScoreLt7Count = group.triggerRecords.filter(isLowScoreRecord).length
      const scoreBreakdown = buildScoreBreakdownText(group.scoreBreakdown)
      const orderedRecords = [...group.triggerRecords].sort((a, b) =>
        compareDesc(feedbackTime(a), feedbackTime(b)),
      )
      const quotes = orderedRecords.map(getEffectiveQuote).filter(Boolean)
      const reasons = orderedRecords.map(getEffectiveReason).filter(Boolean)
      const feedbackReasons = orderedRecords.flatMap((record) => getFeedbackReasonValues(record))
      const feedbackReasonSummary = summarizeRepeatedValues(feedbackReasons)
      // 2026-11-04 拆双字段：负面文案只用「判负命中」的文本，占位词（无/不涉及 等）不再混入
      // 「反馈原因含负面表述（…）」的括号里；「反馈原因」展示列继续用全量 feedbackReasonSummary。
      const negativeFeedbackSummary = summarizeRepeatedValues(
        feedbackReasons.filter((text) =>
          splitFeedbackReasonPieces(text).some((piece) => isSubstantiveFeedbackReason(piece))),
      )
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
        triggerType: buildTriggerType(group.isKeyCustomer, group.isHighFrequency, group.isNegativeFeedback),
        lowScoreLt7Count,
        scoreBreakdown,
        quoteCount: quotes.length,
        reasonCount: reasons.length,
        quotes,
        reasons,
        feedbackReasons,
        quoteSummary: summarizeRepeatedValues(quotes),
        reasonSummary: summarizeRepeatedValues(reasons),
        feedbackReasonSummary,
        negativeFeedbackSummary,
        latestFeedbackAt: group.latestFeedbackAt,
        latestSurveyName: latestSurveyRecord ? getSurveyName(latestSurveyRecord) : '',
        latestTouchpointPageName: latestSurveyRecord ? getTouchpointPageName(latestSurveyRecord) : '',
        channels: sortChannelLabels(channelLabels),
        recommendedReason: buildRecommendedReason(group, lowScoreLt7Count, scoreBreakdown, negativeFeedbackSummary),
        evidenceRecordIds: [...group.evidenceRecordIds],
        completed: Boolean(group.triggerRecords.some((record) => record.customerVisit)),
        isKeyCustomer: group.isKeyCustomer,
        isHighFrequency: group.isHighFrequency,
        isNegativeFeedback: group.isNegativeFeedback,
      }
    })
    .sort(
      (a, b) =>
        Number(b.evidenceRecordIds.length) - Number(a.evidenceRecordIds.length) ||
        Number(b.lowScoreLt7Count) - Number(a.lowScoreLt7Count) ||
        Number(Boolean(b.isKeyCustomer)) - Number(Boolean(a.isKeyCustomer)) ||
        Number(Boolean(b.isHighFrequency)) - Number(Boolean(a.isHighFrequency)) ||
        Number(Boolean(b.isNegativeFeedback)) - Number(Boolean(a.isNegativeFeedback)) ||
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
  const { byTicketId, byId } = buildTicketRecordIndex(opts.ticketRecords || [])
  return (records || [])
    .filter((record) => isPostUseRatingRecord(record))
    .filter((record) => normalizeChannel(record) === 'callback')
    .filter((record) => productNames.has(normalizeText(record.productName || record.product)))
    .map((record) => {
      const score = Number(record.ratingScore)
      const originalTicketId = normalizeText(record.originalTicketId)
      const ticket = originalTicketId
        ? (byTicketId.get(normalizeTicketId(originalTicketId) || originalTicketId) || byId.get(originalTicketId))
        : null
      const mapped = {
        id: String(record.id || record.originalTicketId || `${record.customerName || ''}-${record.productName || record.product || ''}`),
        productName: normalizeText(record.productName || record.product),
        originalTicketId,
        score,
        customerName: normalizeText(record.customerName),
        customerCode: normalizeText(record.customerCode),
        loginAccountName: record.sourceColumns?.['登录账号名称'] || record.sourceColumns?.['登陆账号名称'] || '',
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
